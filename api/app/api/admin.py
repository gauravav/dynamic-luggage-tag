"""Pre-issuing tags, for the one account named in DLT_ADMIN_EMAIL.

The operator sells physical tags. They print one, ship it, and the buyer signs
up afterwards — so the code has to be created and printable before the account
it will belong to exists. That is all this surface does.

What it deliberately does not do is give anyone a way to read other people's
data. There is no user list here, no tag list, no scan history, no inbox. The
admin can create a code and address it, can see the ones they created, and can
withdraw one that has not been claimed. An issued claim's contents stop being
readable the moment an account takes it: `materialise` moves everything to the
owner's key and destroys the claim's own copy, so a claimed row tells the
operator that a code went out and to which address index — not what is on it.

Addresses are masked in every response. The operator typed the address to
begin with, so this is not about keeping it from them; it is about not turning
a page they might leave open into a list of customer addresses.
"""

from __future__ import annotations

import uuid

from flask import Blueprint, Response, current_app, jsonify, request
from sqlalchemy import select

from ..core import design as design_module
from ..core import print_layout, qr
from ..errors import ApiError
from ..extensions import app_config, db_session, keyring, limiter
from ..models import TagClaim, utcnow
from ..schemas import TagClaimIn, parse
from ..security import audit
from ..security.authz import admin_required, require_user
from ..services import accounts, notifications
from ..services import claims as claim_service
from ..services.mailer import mask_email

bp = Blueprint("admin", __name__, url_prefix="/admin")

MAX_OPEN_CLAIMS = 500


def _mailer():
    return current_app.extensions["mailer"]


def _serialize(claim: TagClaim, *, include_token: bool = False, token: str | None = None) -> dict:
    body = {
        "id": str(claim.id),
        # Masked, always. See the note at the top of this module.
        "email": _masked(claim),
        "icon": claim.icon,
        "icon_color": claim.icon_color,
        "created_at": claim.created_at.isoformat(),
        "invite_sent_at": claim.invite_sent_at.isoformat() if claim.invite_sent_at else None,
        "claimed": claim.is_claimed,
        "claimed_at": claim.claimed_at.isoformat() if claim.claimed_at else None,
        "design": design_module.generate(bytes(claim.design_seed)).to_dict(),
    }
    if include_token and token is not None:
        body["scan_url"] = qr.scan_url(app_config().public_base_url, token)
    return body


def _masked(claim: TagClaim) -> str | None:
    """The address this claim went to, masked, or None once it is claimed.

    A claimed row has had its sealed fields destroyed, so there is nothing left
    to mask — which is the intended end state, not a gap.
    """
    if claim.is_claimed:
        return None
    address = claim_service.read(claim, "email", keyring=keyring())
    return mask_email(address) if address else None


def _open_claim(claim_id: str) -> TagClaim:
    try:
        parsed = uuid.UUID(str(claim_id))
    except (ValueError, AttributeError) as exc:
        raise ApiError("not_found", "No such claim.", status=404) from exc
    claim = db_session().get(TagClaim, parsed)
    if claim is None:
        raise ApiError("not_found", "No such claim.", status=404)
    return claim


@bp.get("/claims")
@admin_required
def list_claims():
    claims = (
        db_session().scalars(select(TagClaim).order_by(TagClaim.created_at.desc()).limit(200)).all()
    )
    return jsonify({"claims": [_serialize(claim) for claim in claims]})


@bp.post("/claims")
@admin_required
@limiter.limit("120 per hour")
def create_claim():
    """Issues a code for an address, and returns it once so it can be printed.

    The buyer is invited by email to create the account it belongs to — unless
    they already have one, in which case there is nothing to invite them to and
    the tag simply appears the next time they open their tags.
    """
    payload = parse(request, TagClaimIn)
    admin = require_user()
    config = app_config()
    db = db_session()

    open_claims = db.scalar(select(TagClaim).where(TagClaim.claimed_at.is_(None)).limit(1))
    if open_claims is not None:
        outstanding = len(
            db.scalars(select(TagClaim.id).where(TagClaim.claimed_at.is_(None))).all()
        )
        if outstanding >= MAX_OPEN_CLAIMS:
            raise ApiError(
                "claim_limit_reached",
                f"There are already {MAX_OPEN_CLAIMS} unclaimed codes outstanding.",
                status=409,
            )

    claim, token, invite = claim_service.issue(
        db,
        email=payload.email,
        name=payload.name,
        label=payload.label,
        config=config,
        keyring=keyring(),
        issued_by=admin.id,
    )

    # An address that already has an account has nothing to be invited to, and
    # mailing them a "create your account" link would be a small lie. The tag
    # reaches them the next time they open their tags, so the invitation is
    # dropped before it can be sent or looked up.
    known = accounts.find_by_email(db, payload.email, config=config) is not None
    if known:
        claim.invite_token_hash = None
        claim.invite_sent_at = None

    audit.record(
        db,
        audit.TAG_CLAIM_ISSUED,
        config=config,
        actor_user_id=admin.id,
        actor_type="admin",
        # No address, not even masked: the audit log is not the place for it.
        detail={"claim_id": str(claim.id)},
    )
    db.commit()

    # Sent after the commit: a mail provider having a bad minute must not undo
    # a code that has already been issued. `deliver` never raises, and the
    # operator can send the invitation again from the list.
    if not known:
        notifications.deliver(
            _mailer(),
            payload.email,
            notifications.tag_invitation_email(config, invite, name=payload.name),
        )
    return jsonify({"claim": _serialize(claim, include_token=True, token=token)}), 201


@bp.post("/claims/<claim_id>/invite")
@admin_required
@limiter.limit("60 per hour")
def resend_invitation(claim_id: str):
    """Sends the invitation again, on a new link.

    Mail goes astray. The previous link stops working as this one is minted,
    so there is only ever one way into a given code.
    """
    claim = _open_claim(claim_id)
    if claim.is_claimed:
        raise ApiError(
            "claim_already_taken",
            "That code has been claimed. Its owner has an account already.",
            status=409,
        )

    config = app_config()
    db = db_session()
    address = claim_service.read(claim, "email", keyring=keyring())
    name = claim_service.read(claim, "name", keyring=keyring())
    if not address:
        raise ApiError("not_found", "No such claim.", status=404)

    if accounts.find_by_email(db, address, config=config) is not None:
        raise ApiError(
            "account_exists",
            "That address already has an account. The tag appears in their tags "
            "without an invitation.",
            status=409,
        )

    invite = claim_service.reissue_invite(claim, config=config)
    audit.record(
        db,
        audit.TAG_CLAIM_ISSUED,
        config=config,
        actor_user_id=require_user().id,
        actor_type="admin",
        detail={"claim_id": str(claim.id), "outcome": "invitation_resent"},
    )
    db.commit()

    notifications.deliver(
        _mailer(), address, notifications.tag_invitation_email(config, invite, name=name)
    )
    return jsonify({"claim": _serialize(claim)})


@bp.delete("/claims/<claim_id>")
@admin_required
def withdraw_claim(claim_id: str):
    """Withdraws a code that has not been claimed yet.

    A claimed one is not deletable here. It belongs to an account by then, and
    the admin is not a route to other people's tags.
    """
    claim = _open_claim(claim_id)
    if claim.is_claimed:
        raise ApiError(
            "claim_already_taken",
            "That code has been claimed. It belongs to its owner now.",
            status=409,
        )

    db = db_session()
    audit.record(
        db,
        audit.TAG_CLAIM_WITHDRAWN,
        config=app_config(),
        actor_user_id=require_user().id,
        actor_type="admin",
        detail={"claim_id": str(claim.id)},
    )
    db.delete(claim)
    db.commit()
    return jsonify({"status": "withdrawn"})


@bp.get("/claims/<claim_id>/print.pdf")
@admin_required
@limiter.limit("120 per hour")
def claim_pdf(claim_id: str):
    """The printable tag for a pre-issued code.

    `guides=1` overlays the trim and safety rectangles for proofing on screen:
    useful for checking what the cut will take off, never the file that goes
    to the press.

    The name is the one the operator took with the order, which is also the
    name the account will start out with — the tag and the account have to
    agree, and the tag is what gets printed first.
    """
    claim = _open_claim(claim_id)
    if claim.is_claimed:
        raise ApiError(
            "claim_already_taken",
            "That code has been claimed. Its owner can print it themselves.",
            status=409,
        )

    token = claim_service.read(claim, "token", keyring=keyring())
    if not token:
        raise ApiError("not_found", "No such claim.", status=404)

    face = print_layout.TagFace(
        design=design_module.generate(bytes(claim.design_seed)),
        scan_url=qr.scan_url(app_config().public_base_url, token),
        display_name=claim_service.read(claim, "name", keyring=keyring()),
        subtitle=claim_service.read(claim, "label", keyring=keyring()),
        icon=claim.icon,
        icon_color=claim.icon_color,
    )
    guides = request.args.get("guides") == "1"
    pdf = print_layout.render(face, include_back=True, guides=guides)

    response = Response(pdf, mimetype="application/pdf")
    name = f"tag-{claim.id}{'-trim' if guides else ''}.pdf"
    response.headers["Content-Disposition"] = f'attachment; filename="{name}"'
    return response


@bp.get("/summary")
@admin_required
def summary():
    """Counts, for the admin page's header. Nothing identifying."""
    db = db_session()
    outstanding = len(db.scalars(select(TagClaim.id).where(TagClaim.claimed_at.is_(None))).all())
    claimed = len(db.scalars(select(TagClaim.id).where(TagClaim.claimed_at.is_not(None))).all())
    return jsonify({"outstanding": outstanding, "claimed": claimed, "as_of": utcnow().isoformat()})
