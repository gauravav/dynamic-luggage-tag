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

    # What a finder may see once the tag is marked lost. Off by default; the
    # owner opts in field by field. The address is never exposed at all.
    reveal_name: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    reveal_message_relay: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    notify_on_scan: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    scan_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_scan_at: Mapped[dt.datetime | None] = timestamp()
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

    @property
    def is_lost(self) -> bool:
        return self.status == TAG_STATUS_LOST

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None


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
