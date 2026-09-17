"""Tags issued to an address before that address has an account.

The operator prints and ships physical tags. That happens first, so a scan
code has to exist and be printable while there is still no user to own it —
and therefore no data key to seal it under.

A claim solves that by carrying its own data key, wrapped by the same keyring
that wraps a user's. Everything personal about it is sealed under that key:
the address it was issued to, the scan token, the label. When the address
registers, `materialise` turns the claim into a real tag sealed under the new
owner's key and destroys the claim's own copy, so the same data never sits
under two keys for longer than one transaction.

Two rules keep the artwork honest. A tag printed in advance has fixed artwork,
so the claim chooses the design seed and the account adopts it at registration.
And where the address already has an account, there is no claim at all — the
tag is created directly, under that account's existing seed, because its
artwork is already decided.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..config import Config
from ..core import design as design_module
from ..models import Tag, TagClaim, User, utcnow
from ..security import crypto
from ..security.crypto import Keyring, decrypt_field, encrypt_field, field_aad
from ..security.pii import UserCrypto


def _aad(claim_id: uuid.UUID, column: str) -> bytes:
    return field_aad("tag_claims", column, claim_id)


def issue(
    db: OrmSession,
    *,
    email: str,
    label: str | None,
    icon: str | None,
    icon_color: str | None,
    config: Config,
    keyring: Keyring,
    issued_by: uuid.UUID | None,
) -> tuple[TagClaim, str]:
    """Creates a claim, returning it with the plaintext scan token once.

    The token is returned so the caller can render a printable tag, and is
    never returned again — only its hash and a sealed copy are kept.
    """
    claim_id = uuid.uuid4()
    dek = crypto.new_key()
    wrapped, version = keyring.wrap(dek, owner_id=claim_id)
    token = crypto.new_token(32)
    normalized = crypto.normalize_email(email)

    claim = TagClaim(
        id=claim_id,
        email_bidx=crypto.blind_index(config.blind_index_key, "user.email", normalized),
        email_enc=encrypt_field(dek, email, _aad(claim_id, "email")),
        dek_wrapped=wrapped,
        dek_version=version,
        token_hash=crypto.hash_token(config.token_pepper, "tag", token),
        token_enc=encrypt_field(dek, token, _aad(claim_id, "token")),
        # Chosen now, because the artwork is about to be printed. The account
        # adopts it when it registers, so the traveller still has one design.
        design_seed=_seed_for(db, config, normalized),
        label_enc=encrypt_field(dek, label, _aad(claim_id, "label")),
        icon=icon,
        icon_color=icon_color,
        created_at=utcnow(),
        issued_by=issued_by,
    )
    db.add(claim)
    return claim, token


def _seed_for(db: OrmSession, config: Config, normalized_email: str) -> bytes:
    """The design seed a tag for this address must be printed with.

    Three cases, in order. An address that already has an account keeps that
    account's seed, because its artwork is decided and a new tag has to match
    the ones already on their bags. An address with claims outstanding reuses
    their seed, so a second tag ordered a month later comes off the press
    matching the first. Only a genuinely new address gets a new seed.

    Note what this does not do: ``design_seed`` is a plain column, so finding
    an existing account's seed never unwraps their data key. Pre-issuing a tag
    to someone is not a route into their account.
    """
    index = crypto.blind_index(config.blind_index_key, "user.email", normalized_email)

    owner = db.scalar(select(User).where(User.email_bidx == index, User.deleted_at.is_(None)))
    if owner is not None:
        return bytes(owner.design_seed)

    outstanding = db.scalar(
        select(TagClaim)
        .where(TagClaim.email_bidx == index, TagClaim.claimed_at.is_(None))
        .order_by(TagClaim.created_at)
    )
    return bytes(outstanding.design_seed) if outstanding else design_module.new_seed()


def read(claim: TagClaim, column: str, *, keyring: Keyring) -> str | None:
    """Decrypts one of a claim's sealed fields."""
    dek = keyring.unwrap(bytes(claim.dek_wrapped), claim.dek_version, owner_id=claim.id)
    return decrypt_field(dek, getattr(claim, f"{column}_enc"), _aad(claim.id, column))


def pending_for_index(db: OrmSession, email_bidx: bytes) -> list[TagClaim]:
    """Unclaimed claims for an address index, oldest first.

    Takes the index rather than the address so a signed-in user's pending tags
    can be found without decrypting anything: ``users.email_bidx`` is already
    the value this matches against.
    """
    return list(
        db.scalars(
            select(TagClaim)
            .where(TagClaim.email_bidx == bytes(email_bidx), TagClaim.claimed_at.is_(None))
            .order_by(TagClaim.created_at)
        ).all()
    )


def pending_for(db: OrmSession, email: str, *, config: Config) -> list[TagClaim]:
    """Unclaimed claims for an address, oldest first."""
    index = crypto.blind_index(config.blind_index_key, "user.email", crypto.normalize_email(email))
    return pending_for_index(db, index)


def seed_for_new_user(claims: list[TagClaim]) -> bytes | None:
    """The seed a new account should adopt, if tags were printed for it."""
    return bytes(claims[0].design_seed) if claims else None


def materialise(
    db: OrmSession,
    claim: TagClaim,
    *,
    user: User,
    user_crypto: UserCrypto,
    keyring: Keyring,
) -> Tag:
    """Turns a claim into a tag the account owns.

    The token moves from the claim's key to the owner's, and the claim's own
    copies of everything personal are destroyed in the same transaction — a
    claim is the operator's data only while it has no owner.
    """
    dek = keyring.unwrap(bytes(claim.dek_wrapped), claim.dek_version, owner_id=claim.id)
    token = decrypt_field(dek, claim.token_enc, _aad(claim.id, "token"))
    label = decrypt_field(dek, claim.label_enc, _aad(claim.id, "label"))
    if token is None:
        raise ValueError(f"claim {claim.id} has no readable token")

    tag = Tag(
        id=uuid.uuid4(),
        # The relationship, not just the foreign key: the caller goes on to
        # read `user.tags` in the same request, and setting only `user_id`
        # leaves that collection unaware of the row we just added.
        user=user,
        token_hash=bytes(claim.token_hash),
        token_version=1,
        status="safe",
        design=design_module.generate(bytes(user.design_seed)).to_dict(),
        icon=claim.icon,
        icon_color=claim.icon_color,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    user_crypto.write_tag(tag, "token", token)
    user_crypto.write_tag(tag, "label", label)
    db.add(tag)
    db.flush()

    claim.claimed_at = utcnow()
    claim.claimed_tag_id = tag.id
    # Nothing readable is left on the claim. The row stays as a record that
    # this code was issued and to whom it went, which the operator needs; the
    # contents belong to the owner now and live under their key alone.
    claim.email_enc = b""
    claim.token_enc = b""
    claim.label_enc = None
    claim.dek_wrapped = b"\x00" * 32
    return tag
