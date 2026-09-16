"""Registration, sign-in, two-factor, password reset.

Account enumeration is treated as a real vulnerability here, not a nicety: this
service exists to keep a traveller's identity private, so an endpoint that
confirms "yes, this person has an account" undermines the product itself.

So registration, password reset and sign-in all return the same shape whether
or not the address is known, and the paths that would otherwise be faster for
an unknown address burn an equivalent Argon2 verification to keep the timing
flat.
"""

from __future__ import annotations

import datetime as dt

import pyotp
from flask import Blueprint, current_app, g, jsonify, request
from sqlalchemy import select

from ..errors import ApiError
from ..extensions import app_config, db_session, keyring, limiter
from ..models import Session, User, utcnow
from ..schemas import (
    EmailVerifyIn,
    LoginIn,
    PasswordChangeIn,
    PasswordResetIn,
    PasswordResetRequestIn,
    RegisterIn,
    ResendVerificationIn,
    TotpDisableIn,
    TotpEnableIn,
    parse,
)
from ..security import audit
from ..security import sessions as session_service
from ..security.authz import current_session, login_required, require_user, user_crypto
from ..security.crypto import DecryptionError, decrypt_field, encrypt_field, field_aad
from ..security.passwords import (
    PasswordPolicyError,
    check_password_policy,
    dummy_verify,
    hash_password,
    needs_rehash,
    verify_password,
)
from ..services import accounts, notifications
from ..services.mailer import mask_email

bp = Blueprint("auth", __name__, url_prefix="/auth")

# Same response for every registration attempt, known address or not.
_REGISTER_ACCEPTED = {
    "status": "accepted",
    "message": "Check your email to finish setting up your account.",
}
_RESET_ACCEPTED = {
    "status": "accepted",
    "message": "If that address has an account, a reset link is on its way.",
}
# The same body regardless of whether anything was actually sent: a shorter
# retry window for an unknown address, or none at all, would say which
# addresses have accounts awaiting confirmation.
_RESEND_ACCEPTED = {
    "status": "accepted",
    "message": "If that address is waiting to be confirmed, a new link is on its way.",
    "retry_after_seconds": int(accounts.VERIFICATION_RESEND_INTERVAL.total_seconds()),
}


def _hasher():
    return current_app.extensions["password_hasher"]


def _mailer():
    return current_app.extensions["mailer"]


def _public_url(path: str) -> str:
    return f"{app_config().public_base_url.rstrip('/')}{path}"


# --------------------------------------------------------------------------
# Registration
# --------------------------------------------------------------------------


@bp.post("/register")
@limiter.limit("5 per hour; 20 per day")
def register():
    payload = parse(request, RegisterIn)
    config = app_config()
    db = db_session()

    try:
        check_password_policy(
            payload.password,
            min_length=config.password_min_length,
            context=(payload.email, payload.name or ""),
        )
    except PasswordPolicyError as exc:
        raise ApiError(
            "weak_password", "Choose a stronger password.", fields={"password": str(exc)}
        ) from exc

    existing = accounts.find_by_email(db, payload.email, config=config)
    if existing is not None:
        # The response never says the address is known. What differs is the
        # email, which only reaches the person entitled to know.
        crypto = _unlock_quietly(existing)
        address = crypto.read_user(existing, "email") if crypto else None

        if existing.email_verified_at is None:
            # An unverified account is otherwise a dead end: sign-in refuses
            # until the address is confirmed, and registering again would only
            # send the "you already have an account" notice, which carries no
            # link. So re-issue the verification token instead.
            #
            # The password is deliberately not updated to the one just typed.
            # Anyone can register an address they do not own, and overwriting
            # the password here would let them take over the account the
            # moment the real owner clicked the link in their own inbox.
            token = accounts.issue_email_token(db, existing, "verify_email", config=config)
            message = notifications.verification_email(config, token, returning=True)
            outcome = "resent_verification"
        else:
            message = notifications.duplicate_registration_email(config)
            outcome = "duplicate"

        audit.record(
            db,
            audit.ACCOUNT_CREATED,
            config=config,
            subject_user_id=existing.id,
            actor_type="anonymous",
            detail={"outcome": outcome},
        )
        db.commit()

        if address:
            notifications.deliver(_mailer(), address, message)
        return jsonify(_REGISTER_ACCEPTED), 202

    user, crypto = accounts.create_user(
        db,
        email=payload.email,
        password=payload.password,
        name=payload.name,
        config=config,
        keyring=keyring(),
        hasher=_hasher(),
    )
    db.flush()

    token = accounts.issue_email_token(db, user, "verify_email", config=config)
    audit.record(
        db,
        audit.ACCOUNT_CREATED,
        config=config,
        subject_user_id=user.id,
        actor_type="anonymous",
        detail={"outcome": "created"},
    )
    db.commit()

    notifications.deliver(_mailer(), payload.email, notifications.verification_email(config, token))
    return jsonify(_REGISTER_ACCEPTED), 202


@bp.post("/verify-email")
@limiter.limit("10 per hour")
def verify_email():
    payload = parse(request, EmailVerifyIn)
    config = app_config()
    db = db_session()

    user = accounts.consume_email_token(db, payload.token, "verify_email", config=config)
    if user is None:
        raise ApiError("invalid_token", "That link is invalid or has expired.", status=400)

    if user.email_verified_at is None:
        user.email_verified_at = utcnow()
        user.updated_at = utcnow()

    session, token = session_service.issue(db, user, config=config, request=request)
    audit.record(
        db,
        audit.LOGIN_SUCCEEDED,
        config=config,
        actor_user_id=user.id,
        subject_user_id=user.id,
        actor_type="user",
        detail={"method": "email_verification"},
    )
    db.commit()

    response = jsonify({"user": _user_summary(user), "csrf_token": session.csrf_token})
    session_service.attach_cookies(response, session, token, config=config)
    return response


@bp.post("/verify-email/resend")
@limiter.limit("10 per hour; 30 per day")
def resend_verification():
    """Issues a fresh confirmation link for an unverified account.

    Without this, an account whose first email was lost is unreachable: sign-in
    refuses until the address is confirmed, and there is no other way to ask
    for another link.

    The throttle lives here, not in the browser. A disabled button is a
    courtesy to the person clicking it; what actually protects the mailbox is
    refusing to send, and that has to be decided per account, because the same
    person can reload, open a new tab, or change network.
    """
    payload = parse(request, ResendVerificationIn)
    config = app_config()
    db = db_session()

    user = accounts.find_by_email(db, payload.email, config=config)
    if user is not None and user.email_verified_at is None:
        last_sent = accounts.last_email_token_at(db, user, "verify_email")
        due = last_sent is None or (utcnow() - last_sent) >= accounts.VERIFICATION_RESEND_INTERVAL

        if due:
            token = accounts.issue_email_token(db, user, "verify_email", config=config)
            audit.record(
                db,
                audit.ACCOUNT_CREATED,
                config=config,
                subject_user_id=user.id,
                actor_type="anonymous",
                detail={"outcome": "resent_verification"},
            )
            db.commit()

            crypto = _unlock_quietly(user)
            address = crypto.read_user(user, "email") if crypto else None
            if address:
                notifications.deliver(
                    _mailer(),
                    address,
                    notifications.verification_email(config, token, returning=True),
                )
        else:
            db.commit()
    else:
        db.commit()

    # Identical for a fresh send, a throttled one, an already-verified account
    # and an address with no account at all.
    return jsonify(_RESEND_ACCEPTED), 202


# --------------------------------------------------------------------------
# Sign-in
# --------------------------------------------------------------------------


@bp.post("/login")
@limiter.limit("10 per 15 minutes; 50 per day")
def login():
    payload = parse(request, LoginIn)
    config = app_config()
    db = db_session()
    hasher = _hasher()

    user = accounts.find_by_email(db, payload.email, config=config)

    if user is None:
        # Spend the same time an existing account would, so response latency
        # does not answer "does this address have an account?".
        dummy_verify(hasher)
        audit.record(
            db,
            audit.LOGIN_FAILED,
            config=config,
            actor_type="anonymous",
            detail={"reason": "unknown_account"},
        )
        db.commit()
        raise _invalid_credentials()

    if user.locked_until is not None and user.locked_until > utcnow():
        dummy_verify(hasher)
        audit.record(
            db,
            audit.LOGIN_LOCKED,
            config=config,
            subject_user_id=user.id,
            actor_type="anonymous",
        )
        db.commit()
        # Same message as a wrong password: "this account is locked" confirms
        # the account exists.
        raise _invalid_credentials()

    if not verify_password(hasher, user.password_hash, payload.password):
        _register_failure(db, user, config=config)
        db.commit()
        raise _invalid_credentials()

    if user.email_verified_at is None:
        audit.record(
            db,
            audit.LOGIN_FAILED,
            config=config,
            subject_user_id=user.id,
            actor_type="anonymous",
            detail={"reason": "unverified"},
        )
        db.commit()
        raise ApiError(
            "email_unverified",
            "Confirm your email address first. Check your inbox for the link.",
            status=403,
        )

    if user.totp_enabled:
        # Only reachable with the correct password, so the prompt reveals
        # nothing the caller did not already know.
        if not payload.totp_code and not payload.recovery_code:
            return jsonify({"status": "totp_required"}), 200
        if not _second_factor_ok(db, user, payload, hasher=hasher):
            _register_failure(db, user, config=config)
            audit.record(
                db,
                audit.TOTP_FAILED,
                config=config,
                subject_user_id=user.id,
                actor_type="anonymous",
            )
            db.commit()
            raise ApiError("invalid_code", "That code is not valid.", status=401)

    # Transparent upgrade when the configured Argon2 cost has since increased.
    if needs_rehash(hasher, user.password_hash):
        user.password_hash = hash_password(hasher, payload.password)

    user.failed_login_count = 0
    user.locked_until = None

    session, token = session_service.issue(db, user, config=config, request=request)
    audit.record(
        db,
        audit.LOGIN_SUCCEEDED,
        config=config,
        actor_user_id=user.id,
        subject_user_id=user.id,
        actor_type="user",
        detail={"totp": user.totp_enabled},
    )
    db.commit()

    response = jsonify({"user": _user_summary(user), "csrf_token": session.csrf_token})
    session_service.attach_cookies(response, session, token, config=config)
    return response


def _second_factor_ok(db, user: User, payload: LoginIn, *, hasher) -> bool:
    if payload.recovery_code:
        return accounts.consume_recovery_code(db, user, payload.recovery_code, hasher=hasher)
    if not payload.totp_code:
        return False
    crypto = _unlock_quietly(user)
    if crypto is None:
        return False
    secret = decrypt_field(
        crypto.dek, user.totp_secret_enc, field_aad("users", "totp_secret", user.id)
    )
    if not secret:
        return False
    # One step of drift either way covers clock skew between phone and server
    # without meaningfully widening the window for a stolen code.
    return pyotp.TOTP(secret).verify(payload.totp_code.strip(), valid_window=1)


def _register_failure(db, user: User, *, config) -> None:
    user.failed_login_count += 1
    if user.failed_login_count >= config.login_max_attempts:
        user.locked_until = utcnow() + dt.timedelta(minutes=config.login_lockout_minutes)
        user.failed_login_count = 0
    audit.record(
        db,
        audit.LOGIN_FAILED,
        config=config,
        subject_user_id=user.id,
        actor_type="anonymous",
        detail={"attempts": user.failed_login_count},
    )


def _invalid_credentials() -> ApiError:
    return ApiError("invalid_credentials", "That email or password is not correct.", status=401)


# --------------------------------------------------------------------------
# Session
# --------------------------------------------------------------------------


@bp.get("/session")
def read_session():
    user = g.get("current_user")
    session = current_session()
    if user is None or session is None:
        return jsonify({"user": None}), 200
    db_session().commit()  # persist the slid idle expiry
    return jsonify({"user": _user_summary(user), "csrf_token": session.csrf_token})


@bp.post("/logout")
@login_required
def logout():
    db = db_session()
    session = current_session()
    if session is not None:
        session_service.revoke(db, session)
        audit.record(
            db,
            audit.LOGOUT,
            config=app_config(),
            actor_user_id=session.user_id,
            subject_user_id=session.user_id,
            actor_type="user",
        )
    db.commit()
    response = jsonify({"status": "signed_out"})
    session_service.clear_cookies(response, config=app_config())
    return response


@bp.get("/sessions")
@login_required
def list_sessions():
    user = require_user()
    current = current_session()
    rows = (
        db_session()
        .scalars(
            select(Session)
            .where(Session.user_id == user.id, Session.revoked_at.is_(None))
            .order_by(Session.last_seen_at.desc())
        )
        .all()
    )
    db_session().commit()
    return jsonify(
        {
            "sessions": [
                {
                    "id": str(row.id),
                    "client": row.client_label or "Unknown",
                    "created_at": row.created_at.isoformat(),
                    "last_seen_at": row.last_seen_at.isoformat(),
                    "current": current is not None and row.id == current.id,
                }
                for row in rows
            ]
        }
    )


@bp.post("/sessions/revoke-others")
@login_required
def revoke_other_sessions():
    user = require_user()
    session = current_session()
    db = db_session()
    count = session_service.revoke_all_for_user(
        db, user.id, except_id=session.id if session else None
    )
    audit.record(
        db,
        audit.SESSIONS_REVOKED,
        config=app_config(),
        actor_user_id=user.id,
        subject_user_id=user.id,
        actor_type="user",
        detail={"revoked": count},
    )
    db.commit()
    return jsonify({"revoked": count})


# --------------------------------------------------------------------------
# Passwords
# --------------------------------------------------------------------------


@bp.post("/password")
@login_required
@limiter.limit("10 per hour")
def change_password():
    payload = parse(request, PasswordChangeIn)
    config = app_config()
    db = db_session()
    user = require_user()
    hasher = _hasher()

    if not verify_password(hasher, user.password_hash, payload.current_password):
        audit.record(
            db,
            audit.LOGIN_FAILED,
            config=config,
            actor_user_id=user.id,
            subject_user_id=user.id,
            actor_type="user",
            detail={"reason": "password_change_wrong_current"},
        )
        db.commit()
        raise ApiError("invalid_credentials", "Your current password is not correct.", status=401)

    crypto = user_crypto()
    try:
        check_password_policy(
            payload.new_password,
            min_length=config.password_min_length,
            context=(crypto.read_user(user, "email") or "", crypto.read_user(user, "name") or ""),
        )
    except PasswordPolicyError as exc:
        raise ApiError(
            "weak_password", "Choose a stronger password.", fields={"new_password": str(exc)}
        ) from exc

    user.password_hash = hash_password(hasher, payload.new_password)
    user.updated_at = utcnow()

    # Every other device is signed out: a password change is the action people
    # take when they think someone else has access.
    current = current_session()
    revoked = session_service.revoke_all_for_user(
        db, user.id, except_id=current.id if current else None
    )
    audit.record(
        db,
        audit.PASSWORD_CHANGED,
        config=config,
        actor_user_id=user.id,
        subject_user_id=user.id,
        actor_type="user",
        detail={"sessions_revoked": revoked},
    )
    db.commit()

    address = crypto.read_user(user, "email")
    if address:
        notifications.deliver(_mailer(), address, notifications.password_changed_email(config))
    return jsonify({"status": "updated", "sessions_revoked": revoked})


@bp.post("/password/reset-request")
@limiter.limit("5 per hour; 15 per day")
def request_password_reset():
    payload = parse(request, PasswordResetRequestIn)
    config = app_config()
    db = db_session()

    user = accounts.find_by_email(db, payload.email, config=config)
    if user is not None:
        token = accounts.issue_email_token(db, user, "reset_password", config=config)
        audit.record(
            db,
            audit.PASSWORD_RESET_REQUESTED,
            config=config,
            subject_user_id=user.id,
            actor_type="anonymous",
        )
        db.commit()
        crypto = _unlock_quietly(user)
        address = crypto.read_user(user, "email") if crypto else None
        if address:
            notifications.deliver(
                _mailer(), address, notifications.password_reset_email(config, token)
            )
    else:
        db.commit()

    # Identical response either way.
    return jsonify(_RESET_ACCEPTED), 202


@bp.post("/password/reset")
@limiter.limit("10 per hour")
def reset_password():
    payload = parse(request, PasswordResetIn)
    config = app_config()
    db = db_session()

    user = accounts.consume_email_token(db, payload.token, "reset_password", config=config)
    if user is None:
        raise ApiError("invalid_token", "That link is invalid or has expired.", status=400)

    crypto = _unlock_quietly(user)
    try:
        check_password_policy(
            payload.new_password,
            min_length=config.password_min_length,
            context=(crypto.read_user(user, "email") or "",) if crypto else (),
        )
    except PasswordPolicyError as exc:
        raise ApiError(
            "weak_password", "Choose a stronger password.", fields={"new_password": str(exc)}
        ) from exc

    user.password_hash = hash_password(_hasher(), payload.new_password)
    user.failed_login_count = 0
    user.locked_until = None
    user.updated_at = utcnow()
    # A reset is a recovery from losing control of the account; nothing that
    # was signed in before it should stay signed in.
    revoked = session_service.revoke_all_for_user(db, user.id)

    audit.record(
        db,
        audit.PASSWORD_RESET_COMPLETED,
        config=config,
        subject_user_id=user.id,
        actor_type="anonymous",
        detail={"sessions_revoked": revoked},
    )
    db.commit()
    return jsonify({"status": "updated"})


# --------------------------------------------------------------------------
# Two-factor
# --------------------------------------------------------------------------


@bp.post("/totp/setup")
@login_required
@limiter.limit("10 per hour")
def totp_setup():
    """Issues a secret and returns the provisioning URI. Not yet enabled."""
    user = require_user()
    db = db_session()
    crypto = user_crypto()

    if user.totp_enabled:
        raise ApiError("totp_already_enabled", "Two-factor is already on.", status=409)

    secret = pyotp.random_base32()
    user.totp_secret_enc = encrypt_field(
        crypto.dek, secret, field_aad("users", "totp_secret", user.id)
    )
    # totp_enabled_at stays null until a code proves the secret was stored,
    # so a mistyped setup cannot lock the account out.
    db.commit()

    address = crypto.read_user(user, "email") or "account"
    uri = pyotp.TOTP(secret).provisioning_uri(name=address, issuer_name="Dynamic Luggage Tag")
    return jsonify({"secret": secret, "otpauth_uri": uri})


@bp.post("/totp/enable")
@login_required
@limiter.limit("10 per hour")
def totp_enable():
    payload = parse(request, TotpEnableIn)
    user = require_user()
    db = db_session()
    crypto = user_crypto()

    secret = decrypt_field(
        crypto.dek, user.totp_secret_enc, field_aad("users", "totp_secret", user.id)
    )
    if not secret:
        raise ApiError("totp_not_set_up", "Start the setup again.", status=409)
    if not pyotp.TOTP(secret).verify(payload.code.strip(), valid_window=1):
        raise ApiError("invalid_code", "That code is not valid.", status=400)

    user.totp_enabled_at = utcnow()
    user.updated_at = utcnow()
    codes = accounts.generate_recovery_codes(db, user, hasher=_hasher())
    audit.record(
        db,
        audit.TOTP_ENABLED,
        config=app_config(),
        actor_user_id=user.id,
        subject_user_id=user.id,
        actor_type="user",
    )
    db.commit()

    # The only time these are ever readable.
    return jsonify({"status": "enabled", "recovery_codes": codes})


@bp.post("/totp/disable")
@login_required
@limiter.limit("10 per hour")
def totp_disable():
    payload = parse(request, TotpDisableIn)
    user = require_user()
    db = db_session()

    if not verify_password(_hasher(), user.password_hash, payload.password):
        raise ApiError("invalid_credentials", "Your password is not correct.", status=401)

    user.totp_secret_enc = None
    user.totp_enabled_at = None
    user.updated_at = utcnow()
    audit.record(
        db,
        audit.TOTP_DISABLED,
        config=app_config(),
        actor_user_id=user.id,
        subject_user_id=user.id,
        actor_type="user",
    )
    db.commit()

    crypto = user_crypto()
    address = crypto.read_user(user, "email")
    if address:
        notifications.deliver(_mailer(), address, notifications.totp_disabled_email(app_config()))
    return jsonify({"status": "disabled"})


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _unlock_quietly(user: User):
    """Unwraps a data key, returning None instead of raising.

    Used on paths that must not change their behaviour based on whether the
    key happened to be loadable — a background notification, an enumeration-
    resistant branch — where raising would turn a key problem into an oracle.
    """
    from ..security.pii import unlock

    try:
        return unlock(keyring(), user)
    except DecryptionError:
        current_app.logger.error("Could not unwrap data key for user %s", user.id)
        return None


def _user_summary(user: User) -> dict:
    from ..security.pii import unlock

    try:
        crypto = unlock(keyring(), user)
        email = crypto.read_user(user, "email")
        name = crypto.read_user(user, "name")
    except DecryptionError:
        email, name = None, None

    return {
        "id": str(user.id),
        "email": email,
        "email_masked": mask_email(email) if email else None,
        "name": name,
        "email_verified": user.email_verified_at is not None,
        "totp_enabled": user.totp_enabled,
        "notify_on_scan": user.notify_on_scan,
        "created_at": user.created_at.isoformat(),
    }
