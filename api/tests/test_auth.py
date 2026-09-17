"""Registration, sign-in, sessions and CSRF."""

from __future__ import annotations

import time

from conftest import auth_headers, register_and_sign_in, token_from

PASSWORD = "correct horse battery staple"


class TestRegistration:
    def test_creates_an_account_and_sends_a_verification_link(self, client, outbox):
        response = client.post(
            "/api/v1/auth/register",
            json={"email": "ana@example.com", "password": PASSWORD, "name": "Ana"},
        )
        assert response.status_code == 202
        assert len(outbox) == 1
        assert outbox[0]["subject"] == "Confirm your email address"
        assert "/verify?token=" in outbox[0]["body"]

    def test_mail_is_multipart_and_branded(self, client, outbox):
        _register(client, "ana@example.com")
        message = outbox[0]
        # The text part carries the link, so a text-only client is not stranded.
        assert "/verify?token=" in message["body"]
        # The HTML part carries the same link, and the site's palette.
        assert message["html"] is not None
        assert "/verify?token=" in message["html"]
        assert "#FAF6EC" in message["html"]
        assert "Dynamic Luggage Tag" in message["html"]

    def test_unverified_account_can_get_a_fresh_link(self, client, app, outbox):
        """Registering again must not strand an account that was never verified.

        Sign-in refuses until the address is confirmed, so if re-registering
        only sent the "you already have an account" notice — which carries no
        link — the account would be unreachable forever.
        """
        _register(client, "ana@example.com")
        outbox.clear()

        _register(client, "ana@example.com")
        assert outbox[-1]["subject"] == "Confirm your email address"

        response = app.test_client().post(
            "/api/v1/auth/verify-email", json={"token": token_from(outbox)}
        )
        assert response.status_code == 200
        assert response.get_json()["user"]["email_verified"] is True

    def test_resending_does_not_change_the_password(self, client, app, outbox):
        """Anyone can register an address they do not own.

        If the second registration overwrote the password, whoever sent it
        would take the account over the moment the real owner clicked the link
        in their own inbox.
        """
        _register(client, "ana@example.com")
        outbox.clear()
        _register(client, "ana@example.com", password="an attacker chosen passphrase")

        app.test_client().post("/api/v1/auth/verify-email", json={"token": token_from(outbox)})

        attacker = app.test_client().post(
            "/api/v1/auth/login",
            json={"email": "ana@example.com", "password": "an attacker chosen passphrase"},
        )
        assert attacker.status_code == 401

        owner = app.test_client().post(
            "/api/v1/auth/login", json={"email": "ana@example.com", "password": PASSWORD}
        )
        assert owner.status_code == 200

    def test_duplicate_address_is_indistinguishable_from_a_new_one(self, client, outbox):
        """The response must not reveal that an address is already registered."""
        first = _register(client, "ana@example.com")
        second = _register(client, "ana@example.com")
        assert first.status_code == second.status_code == 202
        assert first.get_json() == second.get_json()

    def test_duplicate_registration_warns_the_address_holder_instead(self, client, app, outbox):
        # Only a *verified* account gets the notice. An unverified one gets a
        # fresh link instead, covered by test_unverified_account_can_get_a_fresh_link.
        register_and_sign_in(client, outbox, email="ana@example.com")
        outbox.clear()

        _register(app.test_client(), "ana@example.com")
        assert len(outbox) == 1
        assert "already have an account" in outbox[-1]["body"]
        # And no link that would let whoever sent it act on the account.
        assert "/verify?token=" not in outbox[-1]["body"]

    def test_weak_password_is_rejected(self, client):
        response = client.post(
            "/api/v1/auth/register", json={"email": "ana@example.com", "password": "password1234"}
        )
        assert response.status_code == 400
        assert response.get_json()["error"]["code"] == "weak_password"

    def test_password_cannot_contain_the_email(self, client):
        response = client.post(
            "/api/v1/auth/register",
            json={"email": "rosafernandez@example.com", "password": "rosafernandez-2026!"},
        )
        assert response.status_code == 400
        assert response.get_json()["error"]["code"] == "weak_password"

    def test_unknown_fields_are_refused(self, client):
        response = client.post(
            "/api/v1/auth/register",
            json={"email": "a@example.com", "password": PASSWORD, "is_admin": True},
        )
        assert response.status_code == 400
        assert "is_admin" in response.get_json()["error"]["fields"]


class TestVerification:
    def test_verifying_signs_the_user_in(self, client, outbox):
        _register(client, "ana@example.com")
        response = client.post("/api/v1/auth/verify-email", json={"token": token_from(outbox)})
        assert response.status_code == 200
        assert response.get_json()["user"]["email_verified"] is True
        assert "dlt_session" in response.headers.get("Set-Cookie", "")

    def test_a_token_works_only_once(self, client, app, outbox):
        _register(client, "ana@example.com")
        token = token_from(outbox)
        assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 200
        # A fresh client: the first one now holds a session, and a signed-in
        # browser would have to present a CSRF token with any POST.
        assert (
            app.test_client().post("/api/v1/auth/verify-email", json={"token": token}).status_code
            == 400
        )

    def test_a_forged_token_is_rejected(self, client):
        response = client.post("/api/v1/auth/verify-email", json={"token": "x" * 40})
        assert response.status_code == 400


class TestResendVerification:
    """The way out of an unconfirmed account."""

    def _resend(self, client, email="ana@example.com"):
        return client.post("/api/v1/auth/verify-email/resend", json={"email": email})

    @staticmethod
    def _age_tokens(app, minutes=11):
        """Backdates every issued token, standing in for the passage of time.

        The registration email counts against the same window, so without this
        a resend straight after signing up is throttled — which is the correct
        behaviour, and would otherwise make these tests assert the wrong thing.
        """
        import datetime as dt

        with app.app_context():
            from app.extensions import db_session
            from app.models import EmailToken

            db = db_session()
            for record in db.query(EmailToken).all():
                record.created_at = record.created_at - dt.timedelta(minutes=minutes)
            db.commit()

    def test_is_throttled_immediately_after_registering(self, client, app, outbox):
        """The sign-up email counts: no second copy seconds later."""
        _register(client, "ana@example.com")
        outbox.clear()

        response = self._resend(app.test_client())
        assert response.status_code == 202
        assert outbox == []

    def test_sends_a_fresh_link_once_the_window_has_passed(self, client, app, outbox):
        _register(client, "ana@example.com")
        self._age_tokens(app)
        outbox.clear()

        response = self._resend(app.test_client())
        assert response.status_code == 202
        assert outbox[-1]["subject"] == "Confirm your email address"

        verified = app.test_client().post(
            "/api/v1/auth/verify-email", json={"token": token_from(outbox)}
        )
        assert verified.status_code == 200
        assert verified.get_json()["user"]["email_verified"] is True

    def test_a_second_request_inside_the_window_sends_nothing(self, client, app, outbox):
        _register(client, "ana@example.com")
        self._age_tokens(app)
        outbox.clear()

        first = self._resend(app.test_client())
        assert len(outbox) == 1

        second = self._resend(app.test_client())
        # Same answer, no second email.
        assert second.status_code == first.status_code == 202
        assert second.get_json() == first.get_json()
        assert len(outbox) == 1

    def test_the_throttle_is_not_tied_to_the_client(self, client, app, outbox):
        """A new tab, a new browser or a new network must not reset it."""
        _register(client, "ana@example.com")
        self._age_tokens(app)
        outbox.clear()

        self._resend(app.test_client())
        assert len(outbox) == 1

        self._resend(app.test_client())
        assert len(outbox) == 1

    def test_an_already_verified_account_gets_nothing(self, client, app, outbox):
        register_and_sign_in(client, outbox, email="ana@example.com")
        self._age_tokens(app)
        outbox.clear()

        # A fresh client: the signed-in one would need to present a CSRF token.
        response = self._resend(app.test_client())
        assert response.status_code == 202
        assert outbox == []

    def test_every_case_answers_identically(self, client, app, outbox):
        """Unknown, unverified and verified addresses must be indistinguishable."""
        _register(client, "unverified@example.com")
        register_and_sign_in(app.test_client(), outbox, email="verified@example.com")
        self._age_tokens(app)

        answers = [
            self._resend(app.test_client(), email).get_json()
            for email in ("unverified@example.com", "verified@example.com", "nobody@example.com")
        ]
        assert answers[0] == answers[1] == answers[2]
        assert all(answer["retry_after_seconds"] == 600 for answer in answers)


class TestLogin:
    def test_signs_in_after_verification(self, client, outbox):
        register_and_sign_in(client, outbox)
        client.post("/api/v1/auth/logout", headers=auth_headers(_csrf(client)))

        response = client.post(
            "/api/v1/auth/login", json={"email": "traveller@example.com", "password": PASSWORD}
        )
        assert response.status_code == 200
        assert response.get_json()["user"]["email"] == "traveller@example.com"

    def test_unknown_and_wrong_password_give_the_same_answer(self, client, app, outbox):
        register_and_sign_in(client, outbox, email="known@example.com")

        unknown = app.test_client().post(
            "/api/v1/auth/login", json={"email": "nobody@example.com", "password": PASSWORD}
        )
        wrong = app.test_client().post(
            "/api/v1/auth/login", json={"email": "known@example.com", "password": "wrong password!"}
        )
        assert unknown.status_code == wrong.status_code == 401
        assert unknown.get_json() == wrong.get_json()

    def test_unknown_account_costs_comparable_time(self, client, app, outbox):
        """Timing must not answer 'does this address have an account?'."""
        register_and_sign_in(client, outbox, email="known@example.com")

        def elapsed(email: str) -> float:
            fresh = app.test_client()
            start = time.perf_counter()
            fresh.post("/api/v1/auth/login", json={"email": email, "password": "wrong password!"})
            return time.perf_counter() - start

        known = min(elapsed("known@example.com") for _ in range(3))
        unknown = min(elapsed("nobody@example.com") for _ in range(3))
        # Generous bound: this catches "returns instantly", which is the leak,
        # without turning scheduler noise into a flaky failure.
        assert 0.25 < unknown / known < 4.0, f"known={known:.4f}s unknown={unknown:.4f}s"

    def test_unverified_account_cannot_sign_in(self, client, outbox):
        _register(client, "ana@example.com")
        response = client.post(
            "/api/v1/auth/login", json={"email": "ana@example.com", "password": PASSWORD}
        )
        assert response.status_code == 403
        assert response.get_json()["error"]["code"] == "email_unverified"

    def test_repeated_failures_lock_the_account(self, client, outbox, app):
        register_and_sign_in(client, outbox, email="known@example.com")
        client.post("/api/v1/auth/logout", headers=auth_headers(_csrf(client)))

        for _ in range(app.extensions["dlt_config"].login_max_attempts):
            client.post(
                "/api/v1/auth/login",
                json={"email": "known@example.com", "password": "wrong password!"},
            )
        # Even the correct password is refused while the lock holds.
        response = client.post(
            "/api/v1/auth/login", json={"email": "known@example.com", "password": PASSWORD}
        )
        assert response.status_code == 401


class TestSession:
    def test_session_endpoint_reports_the_signed_in_user(self, client, outbox):
        register_and_sign_in(client, outbox)
        response = client.get("/api/v1/auth/session")
        assert response.get_json()["user"]["email"] == "traveller@example.com"

    def test_session_is_empty_when_signed_out(self, client):
        assert client.get("/api/v1/auth/session").get_json()["user"] is None

    def test_logout_revokes_the_session(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        assert client.post("/api/v1/auth/logout", headers=auth_headers(csrf)).status_code == 200
        assert client.get("/api/v1/auth/session").get_json()["user"] is None

    def test_session_cookie_is_httponly_and_samesite_strict(self, client, outbox):
        _register(client, "ana@example.com")
        response = client.post("/api/v1/auth/verify-email", json={"token": token_from(outbox)})
        cookies = response.headers.getlist("Set-Cookie")
        session_cookie = next(c for c in cookies if c.startswith("dlt_session="))
        assert "HttpOnly" in session_cookie
        assert "SameSite=Strict" in session_cookie

    def test_csrf_cookie_is_readable_by_the_page(self, client, outbox):
        _register(client, "ana@example.com")
        response = client.post("/api/v1/auth/verify-email", json={"token": token_from(outbox)})
        csrf_cookie = next(
            c for c in response.headers.getlist("Set-Cookie") if c.startswith("dlt_csrf=")
        )
        assert "HttpOnly" not in csrf_cookie


class TestCsrf:
    def test_state_change_without_a_token_is_refused(self, client, outbox):
        register_and_sign_in(client, outbox)
        response = client.post("/api/v1/auth/logout", headers={"Origin": "http://localhost:5173"})
        assert response.status_code == 403
        assert response.get_json()["error"]["code"] == "csrf_failed"

    def test_state_change_from_another_origin_is_refused(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        response = client.post(
            "/api/v1/auth/logout",
            headers={"X-CSRF-Token": csrf, "Origin": "https://evil.example"},
        )
        assert response.status_code == 403

    def test_a_wrong_token_is_refused(self, client, outbox):
        register_and_sign_in(client, outbox)
        response = client.post(
            "/api/v1/auth/logout",
            headers={"X-CSRF-Token": "not-the-token", "Origin": "http://localhost:5173"},
        )
        assert response.status_code == 403

    def test_reads_do_not_need_a_token(self, client, outbox):
        register_and_sign_in(client, outbox)
        assert client.get("/api/v1/auth/session").status_code == 200


class TestPasswordChange:
    def test_changing_the_password_revokes_other_sessions(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)

        other = app.test_client()
        other.post(
            "/api/v1/auth/login", json={"email": "traveller@example.com", "password": PASSWORD}
        )
        assert other.get("/api/v1/auth/session").get_json()["user"] is not None

        response = client.post(
            "/api/v1/auth/password",
            json={"current_password": PASSWORD, "new_password": "a different long passphrase"},
            headers=auth_headers(csrf),
        )
        assert response.status_code == 200
        assert response.get_json()["sessions_revoked"] >= 1
        assert other.get("/api/v1/auth/session").get_json()["user"] is None

    def test_wrong_current_password_is_refused(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        response = client.post(
            "/api/v1/auth/password",
            json={"current_password": "nope nope nope", "new_password": "another long passphrase"},
            headers=auth_headers(csrf),
        )
        assert response.status_code == 401


class TestPasswordReset:
    def test_response_is_identical_for_known_and_unknown_addresses(self, client, app, outbox):
        register_and_sign_in(client, outbox, email="known@example.com")
        known = app.test_client().post(
            "/api/v1/auth/password/reset-request", json={"email": "known@example.com"}
        )
        unknown = app.test_client().post(
            "/api/v1/auth/password/reset-request", json={"email": "nobody@example.com"}
        )
        assert known.status_code == unknown.status_code == 202
        assert known.get_json() == unknown.get_json()

    def test_reset_sets_a_new_password_and_signs_everyone_out(self, client, app, outbox):
        register_and_sign_in(client, outbox, email="known@example.com")
        outbox.clear()
        anonymous = app.test_client()
        anonymous.post("/api/v1/auth/password/reset-request", json={"email": "known@example.com"})

        response = anonymous.post(
            "/api/v1/auth/password/reset",
            json={"token": token_from(outbox), "new_password": "brand new long passphrase"},
        )
        assert response.status_code == 200
        assert client.get("/api/v1/auth/session").get_json()["user"] is None

        fresh = app.test_client()
        assert (
            fresh.post(
                "/api/v1/auth/login",
                json={"email": "known@example.com", "password": "brand new long passphrase"},
            ).status_code
            == 200
        )


class TestTotp:
    def test_setup_returns_a_scannable_symbol(self, client, outbox):
        """The setup step has to be completable by pointing a phone at it.

        Reading a 32-character base32 key off one screen and typing it into
        another is the step people abandon two-factor at.
        """
        import urllib.parse
        import xml.etree.ElementTree as ElementTree

        import pyotp

        csrf, email = register_and_sign_in(client, outbox)
        body = client.post("/api/v1/auth/totp/setup", headers=auth_headers(csrf)).get_json()

        # The symbol has to encode the same secret the response hands over, or
        # scanning it enrols an authenticator that can never produce a code
        # this account accepts.
        uri = urllib.parse.urlparse(body["otpauth_uri"])
        assert uri.scheme == "otpauth" and uri.netloc == "totp"
        query = urllib.parse.parse_qs(uri.query)
        assert query["secret"] == [body["secret"]]
        assert query["issuer"] == ["Dynamic Luggage Tag"]
        assert email in urllib.parse.unquote(uri.path)

        # And a code from that secret is the one the enable step accepts.
        enabled = client.post(
            "/api/v1/auth/totp/enable",
            json={"code": pyotp.TOTP(query["secret"][0]).now()},
            headers=auth_headers(csrf),
        )
        assert enabled.status_code == 200

        # noqa justified: the symbol is our own renderer's output.
        root = ElementTree.fromstring(body["qr_svg"])  # noqa: S314
        assert root.tag == "{http://www.w3.org/2000/svg}svg"
        assert root.get("viewBox") and root.get("width")

        # It encodes this URI and not some constant: the same input gives the
        # same symbol, a different one gives a different symbol.
        from app.core import qr

        assert qr.to_svg(body["otpauth_uri"], error=qr.SCREEN_ERROR_CORRECTION) == qr.to_svg(
            body["otpauth_uri"], error=qr.SCREEN_ERROR_CORRECTION
        )
        assert qr.to_svg(body["otpauth_uri"]) != qr.to_svg(body["otpauth_uri"] + "x")

    def test_the_symbol_never_leaves_the_secret_in_a_url(self, client, outbox):
        """A provisioning URI carries the shared secret.

        Served from an endpoint of its own it would land in an access log, a
        browser history entry and a referrer header; inlined in this response
        it is no more exposed than the secret printed beside it.
        """
        csrf, _ = register_and_sign_in(client, outbox)
        response = client.post("/api/v1/auth/totp/setup", headers=auth_headers(csrf))

        assert "no-store" in response.headers["Cache-Control"]
        body = response.get_json()
        assert body["qr_svg"].lstrip().startswith("<svg")

        # Self-contained: the symbol references nothing it would have to fetch,
        # so rendering it cannot put the secret into another request.
        assert "href" not in body["qr_svg"]
        assert "<image" not in body["qr_svg"]

        # And there is no GET route that would serve it from a URL instead.
        assert client.get("/api/v1/auth/totp/setup").status_code == 405

    def test_setup_enable_and_sign_in(self, client, app, outbox):
        import pyotp

        csrf, _ = register_and_sign_in(client, outbox)

        setup = client.post("/api/v1/auth/totp/setup", headers=auth_headers(csrf))
        secret = setup.get_json()["secret"]

        enable = client.post(
            "/api/v1/auth/totp/enable",
            json={"code": pyotp.TOTP(secret).now()},
            headers=auth_headers(csrf),
        )
        assert enable.status_code == 200
        recovery_codes = enable.get_json()["recovery_codes"]
        assert len(recovery_codes) == 10

        fresh = app.test_client()
        first = fresh.post(
            "/api/v1/auth/login", json={"email": "traveller@example.com", "password": PASSWORD}
        )
        assert first.get_json()["status"] == "totp_required"

        second = fresh.post(
            "/api/v1/auth/login",
            json={
                "email": "traveller@example.com",
                "password": PASSWORD,
                "totp_code": pyotp.TOTP(secret).now(),
            },
        )
        assert second.status_code == 200

    def test_a_recovery_code_works_once(self, client, app, outbox):
        import pyotp

        csrf, _ = register_and_sign_in(client, outbox)
        secret = client.post("/api/v1/auth/totp/setup", headers=auth_headers(csrf)).get_json()[
            "secret"
        ]
        codes = client.post(
            "/api/v1/auth/totp/enable",
            json={"code": pyotp.TOTP(secret).now()},
            headers=auth_headers(csrf),
        ).get_json()["recovery_codes"]

        first = app.test_client().post(
            "/api/v1/auth/login",
            json={
                "email": "traveller@example.com",
                "password": PASSWORD,
                "recovery_code": codes[0],
            },
        )
        assert first.status_code == 200

        second = app.test_client().post(
            "/api/v1/auth/login",
            json={
                "email": "traveller@example.com",
                "password": PASSWORD,
                "recovery_code": codes[0],
            },
        )
        assert second.status_code == 401


def _register(client, email: str, password: str = PASSWORD):
    return client.post("/api/v1/auth/register", json={"email": email, "password": password})


def _csrf(client) -> str:
    return client.get("/api/v1/auth/session").get_json()["csrf_token"]
