"""Liveness and readiness.

Reports whether the process is up and whether its database answers. It does not
report versions, hostnames, migration state or dependency lists: a health
endpoint is reachable by anyone who can reach the service, so it is a poor
place to publish a fingerprint.
"""

from __future__ import annotations

from flask import Blueprint, jsonify
from sqlalchemy import text

from ..extensions import db_session

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
