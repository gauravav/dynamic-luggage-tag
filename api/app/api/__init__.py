"""HTTP surface, versioned under /api/v1."""

from flask import Blueprint, Flask


def register_blueprints(app: Flask) -> None:
    from . import account, admin, auth, health, relay, scan, tags

    root = Blueprint("v1", __name__, url_prefix="/api/v1")
    root.register_blueprint(health.bp)
    root.register_blueprint(auth.bp)
    root.register_blueprint(account.bp)
    root.register_blueprint(tags.bp)
    root.register_blueprint(admin.bp)
    root.register_blueprint(scan.bp)
    root.register_blueprint(relay.bp)
    app.register_blueprint(root)
