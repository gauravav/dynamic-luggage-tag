"""The masked contact relay.

A finder and an owner exchange messages without either learning how to reach
the other directly. The finder holds a relay token; the owner sees a thread in
their inbox. Message bodies are encrypted under the owner's data key like any
other personal field — a stranger's message about someone's lost bag is
personal data about both of them.

Threads expire on their own. A channel to a stranger that stays open forever is
a liability for whichever side stops wanting it first.
"""

from __future__ import annotations

import datetime as dt
import uuid

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import select

from ..errors import ApiError
from ..extensions import app_config, db_session, keyring, limiter
from ..models import RelayMessage, RelayThread, User, utcnow
from ..schemas import RelayReplyIn, parse
from ..security import audit
from ..security.authz import login_required, require_user, user_crypto
from ..security.crypto import DecryptionError, hash_token
from ..security.pii import UserCrypto, unlock
from ..services import notifications

bp = Blueprint("relay", __name__)

MAX_MESSAGES_PER_THREAD = 50


# --------------------------------------------------------------------------
# Owner side
# --------------------------------------------------------------------------


@bp.get("/threads")
@login_required
def list_threads():
    user = require_user()
    crypto = user_crypto()
    threads = (
        db_session()
        .scalars(
            select(RelayThread)
            .where(RelayThread.user_id == user.id)
            .order_by(RelayThread.last_message_at.desc())
            .limit(100)
        )
        .all()
    )

    return jsonify(
        {
            "threads": [
                {
                    "id": str(thread.id),
                    "tag_id": str(thread.tag_id),
                    "tag_label": crypto.read_tag(thread.tag, "label") if thread.tag else None,
                    "opened_at": thread.created_at.isoformat(),
                    "last_message_at": thread.last_message_at.isoformat(),
                    "expires_at": thread.expires_at.isoformat(),
                    "closed": thread.closed_at is not None,
                    "unread": (
                        thread.owner_read_at is None
                        or thread.owner_read_at < thread.last_message_at
                    ),
                    "message_count": len(thread.messages),
                    "preview": _preview(crypto, thread),
                }
                for thread in threads
            ]
        }
    )


@bp.get("/threads/<thread_id>")
@login_required
def read_thread(thread_id: str):
    thread = _owned_thread(thread_id)
    crypto = user_crypto()
    db = db_session()

    thread.owner_read_at = utcnow()
    db.commit()

    return jsonify({"thread": _serialize_thread(thread, crypto, viewer="owner")})


@bp.post("/threads/<thread_id>/reply")
@login_required
@limiter.limit("60 per hour")
def reply_as_owner(thread_id: str):
    payload = parse(request, RelayReplyIn)
    thread = _owned_thread(thread_id)
    user = require_user()
    crypto = user_crypto()
    db = db_session()

    _guard_open(thread)
    _guard_length(thread)

    message = RelayMessage(
        id=uuid.uuid4(), thread_id=thread.id, sender="owner", created_at=utcnow()
    )
    # The ciphertext is bound to the message id, which is assigned here, so the
    # body must be written before the row reaches the database.
    crypto.write_message(message, payload.body)
    db.add(message)

    thread.last_message_at = utcnow()
    thread.owner_read_at = utcnow()
    # Each reply extends the window, so an active conversation is not cut off
    # mid-exchange by a retention clock started when it opened.
    thread.expires_at = utcnow() + dt.timedelta(days=app_config().relay_retention_days)

    audit.record(
        db,
        audit.RELAY_MESSAGE,
        config=app_config(),
        actor_user_id=user.id,
        subject_user_id=user.id,
        tag_id=thread.tag_id,
        actor_type="user",
        detail={"sender": "owner"},
    )
    db.commit()
    return jsonify({"thread": _serialize_thread(thread, crypto, viewer="owner")}), 201


@bp.post("/threads/<thread_id>/close")
@login_required
def close_thread(thread_id: str):
    thread = _owned_thread(thread_id)
    db = db_session()
    thread.closed_at = utcnow()
    db.commit()
    return jsonify({"status": "closed"})


# --------------------------------------------------------------------------
# Finder side — no account, only the relay token
# --------------------------------------------------------------------------


@bp.get("/relay/<relay_token>")
@limiter.limit("60 per hour")
def read_relay(relay_token: str):
    thread, owner, crypto = _resolve_relay(relay_token)
    return jsonify({"thread": _serialize_thread(thread, crypto, viewer="finder")})


@bp.post("/relay/<relay_token>/reply")
@limiter.limit("20 per hour")
def reply_as_finder(relay_token: str):
    payload = parse(request, RelayReplyIn)
    thread, owner, crypto = _resolve_relay(relay_token)
    db = db_session()

    _guard_open(thread)
    _guard_length(thread)

    message = RelayMessage(
        id=uuid.uuid4(), thread_id=thread.id, sender="finder", created_at=utcnow()
    )
    crypto.write_message(message, payload.body)
    db.add(message)

    thread.last_message_at = utcnow()
    thread.expires_at = utcnow() + dt.timedelta(days=app_config().relay_retention_days)

    audit.record(
        db,
        audit.RELAY_MESSAGE,
        config=app_config(),
        subject_user_id=owner.id,
        tag_id=thread.tag_id,
        actor_type="anonymous",
        detail={"sender": "finder"},
    )
    db.commit()

    notifications.notify_relay_message(
        current_app.extensions["mailer"], user=owner, crypto=crypto, config=app_config()
    )
    return jsonify({"thread": _serialize_thread(thread, crypto, viewer="finder")}), 201


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _owned_thread(thread_id: str) -> RelayThread:
    user = require_user()
    try:
        parsed = uuid.UUID(str(thread_id))
    except (ValueError, AttributeError) as exc:
        raise ApiError("not_found", "No such conversation.", status=404) from exc

    thread = db_session().scalar(
        select(RelayThread).where(RelayThread.id == parsed, RelayThread.user_id == user.id)
    )
    if thread is None:
        raise ApiError("not_found", "No such conversation.", status=404)
    return thread


def _resolve_relay(relay_token: str) -> tuple[RelayThread, User, UserCrypto]:
    """Resolves a finder's relay token to a thread and the owner's data key."""
    if not relay_token or len(relay_token) > 128:
        raise ApiError("not_found", "This conversation is no longer available.", status=404)

    config = app_config()
    db = db_session()
    thread = db.scalar(
        select(RelayThread).where(
            RelayThread.finder_token_hash == hash_token(config.token_pepper, "relay", relay_token)
        )
    )
    if thread is None or thread.expires_at <= utcnow():
        raise ApiError("not_found", "This conversation is no longer available.", status=404)

    owner = db.get(User, thread.user_id)
    if owner is None or not owner.is_active:
        raise ApiError("not_found", "This conversation is no longer available.", status=404)

    try:
        crypto = unlock(keyring(), owner)
    except DecryptionError:
        current_app.logger.error("Could not unwrap data key for user %s", owner.id)
        raise ApiError("unavailable", "Could not open that right now.", status=503) from None

    return thread, owner, crypto


def _serialize_thread(thread: RelayThread, crypto: UserCrypto, *, viewer: str) -> dict:
    body: dict = {
        "id": str(thread.id),
        "opened_at": thread.created_at.isoformat(),
        "expires_at": thread.expires_at.isoformat(),
        "closed": thread.closed_at is not None,
        "messages": [
            {
                "id": str(message.id),
                "from": message.sender,
                "at": message.created_at.isoformat(),
                "body": crypto.read_message(message),
                "mine": (message.sender == viewer),
            }
            for message in thread.messages
        ],
    }
    if viewer == "owner":
        # The callback detail the finder typed, shown only to the owner. The
        # finder never sees anything about the owner beyond the name already
        # published on the lost page.
        body["finder_contact"] = crypto.read_thread(thread, "finder_contact")
        body["tag_id"] = str(thread.tag_id)
    return body


def _preview(crypto: UserCrypto, thread: RelayThread) -> str | None:
    if not thread.messages:
        return None
    text = crypto.read_message(thread.messages[-1])
    return text[:120] + ("…" if len(text) > 120 else "")


def _guard_open(thread: RelayThread) -> None:
    if thread.closed_at is not None:
        raise ApiError("thread_closed", "This conversation has been closed.", status=409)
    if thread.expires_at <= utcnow():
        raise ApiError("thread_expired", "This conversation has expired.", status=410)


def _guard_length(thread: RelayThread) -> None:
    if len(thread.messages) >= MAX_MESSAGES_PER_THREAD:
        raise ApiError(
            "thread_full",
            "This conversation has reached its message limit.",
            status=409,
        )
