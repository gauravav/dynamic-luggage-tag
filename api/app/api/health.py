"""Liveness and readiness.

Reports whether the process is up and whether its database answers. It does not
report versions, hostnames, migration state or dependency lists: a health
endpoint is reachable by anyone who can reach the service, so it is a poor
place to publish a fingerprint.
"""

from __future__ import annotations

from flask import Blueprint, jsonify
from sqlalchemy import text

from ..extensions import app_config, db_session

bp = Blueprint("health", __name__)


@bp.get("/health")
def health():
    return jsonify({"status": "ok"})


@bp.get("/health/ready")
def ready():
    try:
        db_session().execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 - the reason belongs in logs, not the body
        return jsonify({"status": "unavailable"}), 503
    return jsonify({"status": "ok"})


@bp.get("/config")
def public_config():
    """Settings the browser needs before anyone signs in.

    Only values that are public by design. The Turnstile site key is embedded
    in every page that renders the widget anyway; the secret key never leaves
    the server.
    """
    config = app_config()
    return jsonify(
        {"turnstile_site_key": config.turnstile_site_key if config.turnstile_enabled else None}
    )
