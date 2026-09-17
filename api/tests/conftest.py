"""Test fixtures.

Runs against a real PostgreSQL database rather than SQLite: the schema uses
JSONB, timezone-aware timestamps and schema-qualified tables, and a test that
passes on a different engine proves less than it appears to.
"""

from __future__ import annotations

import base64
import os
import re
from pathlib import Path

import pytest
from dotenv import dotenv_values
from flask.testing import FlaskClient
from sqlalchemy import text
from werkzeug.datastructures import Headers

API_ROOT = Path(__file__).resolve().parent.parent


def _test_database_url() -> str:
    env = dotenv_values(API_ROOT / ".env")
    url = env.get("DATABASE_URL")
    if not url:
        pytest.skip("api/.env has no DATABASE_URL — run 'make db-up' first")
    # Point at the sibling test database, leaving credentials and TLS options
    # exactly as configured.
    return re.sub(r"/(\w+)(\?|$)", r"/\1_test\2", url, count=1)


@pytest.fixture(scope="session")
def config():
    from app.config import load_config

    # Deterministic keys, generated per run: never a hard-coded constant that
    # could be copied into a real deployment.
    overrides = {
        "env": "testing",
        "testing": True,
        "database_url": _test_database_url(),
        "secret_key": os.urandom(32),
        "kek_versions": {1: os.urandom(32)},
        "blind_index_key": os.urandom(32),
        "token_pepper": os.urandom(32),
        # One account in the suite is the operator. Named here so the admin
        # gate is exercised by the same mechanism production uses.
        "admin_email": "operator@example.com",
    }
    os.environ.setdefault("DLT_KEK_V1", base64.b64encode(overrides["kek_versions"][1]).decode())
    os.environ.setdefault("DLT_SECRET_KEY", "testing-only")
    os.environ.setdefault("DLT_BLIND_INDEX_KEY", base64.b64encode(os.urandom(32)).decode())
    os.environ.setdefault("DLT_TOKEN_PEPPER", base64.b64encode(os.urandom(32)).decode())
    os.environ.setdefault("DATABASE_URL", overrides["database_url"])
    os.environ["DLT_COOKIE_SECURE"] = "false"
    # Argon2 at production cost makes a login test take a second each; the
    # algorithm under test is the same either way.
    os.environ["DLT_ARGON2_TIME_COST"] = "1"
    os.environ["DLT_ARGON2_MEMORY_COST"] = "8192"
    return load_config(overrides)


@pytest.fixture(scope="session")
def app(config):
    from app import create_app
    from app.models import Base

    application = create_app(config)
    engine = application.extensions["db_engine"]
    with engine.connect() as connection:
        connection.execute(text("CREATE SCHEMA IF NOT EXISTS dlt"))
        connection.commit()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield application
    Base.metadata.drop_all(engine)


@pytest.fixture(autouse=True)
def clean_tables(app):
    """Empties every table between tests.

    TRUNCATE ... CASCADE rather than per-test transactions: the code under test
    commits, and a fixture that swallowed those commits would not be exercising
    the same code path production runs.
    """
    from app.models import Base

    engine = app.extensions["db_engine"]
    tables = ", ".join(f'dlt."{table.name}"' for table in reversed(Base.metadata.sorted_tables))
    with engine.connect() as connection:
        connection.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        connection.commit()
    yield


class BrowserClient(FlaskClient):
    """Test client that sends Origin on every request, as a browser does.

    Without it the CSRF origin check would reject requests for a reason no
    real client ever hits, and the tests would be exercising the wrong branch.
    """

    def open(self, *args, **kwargs):
        headers = Headers(kwargs.get("headers") or {})
        headers.setdefault("Origin", "http://localhost:5173")
        kwargs["headers"] = headers
        return super().open(*args, **kwargs)


@pytest.fixture
def client(app):
    app.test_client_class = BrowserClient
    return app.test_client()


@pytest.fixture
def outbox(app, monkeypatch):
    """Captures outgoing mail instead of sending or printing it."""
    sent: list[dict] = []

    class Capturing:
        def send(self, *, to: str, subject: str, body: str, html: str | None = None) -> None:
            sent.append({"to": to, "subject": subject, "body": body, "html": html})

    monkeypatch.setitem(app.extensions, "mailer", Capturing())
    return sent


@pytest.fixture
def db(app):
    with app.app_context():
        from app.extensions import db_session

        session = db_session()
        yield session
        session.rollback()


def token_from(outbox: list[dict], pattern: str = r"token=([A-Za-z0-9_\-]+)") -> str:
    """Pulls a one-time token out of the most recent captured email."""
    assert outbox, "no email was sent"
    match = re.search(pattern, outbox[-1]["body"])
    assert match, f"no token in email body:\n{outbox[-1]['body']}"
    return match.group(1)


def register_and_sign_in(
    client,
    outbox,
    email="traveller@example.com",
    password="correct horse battery staple",
):
    """Completes the full sign-up flow and returns (csrf_token, email)."""
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "name": "Rosa Fernandez"},
    )
    assert response.status_code == 202, response.get_json()

    response = client.post("/api/v1/auth/verify-email", json={"token": token_from(outbox)})
    assert response.status_code == 200, response.get_json()
    return response.get_json()["csrf_token"], email


def auth_headers(csrf_token: str) -> dict[str, str]:
    return {"X-CSRF-Token": csrf_token, "Origin": "http://localhost:5173"}
