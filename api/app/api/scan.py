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
from dataclasses import dataclass

from flask import Blueprint, current_app, jsonify, request
from sqlalchemy import select

from ..errors import ApiError
from ..extensions import app_config, db_session, keyring, limiter
from ..models import (
    NAME_ALWAYS,
    TAG_STATUS_LOST,
    RelayMessage,
    RelayThread,
    RetiredToken,
    ScanEvent,
    Tag,
    TagClaim,
    User,
    utcnow,
)
from ..schemas import FinderMessageIn, ScanLocationIn, parse
from ..security import audit, turnstile
from ..security.crypto import DecryptionError, hash_token, new_token
from ..security.pii import unlock
from ..security.privacy import client_ip, client_label, hash_ip
from ..services import geo, notifications
from ..services.geo import CoarseLocation

bp = Blueprint("scan", __name__, url_prefix="/scan")


@dataclass(frozen=True)
class Resolved:
    """A tag, and whether the code used to reach it is the current one.

    `retired` is the whole reason this is a pair rather than a Tag. A retired
    code still resolves — the bag it is printed on may never have been
    reprinted — but it is answered with less.
    """

    tag: Tag
    retired: bool


def _lookup(token: str) -> Resolved:
    """Resolves a scan token, current or retired, or 404s.

    The token is hashed before the lookup, so the query never carries a value
    that would be usable if the query log were read.
    """
    if not token or len(token) > 128:
        raise ApiError("not_found", "This tag is not registered.", status=404)

    config = app_config()
    db = db_session()
    token_hash = hash_token(config.token_pepper, "tag", token)

    tag = db.scalar(select(Tag).where(Tag.token_hash == token_hash, Tag.revoked_at.is_(None)))
    if tag is not None:
        return Resolved(tag, retired=False)

    # Not the current code. It may still be one this tag used to answer to —
    # the code printed on a bag that was never reprinted after a rotation.
    retired = db.scalar(select(RetiredToken).where(RetiredToken.token_hash == token_hash))
    if retired is not None and retired.tag.revoked_at is None:
        if retired.tag.block_retired_tokens:
            # The owner has reprinted and asked for the old codes to stop.
            raise ApiError("not_found", "This tag is not registered.", status=404)
        return Resolved(retired.tag, retired=True)

    # A tag that was printed and shipped before anyone signed up for it. "Not
    # registered" would be true but useless — this is somebody's new tag, and
    # the thing they need to know is that it works and how to finish it.
    unclaimed = db.scalar(
        select(TagClaim).where(TagClaim.token_hash == token_hash, TagClaim.claimed_at.is_(None))
    )
    if unclaimed is not None:
        raise ApiError(
            "tag_not_set_up",
            "This tag has not been set up yet. Create an account with the address it was "
            "sent to, and it will be waiting.",
            status=409,
        )

    raise ApiError("not_found", "This tag is not registered.", status=404)


def _note_stale_read(tag: Tag) -> None:
    """Counts a read that arrived with a retired code.

    Deliberately a side effect of a GET, which the rest of this module avoids.
    The thing being measured is automated polling of a saved URL, and a client
    that never runs the page's JavaScript never reaches the POST — so counting
    only what politely announces itself would miss exactly the traffic this
    exists to see. It writes a counter, notifies nobody, and creates no row
    describing whoever sent it.
    """
    now = utcnow()
    tag.stale_scan_count += 1
    if tag.last_stale_scan_at is None or (now - tag.last_stale_scan_at) > dt.timedelta(minutes=1):
        tag.last_stale_scan_at = now


def _owner(tag: Tag) -> User | None:
    user = db_session().get(User, tag.user_id)
    return user if user is not None and user.is_active else None


def _name_was_released(tag: Tag, *, retired: bool = False) -> bool:
    """Whether this read actually put the owner's name in front of someone.

    Not the same question as "is the bag lost". A tag set to `on_reply`, or one
    reached with a retired code, shows no name however lost it is — and the
    owner's scan history should say so rather than implying an exposure that
    did not happen.
    """
    return tag.is_lost and tag.name_disclosure == NAME_ALWAYS and not retired


def _public_body(tag: Tag, owner: User | None, *, retired: bool = False) -> dict:
    """What a finder is allowed to see, given the tag's current state."""
    body: dict = {
        "status": tag.status,
        "design": tag.design,
        "owner": None,
        "relay_available": False,
        "retired_code": retired,
        "retention_days": app_config().scan_retention_days,
    }

    if tag.status != TAG_STATUS_LOST or owner is None:
        return body

    # `always` is the only setting that puts a name in front of whoever
    # presents a code. `on_reply` holds it back until the owner answers a
    # specific person in the relay, which is the setting that makes a saved
    # URL worthless to someone who is not holding the bag.
    #
    # A retired code never gets the name, at any setting: it cannot be told
    # apart from a link saved before the bag was ever reported lost.
    if tag.name_disclosure == NAME_ALWAYS and not retired:
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
    """Reveals nothing new. Recording the scan is a separate, explicit POST.

    Two counters move here, and neither describes the caller. `page_fetch_count`
    counts every read; `scan_count` only moves when a browser renders the page
    and says so. The gap between them is what a polling loop looks like.
    """
    resolved = _lookup(token)
    tag = resolved.tag
    db = db_session()

    tag.page_fetch_count += 1
    if resolved.retired:
        _note_stale_read(tag)
    db.commit()

    return jsonify(_public_body(tag, _owner(tag), retired=resolved.retired))


@bp.post("/<token>/view")
@limiter.limit("20 per hour")
def record_scan(token: str):
    """Records that a person actually opened the page, and notifies the owner.

    Deduplicated against the same scanner's recent scans, and the owner's email
    is additionally cooled down per tag, so a bag drawing a few curious looks
    on a carousel produces one message rather than a stream.
    """
    # Named `scanned`, not `resolved`: the geo provider's result below already
    # owns that name in this function.
    scanned = _lookup(token)
    tag = scanned.tag
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
        revealed_contact=_name_was_released(tag, retired=scanned.retired),
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
            revealed_contact=_name_was_released(tag),
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
    tag = _lookup(token).tag
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
            revealed_contact=_name_was_released(tag),
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
@turnstile.require("finder_message")
def send_message(token: str):
    """Opens a masked conversation with the owner.

    Returns a relay token that lets the finder follow the thread without an
    account. Neither side ever sees the other's address or number.
    """
    payload = parse(request, FinderMessageIn)
    tag = _lookup(token).tag
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
    if payload.email:
        crypto.write_thread(thread, "finder_email", payload.email)
        crypto.write_thread(thread, "finder_token", relay_token)
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
        detail={"has_contact": bool(payload.contact), "email_updates": bool(payload.email)},
    )
    db.commit()

    mailer = current_app.extensions["mailer"]
    notifications.notify_relay_message(mailer, user=owner, crypto=crypto, config=config)
    if payload.email:
        notifications.notify_finder_opened(
            mailer, thread=thread, crypto=crypto, relay_token=relay_token, config=config
        )

    return jsonify(
        {
            "status": "sent",
            "relay_token": relay_token,
            "expires_at": thread.expires_at.isoformat(),
            "email_updates": bool(payload.email),
        }
    ), 201


def geo_label(location: CoarseLocation) -> str:
    """Serialises a coarse location for encrypted storage."""
    return json.dumps(location.to_dict(), separators=(",", ":"), sort_keys=True)
