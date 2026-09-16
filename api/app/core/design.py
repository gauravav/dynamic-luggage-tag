"""Deterministic visual identity for a traveller.

One traveller, one design, on every bag they own — that is the whole point of
the product, so the design has to be reproducible from stored state rather than
generated once and saved as an image.

It is derived from ``design_seed``, 16 random bytes, and never from the user's
name or email. A design derived from personal data would leak that data to
anyone who could enumerate designs, which defeats the tag's purpose.

The same spec is rendered twice: here for the print PDF, and in
``web/src/lib/design.ts`` for the browser. Both read the same JSON document, so
a change to the palette or motif list needs to land in both places.
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import asdict, dataclass

SPEC_VERSION = 1
SEED_BYTES = 16

# Palettes are fixed, named and colour-checked rather than randomly generated:
# a random hue picker eventually produces a tag nobody can pick out on a belt.
PALETTES: dict[str, dict[str, str]] = {
    "forest": {"field": "#EDF1EC", "ink": "#2F5D4E", "accent": "#8C6221"},
    "brick": {"field": "#F7EDE9", "ink": "#9C3B2A", "accent": "#2F5D4E"},
    "brass": {"field": "#F6EFDE", "ink": "#8C6221", "accent": "#1F4034"},
    "indigo": {"field": "#ECEEF6", "ink": "#33447A", "accent": "#9C3B2A"},
    "plum": {"field": "#F3EBF1", "ink": "#6B3560", "accent": "#8C6221"},
    "teal": {"field": "#E8F1F1", "ink": "#1F5C63", "accent": "#9C3B2A"},
    "ochre": {"field": "#F7F0E3", "ink": "#A56A16", "accent": "#33447A"},
    "slate": {"field": "#EDEFF0", "ink": "#3B4A52", "accent": "#9C3B2A"},
}

# Every motif is drawable from rectangles, circles and straight lines, so the
# SVG and the PDF renderer produce the same marks without a shared library.
MOTIFS = ("weave", "dot", "diagonal", "chevron", "grid", "ladder")

PALETTE_NAMES = tuple(PALETTES)


@dataclass(frozen=True)
class Design:
    version: int
    palette: str
    field: str
    ink: str
    accent: str
    motif: str
    density: int  # marks across the short edge, 4-9
    weight: int  # stroke weight in tenths of a millimetre, 6-14
    angle: int  # motif rotation in degrees
    offset: int  # phase shift, 0-100 as a percentage of one period
    accent_band: bool  # draw a solid accent band under the name plate

    def to_dict(self) -> dict:
        return asdict(self)


def new_seed() -> bytes:
    return os.urandom(SEED_BYTES)


def _stream(seed: bytes) -> bytes:
    """Expands the seed into enough deterministic bytes to make every choice.

    SHA-256 in counter mode. Not a security boundary — the output is public
    artwork — but keyed off a secret-ish seed so designs are unguessable
    without the row, and stable forever for a given seed.
    """
    out = b""
    counter = 0
    while len(out) < 32:
        out += hashlib.sha256(seed + counter.to_bytes(2, "big") + b"dlt-design-v1").digest()
        counter += 1
    return out


def generate(seed: bytes) -> Design:
    """The design for a seed. Pure: same seed in, same design out, forever."""
    if len(seed) != SEED_BYTES:
        raise ValueError(f"design seed must be {SEED_BYTES} bytes")

    b = _stream(seed)
    palette_name = PALETTE_NAMES[b[0] % len(PALETTE_NAMES)]
    palette = PALETTES[palette_name]
    motif = MOTIFS[b[1] % len(MOTIFS)]

    return Design(
        version=SPEC_VERSION,
        palette=palette_name,
        field=palette["field"],
        ink=palette["ink"],
        accent=palette["accent"],
        motif=motif,
        density=4 + (b[2] % 6),
        weight=6 + (b[3] % 9),
        # Quantised to 15 degrees: arbitrary angles read as a printing mistake.
        angle=(b[4] % 12) * 15,
        offset=b[5] % 101,
        accent_band=bool(b[6] & 1),
    )


def from_dict(data: dict) -> Design:
    """Rebuilds a Design from a stored document, filling gaps from defaults.

    Stored designs outlive code changes; a tag printed last year must keep
    rendering the same way even if the spec grows a field.
    """
    palette = PALETTES.get(data.get("palette", "forest"), PALETTES["forest"])
    return Design(
        version=int(data.get("version", SPEC_VERSION)),
        palette=str(data.get("palette", "forest")),
        field=str(data.get("field", palette["field"])),
        ink=str(data.get("ink", palette["ink"])),
        accent=str(data.get("accent", palette["accent"])),
        motif=str(data.get("motif", "weave")),
        density=int(data.get("density", 6)),
        weight=int(data.get("weight", 10)),
        angle=int(data.get("angle", 45)),
        offset=int(data.get("offset", 0)),
        accent_band=bool(data.get("accent_band", False)),
    )


def public_view(design: Design) -> dict:
    """The design as shown to a finder: colours and motif, nothing else."""
    return design.to_dict()
