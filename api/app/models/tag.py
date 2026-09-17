"""Tags, scan events and the masked contact relay."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, SmallInteger, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, ciphertext, digest, timestamp, uuid_pk

if TYPE_CHECKING:
    from .user import User

TAG_STATUS_SAFE = "safe"
TAG_STATUS_LOST = "lost"

# How the owner's name is released once a bag is reported lost.
#
# A scan token is a bearer credential with no expiry: someone who scans a bag
# while it is safe learns nothing, but can save the URL and poll it. The moment
# the owner reports the bag lost, `always` hands that watcher the name. The
# finder never needed it — the relay works without it — so `on_reply` releases
# it into one conversation, to someone who has said they are holding the bag.
NAME_ALWAYS = "always"
NAME_ON_REPLY = "on_reply"
NAME_NEVER = "never"
NAME_DISCLOSURE = (NAME_ALWAYS, NAME_ON_REPLY, NAME_NEVER)


class Tag(Base):
    """One physical tag.

    The QR encodes ``token``, a 256-bit random string that means nothing on its
    own. Only ``token_hash`` is indexed for lookup; ``token_enc`` keeps a copy
    sealed under the owner's data key so the QR can be re-rendered later
    without the plaintext token ever being stored.
    """

    __tablename__ = "tags"
    __table_args__ = (
        CheckConstraint("status IN ('safe', 'lost')", name="status_valid"),
        CheckConstraint(
            "name_disclosure IN ('always', 'on_reply', 'never')", name="name_disclosure_valid"
        ),
        Index("ix_tags_user_created", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    token_hash: Mapped[bytes] = digest(unique=True)
    token_enc: Mapped[bytes] = ciphertext(nullable=False)
    token_version: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)

    # The NFC sticker this tag was written to, identified by the chip's factory
    # serial number. Stored as a keyed hash: the serial is a stable hardware
    # identifier, and a database dump should not be able to match it to a
    # sticker in the wild. Unique, so one chip belongs to one tag at a time.
    nfc_uid_bidx: Mapped[bytes | None] = digest(unique=True, nullable=True)
    nfc_bound_at: Mapped[dt.datetime | None] = timestamp()

    # "Blue carry-on" — the owner's own words, so it is treated as personal.
    label_enc: Mapped[bytes | None] = ciphertext()

    status: Mapped[str] = mapped_column(String(16), nullable=False, default=TAG_STATUS_SAFE)
    lost_at: Mapped[dt.datetime | None] = timestamp()

    # Rendering parameters only: palette name, motif, rotation. No personal data.
    design: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # The bag this tag is tied to, as a pictogram. Both values come from the
    # fixed lists in core/icons.py, so neither is free text: an icon name is
    # drawn into a PDF, and a colour the owner cannot see against their own
    # field colour is an icon that does not help them find the bag.
    icon: Mapped[str | None] = mapped_column(String(24))
    icon_color: Mapped[str | None] = mapped_column(String(16))

    # What a finder may see once the tag is marked lost. The address is never
    # exposed at all, at any setting.
    name_disclosure: Mapped[str] = mapped_column(String(16), nullable=False, default=NAME_ON_REPLY)
    reveal_message_relay: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    notify_on_scan: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Two different counts, and the gap between them is the point.
    #
    # `scan_count` counts visits where the page actually rendered and said so.
    # `page_fetch_count` counts every read of the scan endpoint, including the
    # ones no browser was behind. A bag looked at on a carousel moves both. A
    # saved URL on a polling loop moves only the second, which is what makes
    # automated watching visible without identifying anyone.
    scan_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    page_fetch_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_scan_at: Mapped[dt.datetime | None] = timestamp()

    # Reads that arrived with a code this tag has since retired — either a
    # saved link, or a tag whose printed code was never replaced.
    stale_scan_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_stale_scan_at: Mapped[dt.datetime | None] = timestamp()

    # The kill switch, for an owner who has reprinted and wants the old codes
    # to stop resolving at all. Off by default: turning it on strands anyone
    # still holding the old tag, which is the right trade only once the new one
    # is actually in use.
    block_retired_tokens: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_notified_at: Mapped[dt.datetime | None] = timestamp()

    created_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)
    updated_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)
    revoked_at: Mapped[dt.datetime | None] = timestamp()

    user: Mapped[User] = relationship(back_populates="tags")
    scans: Mapped[list[ScanEvent]] = relationship(
        back_populates="tag", cascade="all, delete-orphan"
    )
    threads: Mapped[list[RelayThread]] = relationship(
        back_populates="tag", cascade="all, delete-orphan"
    )
    retired_tokens: Mapped[list[RetiredToken]] = relationship(
        back_populates="tag", cascade="all, delete-orphan"
    )

    @property
    def is_lost(self) -> bool:
        return self.status == TAG_STATUS_LOST

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None


class TagClaim(Base):
    """A tag pre-issued to an address that may not have an account yet.

    The operator prints and ships physical tags. That happens before the buyer
    signs up, so the code has to exist — and be printable — while there is
    still no user to own it, and no data key to seal it under.

    So a claim carries its own data key, wrapped by the same keyring that wraps
    a user's. When the address registers, the claim is turned into a real Tag
    sealed under the new owner's key and the claim's own copy is destroyed. A
    claim is therefore the operator's data for as long as it exists, and the
    owner's the moment it is theirs.

    ``design_seed`` is the part that makes this work at all: a tag printed in
    advance has fixed artwork, so the seed is chosen here and the account
    adopts it at registration. One traveller still means one design — it is
    just decided a little earlier than usual.
    """

    __tablename__ = "tag_claims"

    id: Mapped[uuid.UUID] = uuid_pk()

    # Looked up at registration, and never stored in the clear.
    email_bidx: Mapped[bytes] = digest(index=True)
    email_enc: Mapped[bytes] = ciphertext(nullable=False)

    dek_wrapped: Mapped[bytes] = mapped_column(nullable=False)
    dek_version: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)

    token_hash: Mapped[bytes] = digest(unique=True)
    token_enc: Mapped[bytes] = ciphertext(nullable=False)
    design_seed: Mapped[bytes] = mapped_column(nullable=False)

    label_enc: Mapped[bytes | None] = ciphertext()
    icon: Mapped[str | None] = mapped_column(String(24))
    icon_color: Mapped[str | None] = mapped_column(String(16))

    issued_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)
    claimed_at: Mapped[dt.datetime | None] = timestamp()
    claimed_tag_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tags.id", ondelete="SET NULL"), nullable=True
    )

    @property
    def is_claimed(self) -> bool:
        return self.claimed_at is not None


class RetiredToken(Base):
    """A scan code this tag used to answer to.

    Rotating used to make the old code simply stop existing, which had two
    problems. It threw away the most useful thing about it — that anyone
    presenting it is holding a link rather than the bag. And it made rotation
    expensive: the printed tag and the NFC sticker both carry the old code, so
    cutting it off meant reprinting and rewriting before anyone could use the
    bag's tag again.

    So a retired code still resolves, in a reduced mode: the finder is told the
    bag is lost and can message the owner, but the name is never released,
    whatever the tag's setting says. A bag still comes home on an un-reprinted
    tag; a watcher polling a saved URL gains nothing at the moment the owner
    flips the switch. That is what makes rotation something an owner can do
    freely rather than something they put off.

    Rows are kept for as long as the tag exists, because the tag they were
    printed on may never be reprinted. Only the hash is stored.
    """

    __tablename__ = "retired_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[bytes] = digest(unique=True)
    retired_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)

    tag: Mapped[Tag] = relationship(back_populates="retired_tokens")


class ScanEvent(Base):
    """A single scan of a tag.

    Location is opt-in, coarse (city/region/country at best) and sealed under
    the owner's data key. The finder's IP address is never stored: only a
    keyed hash salted per UTC day, which supports deduplication and abuse
    limits for about a day and is worthless afterwards.
    """

    __tablename__ = "scan_events"
    __table_args__ = (Index("ix_scan_events_tag_occurred", "tag_id", "occurred_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"), nullable=False, index=True
    )

    occurred_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False, index=True)
    # Set at insert time from DLT_SCAN_RETENTION_DAYS; the purge job deletes by it.
    expires_at: Mapped[dt.datetime] = timestamp(nullable=False, index=True)

    shared_location: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    location_enc: Mapped[bytes | None] = ciphertext()

    ip_hash: Mapped[bytes | None] = digest(nullable=True, index=True)
    client_label: Mapped[str | None] = mapped_column(String(64))

    # True when the tag was lost at scan time, i.e. contact details were shown.
    revealed_contact: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notified_at: Mapped[dt.datetime | None] = timestamp()

    tag: Mapped[Tag] = relationship(back_populates="scans")


class RelayThread(Base):
    """A masked conversation between a finder and an owner.

    Neither side ever learns the other's address or number. The finder holds a
    relay token (hashed here); the owner sees the thread in their inbox.
    """

    __tablename__ = "relay_threads"

    id: Mapped[uuid.UUID] = uuid_pk()
    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )

    finder_token_hash: Mapped[bytes] = digest(unique=True)

    # Optional callback detail the finder chose to give, sealed like any other
    # personal field. Shown to the owner only, and only as the finder typed it.
    finder_contact_enc: Mapped[bytes | None] = ciphertext()

    # An email address the finder gave to receive the conversation link and a
    # note when the owner replies. Unlike finder_contact it is never shown to
    # the owner: it exists so the finder can follow the thread, not so the
    # owner can reach them. The relay token is kept alongside, sealed, only
    # while email updates are on, because the reply email has to carry the
    # link and the token is otherwise stored as a hash alone.
    finder_email_enc: Mapped[bytes | None] = ciphertext()
    finder_token_enc: Mapped[bytes | None] = ciphertext()
    finder_notified_at: Mapped[dt.datetime | None] = timestamp()

    created_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)
    last_message_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)
    expires_at: Mapped[dt.datetime] = timestamp(nullable=False, index=True)
    closed_at: Mapped[dt.datetime | None] = timestamp()
    owner_read_at: Mapped[dt.datetime | None] = timestamp()

    tag: Mapped[Tag] = relationship(back_populates="threads")
    messages: Mapped[list[RelayMessage]] = relationship(
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="RelayMessage.created_at",
    )


class RelayMessage(Base):
    __tablename__ = "relay_messages"
    __table_args__ = (
        CheckConstraint("sender IN ('finder', 'owner')", name="sender_valid"),
        Index("ix_relay_messages_thread_created", "thread_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    thread_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("relay_threads.id", ondelete="CASCADE"), nullable=False
    )
    sender: Mapped[str] = mapped_column(String(16), nullable=False)
    body_enc: Mapped[bytes] = ciphertext(nullable=False)
    created_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)

    thread: Mapped[RelayThread] = relationship(back_populates="messages")
