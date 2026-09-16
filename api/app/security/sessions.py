"""Server-side sessions backed by opaque cookies.

Deliberately not JWTs. A signed token that the server does not track cannot be
revoked before it expires, which makes "sign out everywhere", "sign out after
a password change" and "this device was stolen" impossible to honour. Here the
cookie is a random string with no meaning; authority lives in a row that can be
deleted.

The row stores only an HMAC of the token, so a database dump yields no usable
cookies.
"""

from __future__ import annotations

import datetime as dt
import uuid

from flask import Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from ..config import Config
from ..models import Session, User, utcnow
from .crypto import hash_token, new_token
from .privacy import client_ip, client_label, hash_ip

SESSION_COOKIE = "dlt_session"
CSRF_COOKIE = "dlt_csrf"
CSRF_HEADER = "X-CSRF-Token"


# __Host- binds a cookie to exactly one origin: it must be Secure, Path=/ and
# carry no Domain, which stops a sibling subdomain from setting or shadowing
# it. The prefix requires HTTPS, so plain-HTTP local development drops it.
def cookie_name(base: str, *, secure: bool) -> str:
    return f"__Host-{base}" if secure else base


def issue(
    db: OrmSession,
    user: User,
    *,
    config: Config,
    request: Request,
) -> tuple[Session, str]:
    """Creates a session row and returns it with the plaintext token.

    The token is returned once, to be written into the cookie. It is never
    stored, logged or recoverable afterwards.
    """
    now = utcnow()
    token = new_token(32)
    ip = client_ip(request, trusted_proxy_hops=config.trusted_proxy_hops)

    session = Session(
        id=uuid.uuid4(),
        user_id=user.id,
        token_hash=hash_token(config.token_pepper, "session", token),
        csrf_token=new_token(24),
        created_at=now,
        last_seen_at=now,
        idle_expires_at=now + dt.timedelta(minutes=config.session_idle_minutes),
        absolute_expires_at=now + dt.timedelta(hours=config.session_absolute_hours),
        ip_hash=hash_ip(config.token_pepper, ip),
        client_label=client_label(request.headers.get("User-Agent")),
    )
    db.add(session)
    _prune_oldest(db, user, keep=config.max_sessions_per_user)
    return session, token


def _prune_oldest(db: OrmSession, user: User, *, keep: int) -> None:
    """Caps concurrent sessions so an unnoticed old login cannot linger."""
    live = db.scalars(
        select(Session)
        .where(Session.user_id == user.id, Session.revoked_at.is_(None))
        .order_by(Session.created_at.desc())
    ).all()
    for stale in live[keep:]:
        stale.revoked_at = utcnow()


def load(db: OrmSession, token: str | None, *, config: Config) -> Session | None:
    """Resolves a cookie value to a live session, sliding its idle window."""
    if not token:
        return None
    token_hash = hash_token(config.token_pepper, "session", token)
    session = db.scalar(select(Session).where(Session.token_hash == token_hash))
    if session is None:
        return None

    now = utcnow()
    if session.revoked_at is not None:
        return None
    if session.idle_expires_at <= now or session.absolute_expires_at <= now:
        session.revoked_at = now
        return None

    # Write the sliding expiry at most once a minute: every authenticated
    # request would otherwise issue an UPDATE just to move a timestamp.
    if (now - session.last_seen_at) > dt.timedelta(minutes=1):
        session.last_seen_at = now
        session.idle_expires_at = min(
            now + dt.timedelta(minutes=config.session_idle_minutes),
            session.absolute_expires_at,
        )
    return session


def revoke(db: OrmSession, session: Session) -> None:
    session.revoked_at = utcnow()


def revoke_all_for_user(
    db: OrmSession, user_id: uuid.UUID, *, except_id: uuid.UUID | None = None
) -> int:
    """Signs a user out of every device. Used after a password or 2FA change."""
    now = utcnow()
    sessions = db.scalars(
        select(Session).where(Session.user_id == user_id, Session.revoked_at.is_(None))
    ).all()
    count = 0
    for session in sessions:
        if except_id is not None and session.id == except_id:
            continue
        session.revoked_at = now
        count += 1
    return count


def attach_cookies(response: Response, session: Session, token: str, *, config: Config) -> None:
    secure = config.cookie_secure
    max_age = int((session.absolute_expires_at - utcnow()).total_seconds())

    response.set_cookie(
        cookie_name(SESSION_COOKIE, secure=secure),
        token,
        max_age=max_age,
        httponly=True,  # unreachable from JavaScript, so XSS cannot read it
        secure=secure,
        samesite="Strict",  # not sent on any cross-site navigation
        path="/",
    )
    # Readable by the frontend on purpose: it is echoed back in a header, and
    # only a same-origin script can read a cookie to echo it.
    response.set_cookie(
        cookie_name(CSRF_COOKIE, secure=secure),
        session.csrf_token,
        max_age=max_age,
        httponly=False,
        secure=secure,
        samesite="Strict",
        path="/",
    )


def clear_cookies(response: Response, *, config: Config) -> None:
    secure = config.cookie_secure
    for base in (SESSION_COOKIE, CSRF_COOKIE):
        response.delete_cookie(
            cookie_name(base, secure=secure), path="/", secure=secure, samesite="Strict"
        )


def read_token(request: Request, *, config: Config) -> str | None:
    return request.cookies.get(cookie_name(SESSION_COOKIE, secure=config.cookie_secure))
