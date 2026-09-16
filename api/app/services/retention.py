"""Data retention.

Every row that records someone's movements carries an ``expires_at`` set when
it is written, and this module deletes what has passed it. Retention is a
promise the product makes on its scan page; a promise with no job behind it is
just a sentence.

Deletes are hard, not soft: a "deleted" flag on a location history is still a
location history.
"""

from __future__ import annotations

import logging

from sqlalchemy import delete, select
from sqlalchemy.orm import Session as OrmSession

from ..models import AuditEvent, RelayMessage, RelayThread, ScanEvent, utcnow

log = logging.getLogger(__name__)


def purge_expired(db: OrmSession) -> dict[str, int]:
    """Deletes everything past its retention date. Safe to run repeatedly."""
    now = utcnow()
    counts: dict[str, int] = {}

    counts["scan_events"] = (
        db.execute(delete(ScanEvent).where(ScanEvent.expires_at <= now)).rowcount or 0
    )

    # Messages go with their thread via ON DELETE CASCADE.
    expired_threads = db.scalars(select(RelayThread.id).where(RelayThread.expires_at <= now)).all()
    if expired_threads:
        db.execute(delete(RelayMessage).where(RelayMessage.thread_id.in_(expired_threads)))
        db.execute(delete(RelayThread).where(RelayThread.id.in_(expired_threads)))
    counts["relay_threads"] = len(expired_threads)

    counts["audit_events"] = (
        db.execute(
            delete(AuditEvent).where(
                AuditEvent.expires_at.is_not(None), AuditEvent.expires_at <= now
            )
        ).rowcount
        or 0
    )

    db.commit()
    log.info("Retention purge complete: %s", counts)
    return counts


def purge_expired_sessions(db: OrmSession) -> int:
    """Removes sessions that can no longer authenticate anything."""
    from ..models import Session

    now = utcnow()
    result = db.execute(
        delete(Session).where(
            (Session.absolute_expires_at <= now)
            | (Session.idle_expires_at <= now)
            | (Session.revoked_at.is_not(None))
        )
    )
    db.commit()
    return result.rowcount or 0


def purge_expired_email_tokens(db: OrmSession) -> int:
    from ..models import EmailToken

    result = db.execute(delete(EmailToken).where(EmailToken.expires_at <= utcnow()))
    db.commit()
    return result.rowcount or 0
