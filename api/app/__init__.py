"""Application factory."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify

from .api import register_blueprints
from .config import Config, ConfigError, load_config
from .errors import register_error_handlers
from .extensions import close_db_session, init_engine, limiter
from .security.authz import load_identity
from .security.crypto import Keyring
from .security.headers import register_cors, register_security_headers
from .security.passwords import build_hasher, warm_dummy_hash
from .services.geo import build_geo_provider
from .services.mailer import build_mailer

log = logging.getLogger(__name__)


def create_app(config: Config | None = None) -> Flask:
    if config is None:
        load_dotenv(Path(__file__).resolve().parent.parent / ".env")
        config = load_config()

    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=config.secret_key,
        MAX_CONTENT_LENGTH=config.max_content_length,
        JSON_SORT_KEYS=False,
        # Werkzeug's own session cookie is unused; sessions are server-side.
        SESSION_COOKIE_SECURE=config.cookie_secure,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Strict",
        PROPAGATE_EXCEPTIONS=config.testing,
        TRAP_HTTP_EXCEPTIONS=False,
    )

    _configure_logging(config)

    app.extensions["dlt_config"] = config
    app.extensions["keyring"] = Keyring(config.kek_versions, config.kek_active_version)
    app.extensions["password_hasher"] = build_hasher(
        time_cost=config.argon2_time_cost,
        memory_cost=config.argon2_memory_cost,
        parallelism=config.argon2_parallelism,
    )
    app.extensions["mailer"] = build_mailer(config)
    app.extensions["geo_provider"] = build_geo_provider(config)

    init_engine(app, config)

    app.config["RATELIMIT_STORAGE_URI"] = config.ratelimit_storage_uri
    app.config["RATELIMIT_HEADERS_ENABLED"] = True
    limiter.init_app(app)
    limiter.enabled = not config.testing

    register_security_headers(app, config)
    register_cors(app, config)
    register_error_handlers(app)
    register_blueprints(app)

    app.before_request(load_identity)
    app.teardown_appcontext(close_db_session)

    _register_preflight(app, config)
    _register_cli(app)

    # Pay the first Argon2 cost at boot, not on someone's first failed login.
    warm_dummy_hash(app.extensions["password_hasher"])

    log.info("Dynamic Luggage Tag API ready (env=%s)", config.env)
    return app


def _register_preflight(app: Flask, config: Config) -> None:
    @app.route("/api/v1/<path:_unused>", methods=["OPTIONS"])
    def _preflight(_unused: str):
        # An empty 204; the CORS after_request adds the allow headers, and does
        # so only for the configured origin.
        return "", 204

    @app.get("/")
    def _root():
        return jsonify({"service": "dynamic-luggage-tag", "api": "/api/v1"})


def _configure_logging(config: Config) -> None:
    level = logging.DEBUG if config.debug else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    # SQLAlchemy at INFO echoes full statements, which carry ciphertext,
    # blind indexes and token hashes. Keep it at WARNING regardless of env.
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


def _register_cli(app: Flask) -> None:
    from .cli import register_cli

    register_cli(app)


def main() -> None:  # pragma: no cover - dev entrypoint
    app = create_app()
    app.run(
        host=os.environ.get("DLT_HOST", "127.0.0.1"),
        port=int(os.environ.get("DLT_PORT", "5001")),
        debug=app.extensions["dlt_config"].debug,
    )


__all__ = ["ConfigError", "create_app", "load_config", "main"]
