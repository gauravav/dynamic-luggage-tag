"""Creating and finding accounts.

Concentrates every step that must happen together when an account is made: a
fresh data key, the wrapped copy of it, the blind index, and the first
encrypted fields. Splitting these across call sites is how a user ends up with
an unwrapped key or an unindexed address.
"""

from __future__ import annotations

import datetime as dt
import secrets
import uuid

from argon2 import PasswordHasher
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..config import Config
from ..core import design as design_module
from ..models import EmailToken, RecoveryCode, User, utcnow
from ..security import crypto
from ..security.passwords import hash_password
from ..security.pii import UserCrypto
from . import claims

RECOVERY_CODE_COUNT = 10
EMAIL_TOKEN_TTL = dt.timedelta(hours=24)
RESET_TOKEN_TTL = dt.timedelta(minutes=30)

# How long a verification email must be left alone before another is sent.
# Enforced per account rather than per client, so it cannot be sidestepped by
# changing network — the cost falls on the mailbox, so the mailbox is what is
# protected.
VERIFICATION_RESEND_INTERVAL = dt.timedelta(minutes=10)


def find_by_email(db: OrmSession, email: str, *, config: Config) -> User | None:
    """Looks an account up by its blind index, not by a plaintext column."""
    index = crypto.blind_index(config.blind_index_key, "user.email", crypto.normalize_email(email))
    return db.scalar(select(User).where(User.email_bidx == index, User.deleted_at.is_(None)))


def create_user(
    db: OrmSession,
    *,
    email: str,
    password: str,
    name: str | None,
    config: Config,
    keyring: crypto.Keyring,
    hasher: PasswordHasher,
) -> tuple[User, UserCrypto]:
    user_id = uuid.uuid4()
    dek = crypto.new_key()
    wrapped, version = keyring.wrap(dek, owner_id=user_id)
    user_crypto = UserCrypto(user_id=user_id, dek=dek)

    # A tag may already have been printed and shipped to this address. If so it
    # has fixed artwork, and the account adopts its seed rather than generating
    # one the printed tag would not match.
    waiting = claims.pending_for(db, email, config=config)

    user = User(
        id=user_id,
        email_bidx=crypto.blind_index(
            config.blind_index_key, "user.email", crypto.normalize_email(email)
        ),
        password_hash=hash_password(hasher, password),
        dek_wrapped=wrapped,
        dek_version=version,
        design_seed=claims.seed_for_new_user(waiting) or design_module.new_seed(),
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    # The address is stored as the user typed it; only the index is normalized.
    user_crypto.write_user(user, "email", email.strip())
    user_crypto.write_user(user, "name", name)
    db.add(user)
    db.flush()

    for claim in waiting:
        claims.materialise(db, claim, user=user, user_crypto=user_crypto, keyring=keyring)

    return user, user_crypto


def issue_email_token(db: OrmSession, user: User, purpose: str, *, config: Config) -> str:
    """Creates a single-use token and returns the plaintext once."""
    ttl = EMAIL_TOKEN_TTL if purpose == "verify_email" else RESET_TOKEN_TTL
    token = crypto.new_token(32)

    # One live token per purpose: an old link in an old inbox should not still
    # work after a new one is requested.
    for existing in db.scalars(
        select(EmailToken).where(
            EmailToken.user_id == user.id,
            EmailToken.purpose == purpose,
            EmailToken.used_at.is_(None),
        )
    ).all():
        existing.used_at = utcnow()

    db.add(
        EmailToken(
            id=uuid.uuid4(),
            user_id=user.id,
            purpose=purpose,
            token_hash=crypto.hash_token(config.token_pepper, f"email.{purpose}", token),
            created_at=utcnow(),
            expires_at=utcnow() + ttl,
        )
    )
    return token


def last_email_token_at(db: OrmSession, user: User, purpose: str) -> dt.datetime | None:
    """When a token of this purpose was last issued, used or not."""
    return db.scalar(
        select(EmailToken.created_at)
        .where(EmailToken.user_id == user.id, EmailToken.purpose == purpose)
        .order_by(EmailToken.created_at.desc())
        .limit(1)
    )


def consume_email_token(db: OrmSession, token: str, purpose: str, *, config: Config) -> User | None:
    """Validates and burns a token, returning its user."""
    token_hash = crypto.hash_token(config.token_pepper, f"email.{purpose}", token)
    record = db.scalar(
        select(EmailToken).where(EmailToken.token_hash == token_hash, EmailToken.purpose == purpose)
    )
    if record is None or record.used_at is not None or record.expires_at <= utcnow():
        return None
    record.used_at = utcnow()
    user = db.get(User, record.user_id)
    if user is None or not user.is_active:
        return None
    return user


def generate_recovery_codes(db: OrmSession, user: User, *, hasher: PasswordHasher) -> list[str]:
    """Replaces the user's recovery codes, returning the plaintext set once."""
    for existing in db.scalars(select(RecoveryCode).where(RecoveryCode.user_id == user.id)).all():
        db.delete(existing)

    codes: list[str] = []
    for _ in range(RECOVERY_CODE_COUNT):
        # Grouped for legibility on paper; the dash is cosmetic and stripped
        # before comparison.
        raw = f"{secrets.token_hex(3)}-{secrets.token_hex(3)}"
        codes.append(raw)
        db.add(
            RecoveryCode(
                id=uuid.uuid4(),
                user_id=user.id,
                # Argon2 rather than HMAC: these are short and low-entropy
                # enough that a database leak would otherwise be brute-forceable.
                code_hash=hash_password(hasher, _normalize_code(raw)),
                created_at=utcnow(),
            )
        )
    return codes


def consume_recovery_code(
    db: OrmSession, user: User, candidate: str, *, hasher: PasswordHasher
) -> bool:
    from ..security.passwords import verify_password

    normalized = _normalize_code(candidate)
    for record in db.scalars(
        select(RecoveryCode).where(RecoveryCode.user_id == user.id, RecoveryCode.used_at.is_(None))
    ).all():
        if verify_password(hasher, record.code_hash, normalized):
            record.used_at = utcnow()
            return True
    return False


def _normalize_code(code: str) -> str:
    return "".join(ch for ch in code.lower() if ch.isalnum())


def crypto_shred(db: OrmSession, user: User) -> None:
    """Destroys the user's key material, then the rows themselves.

    Overwriting the wrapped data key first is what makes the deletion hold: any
    ciphertext that survives in a replica or a backup has no path back to a
    plaintext, because the only copy of the key that could open it is gone.
    """
    user.dek_wrapped = b"\x00" * 32
    user.email_enc = b""
    user.name_enc = None
    user.phone_enc = None
    user.address_enc = None
    user.totp_secret_enc = None
    # Free the unique index so the address can be used to register again.
    user.email_bidx = crypto.new_key()
    user.password_hash = ""
    user.deleted_at = utcnow()
    db.flush()
    db.delete(user)
