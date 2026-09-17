"""Append-only audit trail.

Records that something happened and to whom, never what was said. `detail`
is restricted to non-identifying metadata — counts, booleans, record ids — so
the audit log never becomes a second, unencrypted copy of the personal data it
exists to protect.
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from flask import g, has_request_context, request
from sqlalchemy.orm import Session as OrmSession

from ..config import Config
from ..models import AuditEvent, utcnow
from .privacy import client_ip, hash_ip

# Authentication
LOGIN_SUCCEEDED = "auth.login.succeeded"
LOGIN_FAILED = "auth.login.failed"
LOGIN_LOCKED = "auth.login.locked"
LOGOUT = "auth.logout"
PASSWORD_CHANGED = "auth.password.changed"
PASSWORD_RESET_REQUESTED = "auth.password.reset_requested"
PASSWORD_RESET_COMPLETED = "auth.password.reset_completed"
TOTP_ENABLED = "auth.totp.enabled"
TOTP_DISABLED = "auth.totp.disabled"
TOTP_FAILED = "auth.totp.failed"
SESSIONS_REVOKED = "auth.sessions.revoked"

# Account
ACCOUNT_CREATED = "account.created"
ACCOUNT_UPDATED = "account.updated"
ACCOUNT_EXPORTED = "account.exported"
ACCOUNT_DELETED = "account.deleted"
PII_DECRYPTED = "account.pii.decrypted"

# Tags
TAG_CREATED = "tag.created"
TAG_UPDATED = "tag.updated"
TAG_STATUS_CHANGED = "tag.status.changed"
TAG_TOKEN_ROTATED = "tag.token.rotated"
TAG_DELETED = "tag.deleted"
TAG_NFC_BOUND = "tag.nfc.bound"
TAG_NFC_UNBOUND = "tag.nfc.unbound"

# Pre-issuing, by the operator
TAG_CLAIM_ISSUED = "tag.claim.issued"
TAG_CLAIM_WITHDRAWN = "tag.claim.withdrawn"
TAG_CLAIM_TAKEN = "tag.claim.taken"

# Public surface
TAG_SCANNED = "scan.recorded"
CONTACT_REVEALED = "scan.contact_revealed"
RELAY_OPENED = "relay.opened"
RELAY_MESSAGE = "relay.message"

# Values that must never reach the detail column, whatever a caller passes.
_FORBIDDEN_DETAIL_KEYS = frozenset(
    {"email", "name", "phone", "address", "password", "token", "body", "message", "city"}
)


def record(
    db: OrmSession,
    action: str,
    *,
    config: Config,
    actor_user_id: uuid.UUID | None = None,
    subject_user_id: uuid.UUID | None = None,
    tag_id: uuid.UUID | None = None,
    actor_type: str = "system",
    detail: dict[str, Any] | None = None,
) -> AuditEvent:
    safe_detail = _scrub(detail)

    ip_hash = None
    request_id = None
    if has_request_context():
        ip = client_ip(request, trusted_proxy_hops=config.trusted_proxy_hops)
        ip_hash = hash_ip(config.token_pepper, ip)
        request_id = g.get("request_id")

    event = AuditEvent(
        id=uuid.uuid4(),
        at=utcnow(),
        action=action,
        actor_type=actor_type,
        actor_user_id=actor_user_id,
        subject_user_id=subject_user_id,
        tag_id=tag_id,
        ip_hash=ip_hash,
        request_id=request_id,
        detail=safe_detail,
        expires_at=utcnow() + dt.timedelta(days=config.audit_retention_days),
    )
    db.add(event)
    return event


def _scrub(detail: dict[str, Any] | None) -> dict[str, Any] | None:
    """Drops anything personal and anything unserializable.

    A belt-and-braces filter: the call sites are supposed to pass metadata
    only, but an audit log is exactly the place where a careless addition
    would go unnoticed for a long time.
    """
    if not detail:
        return None
    clean: dict[str, Any] = {}
    for key, value in detail.items():
        if key.lower() in _FORBIDDEN_DETAIL_KEYS:
            clean[key] = "[redacted]"
        elif isinstance(value, (bool, int, float)) or value is None:
            clean[key] = value
        elif isinstance(value, uuid.UUID):
            clean[key] = str(value)
        elif isinstance(value, str):
            # Short enum-ish strings only; long free text is a PII risk.
            clean[key] = value[:64] if len(value) <= 64 else "[truncated]"
        elif isinstance(value, (list, tuple)):
            clean[key] = len(value)
        else:
            clean[key] = "[omitted]"
    return clean or None
