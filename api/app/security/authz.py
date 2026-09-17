"""Request identity and access control."""

from __future__ import annotations

import functools
import uuid
from collections.abc import Callable

from flask import g, request
from sqlalchemy import select

from ..errors import ApiError
from ..extensions import app_config, db_session, keyring
from ..models import Session, Tag, User
from . import sessions as session_service
from .crypto import blind_index, constant_time_equals, normalize_email
from .csrf import CsrfError
from .csrf import verify as verify_csrf
from .pii import UserCrypto, unlock


def load_identity() -> None:
    """Resolves the session cookie, then enforces CSRF. Runs before each request.

    Order matters: CSRF is checked only once a session is known, because a
    request with no session has no ambient authority to forge against.
    """
    g.current_session = None
    g.current_user = None
    g.user_crypto = None

    config = app_config()
    db = db_session()

    session = session_service.load(
        db, session_service.read_token(request, config=config), config=config
    )

    try:
        verify_csrf(request, session, config=config)
    except CsrfError as exc:
        raise ApiError("csrf_failed", str(exc), status=403) from exc

    if session is None:
        return

    user = db.get(User, session.user_id)
    if user is None or not user.is_active:
        session_service.revoke(db, session)
        return

    g.current_session = session
    g.current_user = user


def current_user() -> User | None:
    return g.get("current_user")


def current_session() -> Session | None:
    return g.get("current_session")


def require_user() -> User:
    user = current_user()
    if user is None:
        raise ApiError("unauthenticated", "Sign in to continue.", status=401)
    return user


def user_crypto() -> UserCrypto:
    """The signed-in user's unwrapped data key, cached for this request only."""
    crypto = g.get("user_crypto")
    if crypto is None:
        crypto = unlock(keyring(), require_user())
        g.user_crypto = crypto
    return crypto


def login_required(view: Callable) -> Callable:
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        require_user()
        return view(*args, **kwargs)

    return wrapper


def verified_email_required(view: Callable) -> Callable:
    """Gates actions that put an address in front of a stranger.

    A tag cannot be marked lost from an unverified account: that is the one
    action that publishes a name to anyone who scans the bag, and it should not
    be reachable by someone who signed up with an address they do not control.
    """

    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        user = require_user()
        if user.email_verified_at is None:
            raise ApiError(
                "email_unverified",
                "Verify your email address before using this feature.",
                status=403,
            )
        return view(*args, **kwargs)

    return wrapper


def is_admin(user: User | None = None) -> bool:
    """Whether this account is the one named in DLT_ADMIN_EMAIL.

    Compared as a blind index, so answering the question never decrypts an
    address — and an operator who has not set the variable has no admin at all
    rather than a default one.
    """
    config = app_config()
    if not config.admin_email:
        return False
    subject = user or current_user()
    if subject is None or not subject.is_active:
        return False
    expected = blind_index(
        config.blind_index_key, "user.email", normalize_email(config.admin_email)
    )
    return constant_time_equals(bytes(subject.email_bidx), expected)


def admin_required(view: Callable) -> Callable:
    """Gates the pre-issuing surface.

    A confirmed address is required as well as the right one: the whole point
    of naming the admin in the environment is that the privilege follows an
    address somebody has proven they control.
    """

    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        user = require_user()
        if not is_admin(user) or user.email_verified_at is None:
            # 404, not 403. A 403 confirms the route exists and that this
            # account is simply not the one, which is a question nobody who is
            # not the admin needs answered.
            raise ApiError("not_found", "Not found.", status=404)
        return view(*args, **kwargs)

    return wrapper


def owned_tag(tag_id: uuid.UUID | str) -> Tag:
    """Fetches a tag that belongs to the signed-in user.

    A tag owned by someone else returns 404 rather than 403: telling a caller
    that an id exists but is not theirs confirms the id, which is an
    enumeration oracle over every tag in the system.
    """
    user = require_user()
    try:
        tag_uuid = uuid.UUID(str(tag_id))
    except (ValueError, AttributeError) as exc:
        raise ApiError("not_found", "No such tag.", status=404) from exc

    tag = db_session().scalar(
        select(Tag).where(Tag.id == tag_uuid, Tag.user_id == user.id, Tag.revoked_at.is_(None))
    )
    if tag is None:
        raise ApiError("not_found", "No such tag.", status=404)
    return tag
