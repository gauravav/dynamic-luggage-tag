"""Profile, data export and account deletion."""

from __future__ import annotations

from flask import Blueprint, current_app, jsonify, request

from ..core import design as design_module
from ..errors import ApiError
from ..extensions import app_config, db_session, limiter
from ..models import utcnow
from ..schemas import AccountDeleteIn, AccountUpdateIn, parse
from ..security import audit
from ..security import sessions as session_service
from ..security.authz import login_required, require_user, user_crypto
from ..security.passwords import verify_password
from ..services import accounts

bp = Blueprint("account", __name__, url_prefix="/account")


@bp.get("")
@login_required
def read_account():
    """Returns the profile with personal fields decrypted.

    Audited: this is the endpoint that turns ciphertext back into a name and a
    phone number, and "who read this person's details, and when" is exactly
    what an audit trail is for.
    """
    user = require_user()
    crypto = user_crypto()
    db = db_session()

    audit.record(
        db,
        audit.PII_DECRYPTED,
        config=app_config(),
        actor_user_id=user.id,
        subject_user_id=user.id,
        actor_type="user",
        detail={"scope": "profile"},
    )
    db.commit()

    return jsonify(
        {
            "account": {
                "id": str(user.id),
                "email": crypto.read_user(user, "email"),
                "name": crypto.read_user(user, "name"),
                "phone": crypto.read_user(user, "phone"),
                "address": crypto.read_user(user, "address"),
                "email_verified": user.email_verified_at is not None,
                "totp_enabled": user.totp_enabled,
                "notify_on_scan": user.notify_on_scan,
                "created_at": user.created_at.isoformat(),
            }
        }
    )


@bp.patch("")
@login_required
def update_account():
    payload = parse(request, AccountUpdateIn)
    user = require_user()
    crypto = user_crypto()
    db = db_session()

    changed: list[str] = []
    # model_fields_set distinguishes "sent as null, please clear this" from
    # "not sent, leave it alone" — the two mean different things for an
    # address the user may be deliberately removing.
    for field in ("name", "phone", "address"):
        if field in payload.model_fields_set:
            crypto.write_user(user, field, getattr(payload, field) or None)
            changed.append(field)

    if payload.notify_on_scan is not None:
        user.notify_on_scan = payload.notify_on_scan
        changed.append("notify_on_scan")

    user.updated_at = utcnow()
    audit.record(
        db,
        audit.ACCOUNT_UPDATED,
        config=app_config(),
        actor_user_id=user.id,
        subject_user_id=user.id,
        actor_type="user",
        detail={"fields": changed},
    )
    db.commit()
    return jsonify({"status": "updated", "changed": len(changed)})


@bp.get("/design")
@login_required
def read_design():
    """The traveller's design spec, for the browser to render."""
    user = require_user()
    design = design_module.generate(bytes(user.design_seed))
    return jsonify({"design": design.to_dict()})


@bp.get("/export")
@login_required
@limiter.limit("5 per day")
def export_account():
    """Everything held about the account, decrypted, in one JSON document.

    A portability export, so it includes the scan history and relayed messages
    rather than the profile alone — those are the records the account holder is
    least able to reconstruct for themselves.
    """
    user = require_user()
    crypto = user_crypto()
    db = db_session()

    tags = []
    for tag in user.tags:
        if tag.revoked_at is not None:
            continue
        tags.append(
            {
                "id": str(tag.id),
                "label": crypto.read_tag(tag, "label"),
                "status": tag.status,
                "created_at": tag.created_at.isoformat(),
                "scan_count": tag.scan_count,
                "design": tag.design,
                "scans": [
                    {
                        "occurred_at": scan.occurred_at.isoformat(),
                        "location": crypto.read_scan_location(scan),
                        "shared_location": scan.shared_location,
                        "client": scan.client_label,
                        "contact_revealed": scan.revealed_contact,
                        "expires_at": scan.expires_at.isoformat(),
                    }
                    for scan in sorted(tag.scans, key=lambda s: s.occurred_at, reverse=True)
                ],
                "conversations": [
                    {
                        "opened_at": thread.created_at.isoformat(),
                        "finder_contact": crypto.read_thread(thread, "finder_contact"),
                        "messages": [
                            {
                                "from": message.sender,
                                "at": message.created_at.isoformat(),
                                "body": crypto.read_message(message),
                            }
                            for message in thread.messages
                        ],
                    }
                    for thread in tag.threads
                ],
            }
        )

    audit.record(
        db,
        audit.ACCOUNT_EXPORTED,
        config=app_config(),
        actor_user_id=user.id,
        subject_user_id=user.id,
        actor_type="user",
        detail={"tags": len(tags)},
    )
    db.commit()

    response = jsonify(
        {
            "exported_at": utcnow().isoformat(),
            "account": {
                "email": crypto.read_user(user, "email"),
                "name": crypto.read_user(user, "name"),
                "phone": crypto.read_user(user, "phone"),
                "address": crypto.read_user(user, "address"),
                "created_at": user.created_at.isoformat(),
                "two_factor_enabled": user.totp_enabled,
            },
            "design": design_module.generate(bytes(user.design_seed)).to_dict(),
            "tags": tags,
            "note": (
                "Scan history is deleted automatically once it passes the retention "
                "window shown in each entry's expires_at."
            ),
        }
    )
    response.headers["Content-Disposition"] = 'attachment; filename="luggage-tag-export.json"'
    return response


@bp.delete("")
@login_required
@limiter.limit("5 per day")
def delete_account():
    """Deletes the account and destroys the key that could read its data."""
    payload = parse(request, AccountDeleteIn)
    user = require_user()
    db = db_session()

    if not verify_password(
        current_app.extensions["password_hasher"], user.password_hash, payload.password
    ):
        raise ApiError("invalid_credentials", "Your password is not correct.", status=401)

    crypto = user_crypto()
    address = crypto.read_user(user, "email")
    user_id = user.id

    session_service.revoke_all_for_user(db, user_id)
    # Recorded before the rows go, and with a null subject so the audit entry
    # does not resurrect a foreign key to a user that no longer exists.
    audit.record(
        db,
        audit.ACCOUNT_DELETED,
        config=app_config(),
        actor_type="user",
        detail={"tags": len(user.tags)},
    )
    accounts.crypto_shred(db, user)
    db.commit()

    if address:
        from ..services import notifications

        notifications.deliver(
            current_app.extensions["mailer"], address, notifications.account_deleted_email()
        )

    response = jsonify({"status": "deleted"})
    session_service.clear_cookies(response, config=app_config())
    return response
