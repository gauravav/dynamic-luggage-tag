"""The public scan surface.

This is the one part of the system a stranger can reach, so it is written to
give away as little as possible:

* Reading the page has no side effects. Recording a scan is a separate POST
  that the page makes after it renders, which keeps link-preview bots and
  browser prefetches out of the owner's scan history and inbox.
* What comes back depends entirely on the owner's own setting. Marked safe,
  there is no name, no contact, nothing. Marked lost, only the fields the owner
  opted into — and never the address, at any setting.
* The finder is not asked to identify themselves. No account, no cookie, no
  stored IP; sharing a location is an explicit, separate, optional action.
"""

from __future__ import annotations

import datetime as dt
import json
import uuid

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import select

from ..errors import ApiError
from ..extensions import app_config, db_session, keyring, limiter
from ..models import TAG_STATUS_LOST, RelayMessage, RelayThread, ScanEvent, Tag, User, utcnow
from ..schemas import FinderMessageIn, ScanLocationIn, parse
from ..security import audit
from ..security.crypto import DecryptionError, hash_token, new_token
from ..security.pii import unlock
from ..security.privacy import client_ip, client_label, hash_ip
from ..services import geo, notifications
from ..services.geo import CoarseLocation

bp = Blueprint("scan", __name__, url_prefix="/scan")


def _lookup(token: str) -> Tag:
    """Resolves a scan token, or 404s.

    The token is hashed before the lookup, so the query never carries a value
    that would be usable if the query log were read.
    """
    if not token or len(token) > 128:
        raise ApiError("not_found", "This tag is not registered.", status=404)

    config = app_config()
    tag = db_session().scalar(
        select(Tag).where(
            Tag.token_hash == hash_token(config.token_pepper, "tag", token),
            Tag.revoked_at.is_(None),
        )
    )
    if tag is None:
        raise ApiError("not_found", "This tag is not registered.", status=404)
    return tag


def _owner(tag: Tag) -> User | None:
    user = db_session().get(User, tag.user_id)
    return user if user is not None and user.is_active else None


def _public_body(tag: Tag, owner: User | None) -> dict:
    """What a finder is allowed to see, given the tag's current state."""
    body: dict = {
        "status": tag.status,
        "design": tag.design,
        "owner": None,
        "relay_available": False,
        "retention_days": app_config().scan_retention_days,
    }

    if tag.status != TAG_STATUS_LOST or owner is None:
        return body

    if tag.reveal_name:
        try:
            crypto = unlock(keyring(), owner)
            name = crypto.read_user(owner, "name")
        except DecryptionError:
            current_app.logger.error("Could not unwrap data key for user %s", owner.id)
            name = None
        # The name is the only personal field that can ever appear here. Phone,
        # email and address have no path to this response at all.
        body["owner"] = {"name": name} if name else None

    body["relay_available"] = tag.reveal_message_relay
    return body


@bp.get("/<token>")
@limiter.limit("60 per hour")
def read_scan_page(token: str):
    """Read-only. Recording the scan is a separate, explicit POST."""
    tag = _lookup(token)
    return jsonify(_public_body(tag, _owner(tag)))


@bp.post("/<token>/view")
@limiter.limit("20 per hour")
def record_scan(token: str):
    """Records that a person actually opened the page, and notifies the owner.

    Deduplicated against the same scanner's recent scans, and the owner's email
    is additionally cooled down per tag, so a bag drawing a few curious looks
    on a carousel produces one message rather than a stream.
    """
    tag = _lookup(token)
    owner = _owner(tag)
    if owner is None:
        raise ApiError("not_found", "This tag is not registered.", status=404)

    config = app_config()
    db = db_session()

    ip = client_ip(request, trusted_proxy_hops=config.trusted_proxy_hops)
    ip_hash = hash_ip(config.token_pepper, ip)

    duplicate = notifications.recent_duplicate(db, tag, ip_hash, config=config)
    if duplicate is not None:
        db.commit()
        return jsonify({"status": "recorded", "scan_id": str(duplicate.id), "duplicate": True})

    # An edge-provided city, if the deployment has one configured. The finder's
    # own opt-in location is attached separately, by the next endpoint.
    resolved = current_app.extensions["geo_provider"].resolve(request)

    scan = ScanEvent(
        id=uuid.uuid4(),
        tag_id=tag.id,
        occurred_at=utcnow(),
        expires_at=utcnow() + dt.timedelta(days=config.scan_retention_days),
        shared_location=False,
        ip_hash=ip_hash,
        client_label=client_label(request.headers.get("User-Agent")),
        revealed_contact=tag.is_lost,
    )
    db.add(scan)

    try:
        crypto = unlock(keyring(), owner)
    except DecryptionError:
        current_app.logger.error("Could not unwrap data key for user %s", owner.id)
        crypto = None

    if crypto is not None and not resolved.is_empty():
        crypto.write_scan_location(scan, geo_label(resolved))

    tag.scan_count += 1
    tag.last_scan_at = scan.occurred_at

    audit.record(
        db,
        audit.TAG_SCANNED,
        config=config,
        subject_user_id=owner.id,
        tag_id=tag.id,
        actor_type="anonymous",
        detail={"revealed": tag.is_lost},
    )
    if tag.is_lost:
        audit.record(
            db,
            audit.CONTACT_REVEALED,
            config=config,
            subject_user_id=owner.id,
            tag_id=tag.id,
            actor_type="anonymous",
        )

    notified = False
    if crypto is not None and notifications.should_notify(tag, owner, config=config):
        notified = notifications.notify_scan(
            current_app.extensions["mailer"],
            user=owner,
            crypto=crypto,
            tag=tag,
            location=resolved,
            revealed_contact=tag.is_lost,
            config=config,
        )
        if notified:
            tag.last_notified_at = utcnow()
            scan.notified_at = utcnow()

    db.commit()
    return jsonify({"status": "recorded", "scan_id": str(scan.id), "duplicate": False})


@bp.post("/<token>/location")
@limiter.limit("20 per hour")
def share_location(token: str):
    """Attaches a coarse location the finder chose to share.

    Opt-in and one-time. Nothing finer than a city is accepted, and declining
    changes nothing else about the page.
    """
    payload = parse(request, ScanLocationIn)
    tag = _lookup(token)
    owner = _owner(tag)
    if owner is None:
        raise ApiError("not_found", "This tag is not registered.", status=404)

    if not payload.share:
        return jsonify({"status": "declined"})

    config = app_config()
    db = db_session()

    declared = geo.sanitize_declared(payload.city, payload.region, payload.country)
    resolved = current_app.extensions["geo_provider"].resolve(request)
    location = declared if not declared.is_empty() else resolved
    if location.is_empty():
        return jsonify({"status": "no_location"})

    ip_hash = hash_ip(
        config.token_pepper, client_ip(request, trusted_proxy_hops=config.trusted_proxy_hops)
    )
    scan = notifications.recent_duplicate(db, tag, ip_hash, config=config)
    if scan is None:
        scan = ScanEvent(
            id=uuid.uuid4(),
            tag_id=tag.id,
            occurred_at=utcnow(),
            expires_at=utcnow() + dt.timedelta(days=config.scan_retention_days),
            ip_hash=ip_hash,
            client_label=client_label(request.headers.get("User-Agent")),
            revealed_contact=tag.is_lost,
        )
        db.add(scan)

    try:
        crypto = unlock(keyring(), owner)
    except DecryptionError:
        db.rollback()
        raise ApiError("unavailable", "Could not record that right now.", status=503) from None

    crypto.write_scan_location(scan, geo_label(location))
    scan.shared_location = True
    db.commit()
    return jsonify({"status": "shared", "location": location.label()})


@bp.post("/<token>/message")
@limiter.limit("5 per hour; 15 per day")
def send_message(token: str):
    """Opens a masked conversation with the owner.

    Returns a relay token that lets the finder follow the thread without an
    account. Neither side ever sees the other's address or number.
    """
    payload = parse(request, FinderMessageIn)
    tag = _lookup(token)
    owner = _owner(tag)
    if owner is None:
        raise ApiError("not_found", "This tag is not registered.", status=404)

    if not tag.is_lost or not tag.reveal_message_relay:
        # Messaging exists so a found bag can get home. It is not a channel to
        # a stranger who has not asked to be contacted.
        raise ApiError(
            "relay_unavailable",
            "The owner has not enabled messages for this tag.",
            status=403,
        )

    config = app_config()
    db = db_session()

    try:
        crypto = unlock(keyring(), owner)
    except DecryptionError:
        current_app.logger.error("Could not unwrap data key for user %s", owner.id)
        raise ApiError("unavailable", "Could not send that right now.", status=503) from None

    relay_token = new_token(32)
    thread = RelayThread(
        id=uuid.uuid4(),
        tag_id=tag.id,
        user_id=owner.id,
        finder_token_hash=hash_token(config.token_pepper, "relay", relay_token),
        created_at=utcnow(),
        last_message_at=utcnow(),
        expires_at=utcnow() + dt.timedelta(days=config.relay_retention_days),
    )
    # Encrypted fields are written before the row is added. Their associated
    # data is built from the primary key, which is assigned here rather than by
    # the database, so no flush is needed — and flushing first would try to
    # insert a NOT NULL ciphertext column that has not been filled in yet.
    crypto.write_thread(thread, "finder_contact", payload.contact or None)
    db.add(thread)

    message = RelayMessage(
        id=uuid.uuid4(), thread_id=thread.id, sender="finder", created_at=utcnow()
    )
    crypto.write_message(message, payload.body)
    db.add(message)

    audit.record(
        db,
        audit.RELAY_OPENED,
        config=config,
        subject_user_id=owner.id,
        tag_id=tag.id,
        actor_type="anonymous",
        detail={"has_contact": bool(payload.contact)},
    )
    db.commit()

    notifications.notify_relay_message(
        current_app.extensions["mailer"], user=owner, crypto=crypto, config=config
    )

    return jsonify(
        {
            "status": "sent",
            "relay_token": relay_token,
            "expires_at": thread.expires_at.isoformat(),
        }
    ), 201


def geo_label(location: CoarseLocation) -> str:
    """Serialises a coarse location for encrypted storage."""
    return json.dumps(location.to_dict(), separators=(",", ":"), sort_keys=True)
