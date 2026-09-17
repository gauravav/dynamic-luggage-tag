"""Owner-facing tag management."""

from __future__ import annotations

import uuid

from flask import Blueprint, Response, jsonify, request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from ..core import design as design_module
from ..core import icons, print_layout, qr
from ..errors import ApiError
from ..extensions import app_config, db_session, limiter
from ..models import TAG_STATUS_LOST, TAG_STATUS_SAFE, Tag, utcnow
from ..schemas import NfcBindIn, NfcChipIn, TagCreateIn, TagTokenIn, TagUpdateIn, parse
from ..security import audit
from ..security.authz import login_required, owned_tag, require_user, user_crypto
from ..security.crypto import blind_index, hash_token, new_token
from ..security.pii import UserCrypto

bp = Blueprint("tags", __name__, url_prefix="/tags")

MAX_TAGS_PER_USER = 25


def _scan_url(token: str) -> str:
    return qr.scan_url(app_config().public_base_url, token)


def _serialize(tag: Tag, crypto: UserCrypto, *, include_token: bool = False) -> dict:
    body = {
        "id": str(tag.id),
        "label": crypto.read_tag(tag, "label"),
        "status": tag.status,
        "lost_at": tag.lost_at.isoformat() if tag.lost_at else None,
        "design": tag.design,
        "icon": tag.icon,
        "icon_color": tag.icon_color,
        "reveal_name": tag.reveal_name,
        "reveal_message_relay": tag.reveal_message_relay,
        "notify_on_scan": tag.notify_on_scan,
        "scan_count": tag.scan_count,
        "last_scan_at": tag.last_scan_at.isoformat() if tag.last_scan_at else None,
        "created_at": tag.created_at.isoformat(),
        "nfc_linked": tag.nfc_uid_bidx is not None,
        "nfc_linked_at": tag.nfc_bound_at.isoformat() if tag.nfc_bound_at else None,
    }
    if include_token:
        # Only on the detail view, so a list response never sprays scan URLs
        # across a screen or a shared browser cache.
        token = crypto.read_tag(tag, "token")
        body["scan_url"] = _scan_url(token) if token else None
    return body


@bp.get("")
@login_required
def list_tags():
    user = require_user()
    crypto = user_crypto()
    tags = sorted(
        (tag for tag in user.tags if tag.revoked_at is None),
        key=lambda t: t.created_at,
        reverse=True,
    )
    return jsonify({"tags": [_serialize(tag, crypto) for tag in tags]})


@bp.post("")
@login_required
@limiter.limit("30 per hour")
def create_tag():
    payload = parse(request, TagCreateIn)
    user = require_user()
    crypto = user_crypto()
    db = db_session()
    config = app_config()

    live = [tag for tag in user.tags if tag.revoked_at is None]
    if len(live) >= MAX_TAGS_PER_USER:
        raise ApiError(
            "tag_limit_reached",
            f"You can have up to {MAX_TAGS_PER_USER} tags.",
            status=409,
        )

    tag_id = uuid.uuid4()
    token = new_token(32)
    tag = Tag(
        id=tag_id,
        user_id=user.id,
        token_hash=hash_token(config.token_pepper, "tag", token),
        token_version=1,
        status=TAG_STATUS_SAFE,
        # Every tag of one traveller carries the same design — that is the
        # product's whole recognition story.
        design=design_module.generate(bytes(user.design_seed)).to_dict(),
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    crypto.write_tag(tag, "token", token)
    crypto.write_tag(tag, "label", payload.label)
    tag.icon = payload.icon
    tag.icon_color = payload.icon_color or (icons.DEFAULT_ICON_COLOR if payload.icon else None)
    db.add(tag)

    audit.record(
        db,
        audit.TAG_CREATED,
        config=config,
        actor_user_id=user.id,
        subject_user_id=user.id,
        tag_id=tag_id,
        actor_type="user",
    )
    db.commit()
    return jsonify({"tag": _serialize(tag, crypto, include_token=True)}), 201


@bp.get("/<tag_id>")
@login_required
def read_tag(tag_id: str):
    tag = owned_tag(tag_id)
    return jsonify({"tag": _serialize(tag, user_crypto(), include_token=True)})


@bp.patch("/<tag_id>")
@login_required
def update_tag(tag_id: str):
    payload = parse(request, TagUpdateIn)
    tag = owned_tag(tag_id)
    user = require_user()
    crypto = user_crypto()
    db = db_session()
    config = app_config()

    if "label" in payload.model_fields_set:
        crypto.write_tag(tag, "label", payload.label or None)

    if "icon" in payload.model_fields_set:
        tag.icon = payload.icon
        # An icon with no colour behind it would print as nothing at all.
        if tag.icon and not tag.icon_color:
            tag.icon_color = icons.DEFAULT_ICON_COLOR
    if "icon_color" in payload.model_fields_set:
        tag.icon_color = payload.icon_color

    for flag in ("reveal_name", "reveal_message_relay", "notify_on_scan"):
        value = getattr(payload, flag)
        if value is not None:
            setattr(tag, flag, value)

    if payload.status is not None and payload.status != tag.status:
        if payload.status == TAG_STATUS_LOST and user.email_verified_at is None:
            # Marking a bag lost is the one action that puts a name in front of
            # a stranger; it needs a confirmed address behind it.
            raise ApiError(
                "email_unverified",
                "Confirm your email address before marking a bag lost.",
                status=403,
            )
        tag.status = payload.status
        tag.lost_at = utcnow() if payload.status == TAG_STATUS_LOST else None
        audit.record(
            db,
            audit.TAG_STATUS_CHANGED,
            config=config,
            actor_user_id=user.id,
            subject_user_id=user.id,
            tag_id=tag.id,
            actor_type="user",
            detail={"status": tag.status},
        )

    tag.updated_at = utcnow()
    audit.record(
        db,
        audit.TAG_UPDATED,
        config=config,
        actor_user_id=user.id,
        subject_user_id=user.id,
        tag_id=tag.id,
        actor_type="user",
        detail={"fields": sorted(payload.model_fields_set)},
    )
    db.commit()
    return jsonify({"tag": _serialize(tag, crypto, include_token=True)})


@bp.post("/<tag_id>/rotate")
@login_required
@limiter.limit("10 per hour")
def rotate_token(tag_id: str):
    """Issues a new scan code, invalidating every printed copy of the old one."""
    tag = owned_tag(tag_id)
    user = require_user()
    crypto = user_crypto()
    db = db_session()
    config = app_config()

    token = new_token(32)
    tag.token_hash = hash_token(config.token_pepper, "tag", token)
    tag.token_version += 1
    crypto.write_tag(tag, "token", token)
    tag.updated_at = utcnow()

    # Open conversations were addressed to the old code; close them so a
    # stranger holding the previous tag cannot keep messaging.
    closed = 0
    for thread in tag.threads:
        if thread.closed_at is None:
            thread.closed_at = utcnow()
            closed += 1

    audit.record(
        db,
        audit.TAG_TOKEN_ROTATED,
        config=config,
        actor_user_id=user.id,
        subject_user_id=user.id,
        tag_id=tag.id,
        actor_type="user",
        detail={"version": tag.token_version, "threads_closed": closed},
    )
    db.commit()
    return jsonify({"tag": _serialize(tag, crypto, include_token=True), "threads_closed": closed})


def _nfc_index(serial: str) -> bytes:
    return blind_index(app_config().blind_index_key, "nfc_uid", serial)


@bp.post("/<tag_id>/nfc")
@login_required
@limiter.limit("30 per hour")
def bind_nfc(tag_id: str):
    """Links a physical NFC chip to this tag, just before the page writes to it.

    This is what makes the site refuse to write a chip for anyone but its
    owner. It cannot stop a generic NFC app from overwriting an unlocked chip:
    that protection would need a chip password, which browsers cannot set.
    """
    payload = parse(request, NfcBindIn)
    tag = owned_tag(tag_id)
    user = require_user()
    crypto = user_crypto()
    db = db_session()
    config = app_config()

    index = _nfc_index(payload.serial)
    holder = db.scalar(select(Tag).where(Tag.nfc_uid_bidx == index, Tag.id != tag.id))

    if holder is not None and holder.user_id != user.id:
        raise ApiError(
            "nfc_chip_claimed",
            "This NFC tag is registered to another account, so it can't be written from here.",
            status=409,
        )
    if not payload.replace:
        if holder is not None:
            other = crypto.read_tag(holder, "label") or "another of your tags"
            raise ApiError(
                "nfc_chip_on_other_tag",
                f"This NFC tag is currently linked to “{other}”. Move it to this tag instead?",
                status=409,
            )
        if tag.nfc_uid_bidx is not None and tag.nfc_uid_bidx != index:
            raise ApiError(
                "nfc_tag_has_other_chip",
                "This tag is already linked to a different NFC sticker. Replace it with this one?",
                status=409,
            )

    moved = holder is not None
    if holder is not None:
        holder.nfc_uid_bidx = None
        holder.nfc_bound_at = None
        # Flush first, or the unique index sees both rows holding the chip.
        db.flush()

    tag.nfc_uid_bidx = index
    tag.nfc_bound_at = utcnow()
    tag.updated_at = utcnow()
    audit.record(
        db,
        audit.TAG_NFC_BOUND,
        config=config,
        actor_user_id=user.id,
        subject_user_id=user.id,
        tag_id=tag.id,
        actor_type="user",
        detail={"moved_from_other_tag": moved},
    )
    try:
        db.commit()
    except IntegrityError as exc:
        # Another account linked the same chip between our check and commit.
        db.rollback()
        raise ApiError(
            "nfc_chip_claimed",
            "This NFC tag is registered to another account, so it can't be written from here.",
            status=409,
        ) from exc
    return jsonify({"tag": _serialize(tag, crypto, include_token=True)})


@bp.delete("/<tag_id>/nfc")
@login_required
def unbind_nfc(tag_id: str):
    tag = owned_tag(tag_id)
    user = require_user()
    db = db_session()

    if tag.nfc_uid_bidx is not None:
        tag.nfc_uid_bidx = None
        tag.nfc_bound_at = None
        tag.updated_at = utcnow()
        audit.record(
            db,
            audit.TAG_NFC_UNBOUND,
            config=app_config(),
            actor_user_id=user.id,
            subject_user_id=user.id,
            tag_id=tag.id,
            actor_type="user",
        )
        db.commit()
    return jsonify({"tag": _serialize(tag, user_crypto(), include_token=True)})


@bp.post("/lookup")
@login_required
@limiter.limit("120 per hour")
def lookup_token():
    """Answers "is this scanned tag one of mine?" for the signed-in owner.

    This is what lets a scan land on the owner's own tag page instead of the
    finder's view when they tap their own bag. A token belonging to somebody
    else is a plain 404: the caller learns nothing they did not already have.
    """
    payload = parse(request, TagTokenIn)
    user = require_user()
    config = app_config()

    tag = db_session().scalar(
        select(Tag).where(
            Tag.token_hash == hash_token(config.token_pepper, "tag", payload.token),
            Tag.user_id == user.id,
            Tag.revoked_at.is_(None),
        )
    )
    if tag is None:
        raise ApiError("not_found", "No such tag.", status=404)
    return jsonify({"tag": _serialize(tag, user_crypto(), include_token=True)})


@bp.post("/nfc/lookup")
@login_required
@limiter.limit("60 per hour")
def lookup_nfc():
    """Tells the signed-in owner who a chip they are holding is registered to.

    A chip on someone else's tag is reported only as "other": no id, no label.
    The caller has to be physically holding the chip to learn even that much.
    """
    payload = parse(request, NfcChipIn)
    user = require_user()
    holder = db_session().scalar(
        select(Tag).where(Tag.nfc_uid_bidx == _nfc_index(payload.serial), Tag.revoked_at.is_(None))
    )
    if holder is None:
        return jsonify({"registered": "none"})
    if holder.user_id != user.id:
        return jsonify({"registered": "other"})
    return jsonify(
        {"registered": "mine", "tag": _serialize(holder, user_crypto(), include_token=True)}
    )


@bp.delete("/<tag_id>")
@login_required
def delete_tag(tag_id: str):
    tag = owned_tag(tag_id)
    user = require_user()
    db = db_session()

    audit.record(
        db,
        audit.TAG_DELETED,
        config=app_config(),
        actor_user_id=user.id,
        subject_user_id=user.id,
        tag_id=tag.id,
        actor_type="user",
        detail={"scans": tag.scan_count},
    )
    # A hard delete: the scan history attached to it is a location history, and
    # a soft-deleted location history is still a location history.
    db.delete(tag)
    db.commit()
    return jsonify({"status": "deleted"})


@bp.get("/<tag_id>/scans")
@login_required
def list_scans(tag_id: str):
    tag = owned_tag(tag_id)
    crypto = user_crypto()
    scans = sorted(tag.scans, key=lambda s: s.occurred_at, reverse=True)[:100]
    return jsonify(
        {
            "scans": [
                {
                    "id": str(scan.id),
                    "occurred_at": scan.occurred_at.isoformat(),
                    "location": crypto.read_scan_location(scan),
                    "shared_location": scan.shared_location,
                    "client": scan.client_label,
                    "contact_revealed": scan.revealed_contact,
                    "expires_at": scan.expires_at.isoformat(),
                }
                for scan in scans
            ],
            "retention_days": app_config().scan_retention_days,
        }
    )


@bp.get("/<tag_id>/qr.svg")
@login_required
def tag_qr(tag_id: str):
    tag = owned_tag(tag_id)
    token = user_crypto().read_tag(tag, "token")
    if not token:
        raise ApiError("not_found", "No such tag.", status=404)

    svg = qr.to_svg(_scan_url(token), dark=tag.design.get("ink", "#242017"))
    response = Response(svg, mimetype="image/svg+xml")
    response.headers["Content-Disposition"] = f'inline; filename="tag-{tag.id}.svg"'
    return response


@bp.get("/<tag_id>/print.pdf")
@login_required
@limiter.limit("60 per hour")
def tag_pdf(tag_id: str):
    """Print-ready PDF at the supplier's template size.

    `guides=1` overlays trim and safety rectangles for proofing on screen —
    useful before ordering, never for the file you actually send.
    """
    tag = owned_tag(tag_id)
    user = require_user()
    crypto = user_crypto()

    token = crypto.read_tag(tag, "token")
    if not token:
        raise ApiError("not_found", "No such tag.", status=404)

    include_back = request.args.get("sides", "2") != "1"
    guides = request.args.get("guides") == "1"

    name = crypto.read_user(user, "name")
    label = crypto.read_tag(tag, "label")

    face = print_layout.TagFace(
        design=design_module.from_dict(tag.design),
        scan_url=_scan_url(token),
        # The printed name is the owner's choice: it is visible to anyone who
        # picks the bag up, unlike everything behind the scan page.
        display_name=name,
        subtitle=label,
        icon=tag.icon,
        icon_color=tag.icon_color,
    )
    pdf = print_layout.render(face, include_back=include_back, guides=guides)

    response = Response(pdf, mimetype="application/pdf")
    response.headers["Content-Disposition"] = f'attachment; filename="luggage-tag-{tag.id}.pdf"'
    return response
