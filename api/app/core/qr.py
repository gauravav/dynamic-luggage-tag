"""QR encoding.

The symbol encodes a scan URL and nothing else. The token in that URL is a
random 256-bit string: it identifies a row, and reveals nothing by itself.
Putting a name or a phone number in the symbol — as a printed tag or a vCard QR
does — is exactly the exposure this product exists to avoid.
"""

from __future__ import annotations

import segno

# Error correction Q recovers ~25% of the symbol. Luggage tags get scuffed,
# rained on and dragged along belts, so the extra redundancy is worth the
# denser symbol.
ERROR_CORRECTION = "q"


def scan_url(base_url: str, token: str) -> str:
    return f"{base_url.rstrip('/')}/t/{token}"


def encode(data: str) -> segno.QRCode:
    return segno.make(data, error=ERROR_CORRECTION, micro=False)


def matrix(data: str) -> list[list[int]]:
    """The module grid without a quiet zone, as rows of 0/1.

    The caller adds its own quiet zone, because the margin has to be measured
    in the units of the medium it is drawn into.
    """
    return [list(row) for row in encode(data).matrix]


def to_svg(
    data: str, *, size_px: int = 220, dark: str = "#242017", light: str | None = None
) -> str:
    """A standalone SVG symbol, for the dashboard and the scan page."""
    import io

    # segno writes encoded bytes, so a text buffer raises TypeError here.
    buffer = io.BytesIO()
    encode(data).save(
        buffer,
        kind="svg",
        scale=1,
        border=2,
        dark=dark,
        light=light,
        xmldecl=False,
        svgns=True,
        svgclass=None,
        lineclass=None,
        omitsize=True,
        unit=None,
    )
    svg = buffer.getvalue().decode("utf-8")
    # segno emits no width/height with omitsize; add them plus a viewBox so the
    # symbol scales cleanly in a flex layout.
    modules = encode(data).symbol_size(scale=1, border=2)[0]
    return svg.replace(
        "<svg ",
        f'<svg width="{size_px}" height="{size_px}" viewBox="0 0 {modules} {modules}" ',
        1,
    )
