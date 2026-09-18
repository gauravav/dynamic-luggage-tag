"""User, session, credential and audit records.

Personal fields live in ``*_enc`` columns sealed with the user's own data key.
The only searchable derivative of a personal field is ``email_bidx``, a keyed
HMAC — enough to find an account at login, useless for recovering the address.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, Integer, SmallInteger, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, ciphertext, digest, timestamp, uuid_pk

if TYPE_CHECKING:
    from .tag import Tag


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()

    # Lookup index over the normalized address. Unique, so one address is one
    # account, without the address itself ever being stored in the clear.
    email_bidx: Mapped[bytes] = digest(unique=True)

    email_enc: Mapped[bytes] = ciphertext(nullable=False)
    name_enc: Mapped[bytes | None] = ciphertext()
    phone_enc: Mapped[bytes | None] = ciphertext()
    address_enc: Mapped[bytes | None] = ciphertext()

    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)

    # The user's data key, wrapped by the KEK version named here. Dropping this
    # column's value renders every *_enc field above permanently unreadable.
    dek_wrapped: Mapped[bytes] = mapped_column(nullable=False)
    dek_version: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=1)

    # Seeds the visual design. Random, never derived from personal data — a
    # design derived from a name would leak the name.
    design_seed: Mapped[bytes] = mapped_column(nullable=False)

    totp_secret_enc: Mapped[bytes | None] = ciphertext()
    totp_enabled_at: Mapped[dt.datetime | None] = timestamp()

    email_verified_at: Mapped[dt.datetime | None] = timestamp()
    notify_on_scan: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    failed_login_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[dt.datetime | None] = timestamp()

    created_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)
    updated_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)
    deleted_at: Mapped[dt.datetime | None] = timestamp()

    tags: Mapped[list[Tag]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin"
    )
    sessions: Mapped[list[Session]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def is_active(self) -> bool:
        return self.deleted_at is None

    @property
    def totp_enabled(self) -> bool:
        return self.totp_enabled_at is not None and self.totp_secret_enc is not None


class Session(Base):
    """A server-side session. The cookie carries a random token; only its HMAC
    is stored, so a database dump cannot be replayed as a login."""

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[bytes] = digest(unique=True)

    # Double-submit value. Not a bearer credential on its own — it is only
    # meaningful paired with the session cookie it was issued alongside.
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)
    last_seen_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)
    idle_expires_at: Mapped[dt.datetime] = timestamp(nullable=False, index=True)
    absolute_expires_at: Mapped[dt.datetime] = timestamp(nullable=False)
    revoked_at: Mapped[dt.datetime | None] = timestamp()

    # Coarse client fingerprints for the "your sessions" screen. The IP is
    # hashed; the user agent is reduced to a family name, never stored raw.
    ip_hash: Mapped[bytes | None] = digest(nullable=True)
    client_label: Mapped[str | None] = mapped_column(String(64))

    user: Mapped[User] = relationship(back_populates="sessions")


class EmailToken(Base):
    """Single-use token for address verification and password reset."""

    __tablename__ = "email_tokens"
    __table_args__ = (
        CheckConstraint("purpose IN ('verify_email', 'reset_password')", name="purpose_valid"),
        Index("ix_email_tokens_user_purpose", "user_id", "purpose"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    purpose: Mapped[str] = mapped_column(String(32), nullable=False)
    token_hash: Mapped[bytes] = digest(unique=True)
    created_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)
    expires_at: Mapped[dt.datetime] = timestamp(nullable=False, index=True)
    used_at: Mapped[dt.datetime | None] = timestamp()


class PendingLogin(Base):
    """A password check that is waiting on a second factor.

    Signing in with two-factor on is two requests: the password, then the code.
    Both used to demand their own bot check, so the same person proved they
    were a person twice, thirty seconds apart, to complete one sign-in.

    The first request issues one of these. Presenting it with the code is what
    lets the second request skip the check — it is proof that a human passed
    one moments ago, for this account. It is not a credential: on its own it
    grants nothing, because the second request still carries the password and
    still has to produce a valid code.

    Single-use and short-lived, and only the hash is stored, like every other
    bearer token here.
    """

    __tablename__ = "pending_logins"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[bytes] = digest(unique=True)
    created_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)
    expires_at: Mapped[dt.datetime] = timestamp(nullable=False, index=True)
    used_at: Mapped[dt.datetime | None] = timestamp()


class RecoveryCode(Base):
    """One-time code for signing in when the authenticator is unavailable."""

    __tablename__ = "recovery_codes"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    created_at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False)
    used_at: Mapped[dt.datetime | None] = timestamp()


class AuditEvent(Base):
    """Append-only record of security-relevant actions.

    ``detail`` is deliberately restricted to non-identifying metadata: counts,
    booleans, record ids. Never a name, an address, or a message body.
    """

    __tablename__ = "audit_events"
    __table_args__ = (Index("ix_audit_events_subject_at", "subject_user_id", "at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    at: Mapped[dt.datetime] = timestamp(default_now=True, nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    actor_type: Mapped[str] = mapped_column(String(16), nullable=False, default="system")
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    subject_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    tag_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    ip_hash: Mapped[bytes | None] = digest(nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64))
    detail: Mapped[dict | None] = mapped_column(JSONB)
    expires_at: Mapped[dt.datetime | None] = timestamp(index=True)
