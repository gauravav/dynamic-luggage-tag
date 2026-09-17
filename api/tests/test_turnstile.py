"""Cloudflare Turnstile gating.

Verification is exercised against a real local HTTP server standing in for
Cloudflare's siteverify endpoint, so the request the API actually sends — and
how it handles each answer — is what gets tested, not a mocked function.
"""

from __future__ import annotations

import dataclasses
import json
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from conftest import token_from

PASSWORD = "correct horse battery staple"


class _FakeSiteverify(BaseHTTPRequestHandler):
    """Tokens look like ``pass:<action>``; anything else is rejected."""

    received: list[dict] = []

    def do_POST(self):  # noqa: N802 - http.server naming
        length = int(self.headers["Content-Length"])
        form = urllib.parse.parse_qs(self.rfile.read(length).decode())
        fields = {key: values[0] for key, values in form.items()}
        type(self).received.append(fields)

        token = fields.get("response", "")
        if fields.get("secret") != "test-secret":
            body = {"success": False, "error-codes": ["invalid-input-secret"]}
        elif token == "test-key-token":
            # How Cloudflare's published test keys really answer: no action.
            body = {"success": True, "metadata": {"result_with_testing_key": True}}
        elif token == "no-action":
            body = {"success": True}
        elif token.startswith("pass:"):
            body = {"success": True, "action": token.split(":", 1)[1]}
        else:
            body = {"success": False, "error-codes": ["invalid-input-response"]}

        payload = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


@pytest.fixture
def siteverify():
    _FakeSiteverify.received = []
    server = HTTPServer(("127.0.0.1", 0), _FakeSiteverify)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}/siteverify"
    server.shutdown()


@pytest.fixture
def turnstile_on(app, siteverify, monkeypatch):
    config = dataclasses.replace(
        app.extensions["dlt_config"],
        turnstile_site_key="test-site-key",
        turnstile_secret_key="test-secret",
        turnstile_verify_url=siteverify,
    )
    monkeypatch.setitem(app.extensions, "dlt_config", config)
    return config


def _register(client, token=None, email="ana@example.com"):
    headers = {"X-Turnstile-Token": token} if token else {}
    return client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": PASSWORD},
        headers=headers,
    )


class TestDisabled:
    def test_actions_work_without_a_token_when_not_configured(self, client, outbox):
        assert _register(client).status_code == 202

    def test_public_config_reports_no_site_key(self, client):
        assert client.get("/api/v1/config").get_json() == {"turnstile_site_key": None}


class TestEnabled:
    def test_public_config_exposes_only_the_site_key(self, client, turnstile_on):
        body = client.get("/api/v1/config").get_json()
        assert body == {"turnstile_site_key": "test-site-key"}
        assert "test-secret" not in json.dumps(body)

    def test_missing_token_is_refused_before_anything_happens(
        self, client, app, outbox, turnstile_on
    ):
        response = _register(client)
        assert response.status_code == 403
        assert response.get_json()["error"]["code"] == "verification_failed"
        # Refused before the view ran: no account, no email.
        assert outbox == []
        with app.app_context():
            from app.extensions import db_session
            from app.models import User

            assert db_session().query(User).count() == 0

    def test_a_valid_token_is_accepted(self, client, outbox, turnstile_on):
        assert _register(client, "pass:register").status_code == 202
        assert outbox[-1]["subject"] == "Confirm your email address"

    def test_a_rejected_token_is_refused(self, client, turnstile_on):
        assert _register(client, "forged").status_code == 403

    def test_a_token_for_another_action_is_refused(self, client, turnstile_on):
        """A token solved on the sign-in page must not unlock registration."""
        assert _register(client, "pass:login").status_code == 403

    def test_cloudflare_test_keys_work_despite_reporting_no_action(self, client, turnstile_on):
        assert _register(client, "test-key-token").status_code == 202

    def test_a_real_result_missing_its_action_is_refused(self, client, turnstile_on):
        """Only a result Cloudflare flags as a test-key result may omit the action."""
        assert _register(client, "no-action").status_code == 403

    def test_an_oversized_token_is_refused_without_calling_cloudflare(self, client, turnstile_on):
        assert _register(client, "x" * 3000).status_code == 403
        assert _FakeSiteverify.received == []

    def test_the_client_ip_is_not_sent_to_cloudflare(self, client, turnstile_on):
        _register(client, "pass:register")
        assert _FakeSiteverify.received
        assert "remoteip" not in _FakeSiteverify.received[-1]

    def test_fails_closed_when_cloudflare_is_unreachable(self, client, app, monkeypatch):
        config = dataclasses.replace(
            app.extensions["dlt_config"],
            turnstile_site_key="test-site-key",
            turnstile_secret_key="test-secret",
            # Nothing listens on port 9 (discard) locally.
            turnstile_verify_url="http://127.0.0.1:9/siteverify",
            turnstile_timeout_seconds=1.0,
        )
        monkeypatch.setitem(app.extensions, "dlt_config", config)
        response = _register(client, "pass:register")
        assert response.status_code == 503
        assert response.get_json()["error"]["code"] == "verification_unavailable"

    @pytest.mark.parametrize(
        ("path", "action", "body"),
        [
            ("/api/v1/auth/login", "login", {"email": "a@example.com", "password": PASSWORD}),
            ("/api/v1/auth/password/reset-request", "password_reset", {"email": "a@example.com"}),
            ("/api/v1/auth/verify-email/resend", "resend_verification", {"email": "a@example.com"}),
        ],
    )
    def test_every_account_entry_point_is_gated(self, client, turnstile_on, path, action, body):
        assert client.post(path, json=body).status_code == 403
        allowed = client.post(path, json=body, headers={"X-Turnstile-Token": f"pass:{action}"})
        assert allowed.status_code != 403

    def test_finder_messages_are_gated_but_viewing_a_scan_is_not(
        self, client, app, outbox, turnstile_on
    ):
        """Only the action carrying free text is gated; a finder reads freely."""
        # Set up a lost tag with verification passed.
        _register(client, "pass:register", email="owner@example.com")
        verified = client.post("/api/v1/auth/verify-email", json={"token": token_from(outbox)})
        csrf = verified.get_json()["csrf_token"]
        headers = {"X-CSRF-Token": csrf}
        tag = client.post("/api/v1/tags", json={"label": "Bag"}, headers=headers).get_json()["tag"]
        client.patch(f"/api/v1/tags/{tag['id']}", json={"status": "lost"}, headers=headers)
        scan_token = tag["scan_url"].rsplit("/", 1)[-1]

        finder = app.test_client()
        assert finder.get(f"/api/v1/scan/{scan_token}").status_code == 200
        assert finder.post(f"/api/v1/scan/{scan_token}/view").status_code == 200

        message = {"body": "Found it at the airport."}
        assert finder.post(f"/api/v1/scan/{scan_token}/message", json=message).status_code == 403
        sent = finder.post(
            f"/api/v1/scan/{scan_token}/message",
            json=message,
            headers={"X-Turnstile-Token": "pass:finder_message"},
        )
        assert sent.status_code == 201


def test_one_key_without_the_other_is_a_startup_error(monkeypatch, config):
    from app.config import ConfigError, load_config

    monkeypatch.setenv("DLT_TURNSTILE_SITE_KEY", "only-the-site-key")
    monkeypatch.delenv("DLT_TURNSTILE_SECRET_KEY", raising=False)
    with pytest.raises(ConfigError, match="TURNSTILE"):
        load_config(
            {
                "testing": True,
                "database_url": config.database_url,
                "secret_key": b"x" * 32,
                "kek_versions": config.kek_versions,
                "blind_index_key": config.blind_index_key,
                "token_pepper": config.token_pepper,
            }
        )


def test_signup_completes_end_to_end_with_verification_on(client, outbox, turnstile_on):
    assert _register(client, "pass:register").status_code == 202
    response = client.post("/api/v1/auth/verify-email", json={"token": token_from(outbox)})
    assert response.status_code == 200
