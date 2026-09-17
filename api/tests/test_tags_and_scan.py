"""Tags, the public scan page, and the masked relay.

The centre of gravity here is what a stranger can see. A tag marked safe must
leak nothing; a tag marked lost must leak only what the owner opted into.
"""

from __future__ import annotations

from conftest import auth_headers, register_and_sign_in

PASSWORD = "correct horse battery staple"


def _make_tag(client, csrf, label="Blue carry-on"):
    response = client.post("/api/v1/tags", json={"label": label}, headers=auth_headers(csrf))
    assert response.status_code == 201, response.get_json()
    return response.get_json()["tag"]


def _token_from_url(scan_url: str) -> str:
    return scan_url.rsplit("/", 1)[-1]


class TestTagLifecycle:
    def test_create_read_and_list(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)

        assert tag["status"] == "safe"
        assert tag["label"] == "Blue carry-on"
        assert tag["scan_url"].startswith("http")

        listed = client.get("/api/v1/tags").get_json()["tags"]
        assert len(listed) == 1
        # The list view omits the scan URL; only the detail view carries it.
        assert "scan_url" not in listed[0]

    def test_every_tag_shares_one_design(self, client, outbox):
        """One traveller, one design — the product's whole recognition story."""
        csrf, _ = register_and_sign_in(client, outbox)
        first = _make_tag(client, csrf, "Carry-on")
        second = _make_tag(client, csrf, "Duffel")
        assert first["design"] == second["design"]

    def test_design_is_not_derived_from_personal_data(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        design = _make_tag(client, csrf)["design"]
        serialized = str(design).lower()
        for personal in ("rosa", "fernandez", "traveller", "example.com"):
            assert personal not in serialized

    def test_another_user_cannot_read_a_tag(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox, email="owner@example.com")
        tag = _make_tag(client, csrf)

        intruder = app.test_client()
        intruder_csrf, _ = register_and_sign_in(intruder, outbox, email="intruder@example.com")

        response = intruder.get(f"/api/v1/tags/{tag['id']}")
        # 404, not 403: confirming the id exists would be an enumeration oracle.
        assert response.status_code == 404
        assert response.get_json()["error"]["code"] == "not_found"

    def test_marking_lost_records_the_time(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        response = client.patch(
            f"/api/v1/tags/{tag['id']}", json={"status": "lost"}, headers=auth_headers(csrf)
        )
        assert response.get_json()["tag"]["status"] == "lost"
        assert response.get_json()["tag"]["lost_at"] is not None

    def test_rotating_the_token_invalidates_the_old_one(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        old_token = _token_from_url(tag["scan_url"])

        rotated = client.post(
            f"/api/v1/tags/{tag['id']}/rotate", headers=auth_headers(csrf)
        ).get_json()["tag"]
        assert _token_from_url(rotated["scan_url"]) != old_token

        assert client.get(f"/api/v1/scan/{old_token}").status_code == 404
        assert client.get(f"/api/v1/scan/{_token_from_url(rotated['scan_url'])}").status_code == 200

    def test_deleting_a_tag_takes_its_scan_history_with_it(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        token = _token_from_url(tag["scan_url"])

        app.test_client().post(f"/api/v1/scan/{token}/view")
        client.delete(f"/api/v1/tags/{tag['id']}", headers=auth_headers(csrf))

        assert client.get(f"/api/v1/scan/{token}").status_code == 404
        with app.app_context():
            from app.extensions import db_session
            from app.models import ScanEvent

            assert db_session().query(ScanEvent).count() == 0


class TestPublicScanPage:
    def test_safe_tag_reveals_nothing_personal(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        token = _token_from_url(tag["scan_url"])

        body = app.test_client().get(f"/api/v1/scan/{token}").get_json()
        assert body["status"] == "safe"
        assert body["owner"] is None
        assert body["relay_available"] is False

        serialized = str(body).lower()
        for personal in ("rosa", "fernandez", "traveller@example.com"):
            assert personal not in serialized

    def test_lost_tag_reveals_only_the_name(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        client.patch(
            f"/api/v1/tags/{tag['id']}", json={"status": "lost"}, headers=auth_headers(csrf)
        )
        client.patch(
            "/api/v1/account",
            json={"phone": "+1 555 0100", "address": "12 Elm Street, Dallas"},
            headers=auth_headers(csrf),
        )

        body = app.test_client().get(f"/api/v1/scan/{_token_from_url(tag['scan_url'])}").get_json()
        assert body["status"] == "lost"
        assert body["owner"]["name"] == "Rosa Fernandez"

        serialized = str(body).lower()
        # The name, and nothing else. Address in particular has no path here.
        assert "elm street" not in serialized
        assert "555" not in serialized
        assert "traveller@example.com" not in serialized

    def test_owner_can_withhold_the_name_even_when_lost(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        client.patch(
            f"/api/v1/tags/{tag['id']}",
            json={"status": "lost", "reveal_name": False},
            headers=auth_headers(csrf),
        )
        body = app.test_client().get(f"/api/v1/scan/{_token_from_url(tag['scan_url'])}").get_json()
        assert body["owner"] is None

    def test_unknown_token_is_a_plain_not_found(self, client):
        response = client.get("/api/v1/scan/" + "z" * 43)
        assert response.status_code == 404
        assert response.get_json()["error"]["code"] == "not_found"

    def test_reading_the_page_does_not_record_a_scan(self, client, app, outbox):
        """Link previews and prefetches must not reach the owner's history."""
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        token = _token_from_url(tag["scan_url"])

        app.test_client().get(f"/api/v1/scan/{token}")
        assert client.get(f"/api/v1/tags/{tag['id']}/scans").get_json()["scans"] == []

    def test_recording_a_scan_notifies_the_owner(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        outbox.clear()

        app.test_client().post(f"/api/v1/scan/{_token_from_url(tag['scan_url'])}/view")

        scans = client.get(f"/api/v1/tags/{tag['id']}/scans").get_json()["scans"]
        assert len(scans) == 1
        assert len(outbox) == 1
        assert "scanned" in outbox[0]["subject"].lower()

    def test_repeat_scans_are_deduplicated(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        token = _token_from_url(tag["scan_url"])

        finder = app.test_client()
        first = finder.post(f"/api/v1/scan/{token}/view").get_json()
        second = finder.post(f"/api/v1/scan/{token}/view").get_json()

        assert first["duplicate"] is False
        assert second["duplicate"] is True
        assert len(client.get(f"/api/v1/tags/{tag['id']}/scans").get_json()["scans"]) == 1

    def test_scan_history_stores_no_raw_address(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        app.test_client().post(f"/api/v1/scan/{_token_from_url(tag['scan_url'])}/view")

        with app.app_context():
            from app.extensions import db_session
            from app.models import ScanEvent

            scan = db_session().query(ScanEvent).one()
            assert scan.ip_hash is not None
            assert len(scan.ip_hash) == 32
            # No column holds an address, and the label is a family name only.
            assert not hasattr(scan, "ip_address")
            assert scan.client_label in {"Unknown", "Chrome on Linux"} or "on" in scan.client_label

    def test_location_sharing_is_opt_in(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        token = _token_from_url(tag["scan_url"])

        finder = app.test_client()
        finder.post(f"/api/v1/scan/{token}/view")
        declined = finder.post(f"/api/v1/scan/{token}/location", json={"share": False})
        assert declined.get_json()["status"] == "declined"

        scans = client.get(f"/api/v1/tags/{tag['id']}/scans").get_json()["scans"]
        assert scans[0]["shared_location"] is False
        assert scans[0]["location"] is None

    def test_shared_location_is_recorded_and_encrypted(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        token = _token_from_url(tag["scan_url"])

        finder = app.test_client()
        finder.post(f"/api/v1/scan/{token}/view")
        shared = finder.post(
            f"/api/v1/scan/{token}/location",
            json={"share": True, "city": "Dallas", "region": "TX", "country": "US"},
        )
        assert shared.get_json()["status"] == "shared"

        scans = client.get(f"/api/v1/tags/{tag['id']}/scans").get_json()["scans"]
        assert "Dallas" in scans[0]["location"]

        with app.app_context():
            from app.extensions import db_session
            from app.models import ScanEvent

            stored = db_session().query(ScanEvent).first()
            assert b"Dallas" not in bytes(stored.location_enc)

    def test_location_input_is_sanitised(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        token = _token_from_url(tag["scan_url"])

        finder = app.test_client()
        finder.post(f"/api/v1/scan/{token}/view")
        finder.post(
            f"/api/v1/scan/{token}/location",
            json={"share": True, "city": "<script>alert(1)</script>", "country": "US"},
        )
        scans = client.get(f"/api/v1/tags/{tag['id']}/scans").get_json()["scans"]
        assert "<script>" not in (scans[0]["location"] or "")


class TestRelay:
    def _lost_tag(self, client, csrf):
        tag = _make_tag(client, csrf)
        client.patch(
            f"/api/v1/tags/{tag['id']}", json={"status": "lost"}, headers=auth_headers(csrf)
        )
        return tag

    def test_a_safe_tag_accepts_no_messages(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        response = app.test_client().post(
            f"/api/v1/scan/{_token_from_url(tag['scan_url'])}/message",
            json={"body": "I found your bag"},
        )
        assert response.status_code == 403

    def test_finder_and_owner_exchange_messages_without_contact_details(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = self._lost_tag(client, csrf)
        outbox.clear()

        finder = app.test_client()
        opened = finder.post(
            f"/api/v1/scan/{_token_from_url(tag['scan_url'])}/message",
            json={"body": "Found this at DFW baggage claim 3.", "contact": "+1 555 9999"},
        )
        assert opened.status_code == 201
        relay_token = opened.get_json()["relay_token"]

        # The owner is told a message arrived, but not what it says.
        assert len(outbox) == 1
        assert "DFW" not in outbox[0]["body"]

        threads = client.get("/api/v1/threads").get_json()["threads"]
        assert len(threads) == 1
        thread = client.get(f"/api/v1/threads/{threads[0]['id']}").get_json()["thread"]
        assert thread["messages"][0]["body"] == "Found this at DFW baggage claim 3."
        assert thread["finder_contact"] == "+1 555 9999"

        client.post(
            f"/api/v1/threads/{threads[0]['id']}/reply",
            json={"body": "Thank you — I will come to claim 3."},
            headers=auth_headers(csrf),
        )

        finder_view = finder.get(f"/api/v1/relay/{relay_token}").get_json()["thread"]
        assert len(finder_view["messages"]) == 2
        # The finder learns nothing about the owner beyond the published name.
        serialized = str(finder_view).lower()
        assert "traveller@example.com" not in serialized
        assert "finder_contact" not in finder_view

    def test_message_bodies_are_encrypted_at_rest(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = self._lost_tag(client, csrf)
        app.test_client().post(
            f"/api/v1/scan/{_token_from_url(tag['scan_url'])}/message",
            json={"body": "distinctive plaintext marker"},
        )
        with app.app_context():
            from app.extensions import db_session
            from app.models import RelayMessage

            stored = db_session().query(RelayMessage).one()
            assert b"distinctive plaintext marker" not in bytes(stored.body_enc)

    def test_an_unknown_relay_token_is_a_plain_not_found(self, client):
        assert client.get("/api/v1/relay/" + "z" * 43).status_code == 404

    def test_rotating_the_tag_closes_open_conversations(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = self._lost_tag(client, csrf)
        finder = app.test_client()
        relay_token = finder.post(
            f"/api/v1/scan/{_token_from_url(tag['scan_url'])}/message",
            json={"body": "Found it"},
        ).get_json()["relay_token"]

        client.post(f"/api/v1/tags/{tag['id']}/rotate", headers=auth_headers(csrf))

        response = finder.post(f"/api/v1/relay/{relay_token}/reply", json={"body": "Hello?"})
        assert response.status_code == 409


class TestFinderEmailUpdates:
    """A finder who leaves an email gets the link and reply notices; the owner never sees it."""

    FINDER = "finder@example.net"

    def _open(self, client, app, outbox, **extra):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = TestRelay()._lost_tag(client, csrf)
        outbox.clear()
        finder = app.test_client()
        opened = finder.post(
            f"/api/v1/scan/{_token_from_url(tag['scan_url'])}/message",
            json={"body": "Found this at DFW baggage claim 3.", **extra},
        )
        assert opened.status_code == 201, opened.get_json()
        thread_id = client.get("/api/v1/threads").get_json()["threads"][0]["id"]
        return csrf, finder, opened.get_json(), thread_id

    def _reply(self, client, csrf, thread_id, body="Thank you!"):
        response = client.post(
            f"/api/v1/threads/{thread_id}/reply", json={"body": body}, headers=auth_headers(csrf)
        )
        assert response.status_code == 201
        return response.get_json()["thread"]

    def test_finder_is_emailed_the_link_and_owner_replies(self, client, app, outbox):
        csrf, finder, opened, thread_id = self._open(client, app, outbox, email=self.FINDER)
        relay_token = opened["relay_token"]
        assert opened["email_updates"] is True

        to_finder = [mail for mail in outbox if mail["to"] == self.FINDER]
        assert len(to_finder) == 1
        assert f"/r/{relay_token}" in to_finder[0]["body"]
        assert "DFW" not in to_finder[0]["body"]

        outbox.clear()
        self._reply(client, csrf, thread_id, body="I will come to claim 3.")
        assert len(outbox) == 1
        assert outbox[0]["to"] == self.FINDER
        assert f"/r/{relay_token}" in outbox[0]["body"]
        # The reply stays behind the link.
        assert "claim 3" not in outbox[0]["body"]

    def test_the_owner_never_sees_the_finders_email(self, client, app, outbox):
        csrf, _, _, thread_id = self._open(client, app, outbox, email=self.FINDER)
        thread = client.get(f"/api/v1/threads/{thread_id}").get_json()["thread"]
        assert thread["email_updates"] is True
        assert self.FINDER not in str(thread)
        assert self.FINDER not in str(client.get("/api/v1/threads").get_json())
        assert self.FINDER not in client.get("/api/v1/account/export").get_data(as_text=True)

        with app.app_context():
            from app.extensions import db_session
            from app.models import RelayThread

            stored = db_session().query(RelayThread).one()
            assert self.FINDER.encode() not in bytes(stored.finder_email_enc)

    def test_reply_emails_respect_the_cooldown(self, client, app, outbox):
        csrf, _, _, thread_id = self._open(client, app, outbox, email=self.FINDER)
        outbox.clear()
        self._reply(client, csrf, thread_id, body="First")
        self._reply(client, csrf, thread_id, body="Second")
        assert len(outbox) == 1

    def test_no_email_means_no_finder_mail(self, client, app, outbox):
        csrf, _, opened, thread_id = self._open(client, app, outbox)
        assert opened["email_updates"] is False
        # Only the owner's own notice went out.
        assert all(mail["to"] != self.FINDER for mail in outbox)
        outbox.clear()
        self._reply(client, csrf, thread_id)
        assert outbox == []

    def test_finder_can_stop_email_updates(self, client, app, outbox):
        csrf, finder, opened, thread_id = self._open(client, app, outbox, email=self.FINDER)
        response = finder.delete(f"/api/v1/relay/{opened['relay_token']}/email")
        assert response.status_code == 200
        assert response.get_json()["thread"]["email_updates"] is False

        with app.app_context():
            from app.extensions import db_session
            from app.models import RelayThread

            stored = db_session().query(RelayThread).one()
            assert stored.finder_email_enc is None
            assert stored.finder_token_enc is None

        outbox.clear()
        self._reply(client, csrf, thread_id)
        assert outbox == []

    def test_rejects_an_invalid_email(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = TestRelay()._lost_tag(client, csrf)
        response = app.test_client().post(
            f"/api/v1/scan/{_token_from_url(tag['scan_url'])}/message",
            json={"body": "Found it", "email": "not an email"},
        )
        assert response.status_code == 400
        assert "email" in response.get_json()["error"]["fields"]


class TestAccount:
    def test_export_includes_everything_and_is_an_attachment(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        app.test_client().post(f"/api/v1/scan/{_token_from_url(tag['scan_url'])}/view")

        response = client.get("/api/v1/account/export")
        assert response.status_code == 200
        assert "attachment" in response.headers["Content-Disposition"]
        body = response.get_json()
        assert body["account"]["email"] == "traveller@example.com"
        assert len(body["tags"]) == 1
        assert len(body["tags"][0]["scans"]) == 1

    def test_deleting_the_account_destroys_the_key(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        _make_tag(client, csrf)

        response = client.delete(
            "/api/v1/account",
            json={"password": PASSWORD, "confirm": "DELETE"},
            headers=auth_headers(csrf),
        )
        assert response.status_code == 200

        with app.app_context():
            from app.extensions import db_session
            from app.models import Tag, User

            assert db_session().query(User).count() == 0
            assert db_session().query(Tag).count() == 0

    def test_deletion_frees_the_address_for_reuse(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox, email="ana@example.com")
        client.delete(
            "/api/v1/account",
            json={"password": PASSWORD, "confirm": "DELETE"},
            headers=auth_headers(csrf),
        )
        response = app.test_client().post(
            "/api/v1/auth/register", json={"email": "ana@example.com", "password": PASSWORD}
        )
        assert response.status_code == 202
        assert outbox[-1]["subject"] == "Confirm your email address"

    def test_deletion_requires_the_password(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        response = client.delete(
            "/api/v1/account",
            json={"password": "not my password", "confirm": "DELETE"},
            headers=auth_headers(csrf),
        )
        assert response.status_code == 401


class TestPrintPdf:
    def test_pdf_is_produced_at_the_template_size(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)

        response = client.get(f"/api/v1/tags/{tag['id']}/print.pdf")
        assert response.status_code == 200
        assert response.mimetype == "application/pdf"
        assert response.data.startswith(b"%PDF")

    def test_pdf_carries_no_account_metadata(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        pdf = client.get(f"/api/v1/tags/{tag['id']}/print.pdf").data
        assert b"traveller@example.com" not in pdf

    def test_qr_svg_is_served(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        response = client.get(f"/api/v1/tags/{tag['id']}/qr.svg")
        assert response.status_code == 200
        assert response.mimetype == "image/svg+xml"
        assert b"<svg" in response.data


class TestSecurityHeaders:
    def test_responses_are_hardened(self, client):
        response = client.get("/api/v1/health")
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert response.headers["X-Frame-Options"] == "DENY"
        assert response.headers["Referrer-Policy"] == "no-referrer"
        assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
        assert "no-store" in response.headers["Cache-Control"]

    def test_an_unlisted_origin_gets_no_cors_grant(self, client):
        response = client.get("/api/v1/health", headers={"Origin": "https://evil.example"})
        assert "Access-Control-Allow-Origin" not in response.headers

    def test_the_configured_origin_is_allowed(self, client):
        response = client.get("/api/v1/health", headers={"Origin": "http://localhost:5173"})
        assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
        assert response.headers["Access-Control-Allow-Credentials"] == "true"


class TestNfcBinding:
    """A chip, once linked, can only be written through the site by its owner."""

    SERIAL = "04:a2:3b:1c:5d:80:00"

    def _bind(self, client, csrf, tag_id, serial=SERIAL, **extra):
        return client.post(
            f"/api/v1/tags/{tag_id}/nfc",
            json={"serial": serial, **extra},
            headers=auth_headers(csrf),
        )

    def _lookup(self, client, csrf, serial=SERIAL):
        return client.post(
            "/api/v1/tags/nfc/lookup", json={"serial": serial}, headers=auth_headers(csrf)
        ).get_json()

    def test_owner_links_a_chip(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        assert tag["nfc_linked"] is False

        response = self._bind(client, csrf, tag["id"])
        assert response.status_code == 200, response.get_json()
        assert response.get_json()["tag"]["nfc_linked"] is True

        # Rebinding the same chip is idempotent, and the serial format is normalized.
        again = self._bind(client, csrf, tag["id"], serial="04A23B1C5D8000")
        assert again.status_code == 200

        found = self._lookup(client, csrf)
        assert found["registered"] == "mine"
        assert found["tag"]["id"] == tag["id"]
        assert found["tag"]["scan_url"] == tag["scan_url"]

    def test_the_same_owner_can_rewrite_from_another_device(self, client, app, outbox):
        csrf, email = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        assert self._bind(client, csrf, tag["id"]).status_code == 200

        phone = app.test_client()
        login = phone.post(
            "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
        ).get_json()
        response = self._bind(phone, login["csrf_token"], tag["id"])
        assert response.status_code == 200, response.get_json()

    def test_another_account_cannot_claim_a_linked_chip(self, client, app, outbox):
        csrf, _ = register_and_sign_in(client, outbox, email="owner@example.com")
        assert self._bind(client, csrf, _make_tag(client, csrf)["id"]).status_code == 200

        intruder = app.test_client()
        intruder_csrf, _ = register_and_sign_in(intruder, outbox, email="intruder@example.com")
        their_tag = _make_tag(intruder, intruder_csrf)

        for replace in (False, True):
            response = self._bind(intruder, intruder_csrf, their_tag["id"], replace=replace)
            assert response.status_code == 409
            assert response.get_json()["error"]["code"] == "nfc_chip_claimed"

        # They learn only that it is someone else's: no id, no label.
        assert self._lookup(intruder, intruder_csrf) == {"registered": "other"}

    def test_moving_a_chip_between_own_tags_needs_confirmation(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        first = _make_tag(client, csrf, "Carry-on")
        second = _make_tag(client, csrf, "Duffel")
        assert self._bind(client, csrf, first["id"]).status_code == 200

        response = self._bind(client, csrf, second["id"])
        assert response.status_code == 409
        assert response.get_json()["error"]["code"] == "nfc_chip_on_other_tag"

        moved = self._bind(client, csrf, second["id"], replace=True)
        assert moved.status_code == 200
        assert client.get(f"/api/v1/tags/{first['id']}").get_json()["tag"]["nfc_linked"] is False
        assert self._lookup(client, csrf)["tag"]["id"] == second["id"]

    def test_replacing_a_tags_sticker_needs_confirmation(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        assert self._bind(client, csrf, tag["id"]).status_code == 200

        response = self._bind(client, csrf, tag["id"], serial="04:11:22:33:44:55:66")
        assert response.get_json()["error"]["code"] == "nfc_tag_has_other_chip"
        replaced = self._bind(client, csrf, tag["id"], serial="04:11:22:33:44:55:66", replace=True)
        assert replaced.status_code == 200
        assert self._lookup(client, csrf)["registered"] == "none"

    def test_unlinking_releases_the_chip(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        self._bind(client, csrf, tag["id"])

        response = client.delete(f"/api/v1/tags/{tag['id']}/nfc", headers=auth_headers(csrf))
        assert response.get_json()["tag"]["nfc_linked"] is False
        assert self._lookup(client, csrf)["registered"] == "none"

    def test_rejects_a_malformed_serial(self, client, outbox):
        csrf, _ = register_and_sign_in(client, outbox)
        tag = _make_tag(client, csrf)
        response = self._bind(client, csrf, tag["id"], serial="not-a-serial")
        assert response.status_code == 400
        assert "serial" in response.get_json()["error"]["fields"]
