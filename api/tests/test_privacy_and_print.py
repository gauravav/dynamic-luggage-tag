"""Privacy helpers, the design generator, print geometry and retention."""

from __future__ import annotations

import datetime as dt
import re

import pytest

from app.core import design as design_module
from app.core import print_layout
from app.security import privacy


class TestClientAddressHandling:
    def test_addresses_are_truncated_before_hashing(self):
        """A recovered preimage should name a subnet, not a household."""
        pepper = b"k" * 32
        day = dt.date(2026, 1, 1)
        a = privacy.hash_ip(pepper, "203.0.113.7", day=day)
        b = privacy.hash_ip(pepper, "203.0.113.200", day=day)
        assert a == b  # same /24

        c = privacy.hash_ip(pepper, "203.0.114.7", day=day)
        assert a != c  # different /24

    def test_ipv6_is_truncated_to_a_48(self):
        pepper = b"k" * 32
        day = dt.date(2026, 1, 1)
        a = privacy.hash_ip(pepper, "2001:db8:abcd:1234::1", day=day)
        b = privacy.hash_ip(pepper, "2001:db8:abcd:9999::2", day=day)
        assert a == b

    def test_the_salt_rolls_daily(self):
        """Yesterday's hashes cannot be correlated with today's."""
        pepper = b"k" * 32
        monday = privacy.hash_ip(pepper, "203.0.113.7", day=dt.date(2026, 1, 1))
        tuesday = privacy.hash_ip(pepper, "203.0.113.7", day=dt.date(2026, 1, 2))
        assert monday != tuesday

    def test_a_different_pepper_gives_a_different_hash(self):
        day = dt.date(2026, 1, 1)
        assert privacy.hash_ip(b"a" * 32, "203.0.113.7", day=day) != privacy.hash_ip(
            b"b" * 32, "203.0.113.7", day=day
        )

    def test_no_address_yields_no_hash(self):
        assert privacy.hash_ip(b"k" * 32, None) is None


class TestForwardedFor:
    """X-Forwarded-For is attacker-controlled on the left, trusted on the right."""

    def _request(self, forwarded: str | None, remote: str = "10.0.0.1"):
        from werkzeug.test import EnvironBuilder

        headers = {"X-Forwarded-For": forwarded} if forwarded else {}
        return EnvironBuilder(headers=headers, environ_base={"REMOTE_ADDR": remote}).get_request()

    def test_header_is_ignored_when_no_proxy_is_trusted(self):
        request = self._request("1.2.3.4, 5.6.7.8")
        assert privacy.client_ip(request, trusted_proxy_hops=0) == "10.0.0.1"

    def test_counts_from_the_right(self):
        """A client can prepend entries but cannot remove ones our proxy added."""
        request = self._request("9.9.9.9, 1.2.3.4, 5.6.7.8")
        assert privacy.client_ip(request, trusted_proxy_hops=1) == "5.6.7.8"
        assert privacy.client_ip(request, trusted_proxy_hops=2) == "1.2.3.4"

    def test_a_non_address_is_not_accepted(self):
        request = self._request("not-an-ip")
        assert privacy.client_ip(request, trusted_proxy_hops=1) == "10.0.0.1"


class TestClientLabel:
    @pytest.mark.parametrize(
        ("agent", "expected"),
        [
            (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
                "Safari on iOS",
            ),
            (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
                "Chrome on Windows",
            ),
            (None, "Unknown"),
            ("", "Unknown"),
        ],
    )
    def test_reduces_to_a_family(self, agent, expected):
        assert privacy.client_label(agent) == expected

    def test_never_returns_the_raw_agent(self):
        agent = "Mozilla/5.0 (X11; Linux x86_64) Firefox/121.0 SomeUniqueFingerprint/1.2.3"
        label = privacy.client_label(agent)
        assert "SomeUniqueFingerprint" not in label
        assert len(label) < 32


class TestDesign:
    def test_is_deterministic(self):
        seed = bytes(range(16))
        assert design_module.generate(seed) == design_module.generate(seed)

    def test_different_seeds_give_different_designs(self):
        designs = {
            design_module.generate(bytes([i]) * 16).to_dict()["palette"]
            + design_module.generate(bytes([i]) * 16).to_dict()["motif"]
            for i in range(40)
        }
        assert len(designs) > 8

    def test_every_field_is_within_its_documented_range(self):
        for _ in range(200):
            design = design_module.generate(design_module.new_seed())
            assert design.palette in design_module.PALETTES
            assert design.motif in design_module.MOTIFS
            assert 4 <= design.density <= 9
            assert 6 <= design.weight <= 14
            assert 0 <= design.angle < 360 and design.angle % 15 == 0
            assert 0 <= design.offset <= 100
            assert re.fullmatch(r"#[0-9A-Fa-f]{6}", design.ink)

    def test_round_trips_through_storage(self):
        design = design_module.generate(design_module.new_seed())
        assert design_module.from_dict(design.to_dict()) == design

    def test_a_stored_design_survives_missing_fields(self):
        """A tag printed last year must keep rendering the same way."""
        restored = design_module.from_dict({"palette": "forest", "motif": "weave"})
        assert restored.palette == "forest"
        assert restored.motif == "weave"

    def test_seed_length_is_enforced(self):
        with pytest.raises(ValueError, match="16 bytes"):
            design_module.generate(b"short")


class TestPrintGeometry:
    """The supplier's template, to the hundredth of a millimetre."""

    def test_named_sizes_match_the_template(self):
        assert (print_layout.BLEED_H_MM, print_layout.BLEED_W_MM) == (108.40, 74.10)
        assert (print_layout.TRIM_H_MM, print_layout.TRIM_W_MM) == (104.40, 70.10)
        assert (print_layout.SAFE_H_MM, print_layout.SAFE_W_MM) == (99.40, 65.10)

    def test_margins_are_even_on_every_edge(self):
        assert print_layout.BLEED_MARGIN_MM == pytest.approx(2.00)
        assert print_layout.SAFE_MARGIN_MM == pytest.approx(2.50)
        # The same insets must hold vertically, or the boxes are not concentric.
        assert (print_layout.BLEED_H_MM - print_layout.TRIM_H_MM) / 2 == pytest.approx(2.00)
        assert (print_layout.TRIM_H_MM - print_layout.SAFE_H_MM) / 2 == pytest.approx(2.50)

    def test_boxes_are_concentric(self):
        for box in (print_layout.TRIM, print_layout.SAFE):
            assert box.cx == pytest.approx(print_layout.BLEED.cx)
            assert box.y + box.height / 2 == pytest.approx(print_layout.BLEED.height / 2)

    def _boxes(self, pdf: bytes) -> dict[str, list[float]]:
        raw = pdf.decode("latin-1")
        found: dict[str, list[float]] = {}
        for name in ("MediaBox", "BleedBox", "TrimBox", "ArtBox"):
            match = re.search(rf"/{name}\s*\[([^\]]*)\]", raw)
            assert match, f"{name} missing from the PDF"
            points = [float(value) for value in match.group(1).split()]
            found[name] = [round(value / 72 * 25.4, 2) for value in points]
        return found

    @pytest.fixture
    def pdf(self):
        face = print_layout.TagFace(
            design=design_module.generate(bytes(range(16))),
            scan_url="https://example.com/t/" + "a" * 43,
            display_name="R. Fernandez",
            subtitle="Blue carry-on",
        )
        return print_layout.render(face)

    def test_pdf_declares_all_four_boxes_at_the_right_sizes(self, pdf):
        boxes = self._boxes(pdf)

        def size(name):
            x0, y0, x1, y1 = boxes[name]
            return round(x1 - x0, 2), round(y1 - y0, 2)

        assert size("MediaBox") == (74.10, 108.40)
        assert size("BleedBox") == (74.10, 108.40)
        assert size("TrimBox") == (70.10, 104.40)
        assert size("ArtBox") == (65.10, 99.40)

    def test_trim_and_art_boxes_are_inset_evenly(self, pdf):
        boxes = self._boxes(pdf)
        assert boxes["TrimBox"][:2] == [2.00, 2.00]
        assert boxes["ArtBox"][:2] == [4.50, 4.50]

    def test_fonts_are_embedded(self, pdf):
        """Many print workflows reject a PDF that relies on the standard 14."""
        assert b"/FontFile2" in pdf

    def test_metadata_carries_no_identity(self, pdf):
        for marker in (b"/Author (", b"/Creator (", b"/Producer (ReportLab"):
            if marker in pdf:
                start = pdf.index(marker) + len(marker)
                assert pdf[start : start + 1] == b")", f"{marker!r} is not empty"

    def test_a_long_name_does_not_escape_the_safety_box(self):
        face = print_layout.TagFace(
            design=design_module.generate(bytes(range(16))),
            scan_url="https://example.com/t/" + "a" * 43,
            display_name="Bartholomew Featherstonehaugh-Cholmondeley III",
            subtitle="The very large wheeled suitcase with the broken handle",
        )
        assert print_layout.render(face).startswith(b"%PDF")

    def test_every_symbol_is_well_formed_xml(self):
        """One malformed symbol is a scan page that will not draw."""
        import xml.etree.ElementTree as ElementTree

        from app.core import qr

        for url in (
            "https://example.com/t/" + "a" * 43,
            "https://example.com/dynamic-luggage-tag/t/" + "z" * 43,
            "https://example.com/t/short",
        ):
            # noqa justified: the input is this module's own output, not a
            # document from anywhere else.
            root = ElementTree.fromstring(qr.to_svg(url))  # noqa: S314
            assert root.get("viewBox"), url

    def test_renders_for_every_motif_and_palette(self):
        for motif in design_module.MOTIFS:
            for palette in design_module.PALETTES:
                design = design_module.from_dict(
                    {"motif": motif, "palette": palette, "accent_band": True}
                )
                face = print_layout.TagFace(
                    design=design, scan_url="https://example.com/t/abc", display_name="A. Okafor"
                )
                assert print_layout.render(face, include_back=True).startswith(b"%PDF")


class TestRetention:
    def test_purge_deletes_only_expired_rows(self, app, outbox):
        import uuid

        from app.extensions import db_session
        from app.models import ScanEvent, Tag, User, utcnow
        from app.security import crypto
        from app.services import accounts, retention

        with app.app_context():
            db = db_session()
            config = app.extensions["dlt_config"]
            user, user_crypto = accounts.create_user(
                db,
                email="ana@example.com",
                password="a long enough passphrase",
                name="Ana",
                config=config,
                keyring=app.extensions["keyring"],
                hasher=app.extensions["password_hasher"],
            )
            token = crypto.new_token()
            tag = Tag(
                id=uuid.uuid4(),
                user_id=user.id,
                token_hash=crypto.hash_token(config.token_pepper, "tag", token),
                design={},
            )
            user_crypto.write_tag(tag, "token", token)
            db.add(tag)

            db.add(
                ScanEvent(
                    id=uuid.uuid4(),
                    tag_id=tag.id,
                    occurred_at=utcnow() - dt.timedelta(days=200),
                    expires_at=utcnow() - dt.timedelta(days=100),
                )
            )
            db.add(
                ScanEvent(
                    id=uuid.uuid4(),
                    tag_id=tag.id,
                    occurred_at=utcnow(),
                    expires_at=utcnow() + dt.timedelta(days=90),
                )
            )
            db.commit()

            assert db.query(ScanEvent).count() == 2
            counts = retention.purge_expired(db)
            assert counts["scan_events"] == 1
            assert db.query(ScanEvent).count() == 1
            assert db.query(User).count() == 1


class TestBackFaceClearance:
    def test_instructions_never_run_into_the_qr_block(self):
        """Text over a symbol's quiet zone can stop it scanning."""
        import io
        from unittest import mock

        from reportlab.pdfgen import canvas

        print_layout._register_fonts()
        original_wrapped = print_layout._draw_wrapped
        original_qr = print_layout._draw_qr

        for motif in design_module.MOTIFS:
            for palette in design_module.PALETTES:
                baselines: list[float] = []
                boxes: list = []

                def wrapped(pdf, text, baselines=baselines, **kwargs):
                    y = original_wrapped(pdf, text, **kwargs)
                    baselines.append(y + kwargs["leading"])
                    return y

                def qr(pdf, box, url, color, boxes=boxes):
                    boxes.append(box)
                    return original_qr(pdf, box, url, color)

                face = print_layout.TagFace(
                    design=design_module.from_dict({"motif": motif, "palette": palette}),
                    scan_url="https://example.com/t/" + "a" * 43,
                )
                with (
                    mock.patch.object(print_layout, "_draw_wrapped", wrapped),
                    mock.patch.object(print_layout, "_draw_qr", qr),
                ):
                    pdf = canvas.Canvas(io.BytesIO())
                    print_layout._draw_back(pdf, face, guides=False)

                gap_mm = (min(baselines) - boxes[-1].top) / print_layout.mm
                assert gap_mm >= 3, f"{palette} {motif}: only {gap_mm:.2f} mm above the QR"
