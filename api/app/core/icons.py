"""Bag icons, as geometry rather than glyphs.

An icon is printed on the physical tag and drawn in the browser preview, so it
has the same problem the motif has: two renderers that must agree. The answer
is the same one — the shapes live in exactly one place, as data, and both
renderers only draw what they are given. ``web/src/lib/icons.ts`` is the
line-for-line port, and ``tests/test_motif_parity.py`` compares the two.

Coordinates are in a 0-100 box with the origin at the **bottom-left**, y
increasing upward (PDF's convention). The caller scales the box to whatever
size it is drawing at.

Two tones only:

``ink``
    The colour the owner chose for the icon.
``paper``
    The surface behind it, used to cut detail out of a filled shape — a zip, a
    strap, a pocket — without needing a second colour or a real hole.
"""

from __future__ import annotations

from typing import Any

Op = dict[str, Any]

# The owner picks from a fixed list. Free-form colour would let someone choose
# an icon that is invisible against their own field colour, and a free-form
# icon name would be one more string to sanitise before it reaches a PDF.
ICON_COLORS: dict[str, str] = {
    "ink": "#242017",
    "forest": "#2F5D4E",
    "brick": "#9C3B2A",
    "brass": "#8C6221",
    "indigo": "#33447A",
    "plum": "#6B3560",
    "teal": "#1F5C63",
    "ochre": "#A56A16",
    "slate": "#3B4A52",
}
DEFAULT_ICON_COLOR = "ink"


ICONS: dict[str, list[Op]] = {
    "suitcase": [
        {
            "kind": "stroke",
            "points": [[38, 74], [38, 86], [44, 92], [56, 92], [62, 86], [62, 74]],
            "width": 6.0,
            "tone": "ink",
        },
        {"kind": "rrect", "x": 10, "y": 10, "w": 80, "h": 66, "r": 9, "tone": "ink"},
        {"kind": "rect", "x": 28, "y": 10, "w": 8, "h": 66, "tone": "paper"},
        {"kind": "rect", "x": 64, "y": 10, "w": 8, "h": 66, "tone": "paper"},
        {"kind": "rect", "x": 44, "y": 44, "w": 12, "h": 7, "tone": "paper"},
    ],
    "roller": [
        {
            "kind": "stroke",
            "points": [[36, 70], [36, 94], [64, 94], [64, 70]],
            "width": 6.0,
            "tone": "ink",
        },
        {"kind": "rrect", "x": 14, "y": 16, "w": 72, "h": 58, "r": 8, "tone": "ink"},
        {"kind": "rect", "x": 14, "y": 43, "w": 72, "h": 5, "tone": "paper"},
        {"kind": "circle", "cx": 27, "cy": 9, "r": 7, "tone": "ink"},
        {"kind": "circle", "cx": 73, "cy": 9, "r": 7, "tone": "ink"},
    ],
    "duffel": [
        {
            "kind": "stroke",
            "points": [[33, 60], [37, 82], [63, 82], [67, 60]],
            "width": 6.0,
            "tone": "ink",
        },
        {"kind": "rrect", "x": 6, "y": 22, "w": 88, "h": 44, "r": 22, "tone": "ink"},
        {"kind": "rect", "x": 22, "y": 41, "w": 56, "h": 5, "tone": "paper"},
    ],
    "backpack": [
        {"kind": "rect", "x": 25, "y": 58, "w": 9, "h": 26, "tone": "ink"},
        {"kind": "rect", "x": 66, "y": 58, "w": 9, "h": 26, "tone": "ink"},
        {"kind": "rrect", "x": 12, "y": 6, "w": 76, "h": 72, "r": 20, "tone": "ink"},
        {"kind": "rect", "x": 12, "y": 54, "w": 76, "h": 5, "tone": "paper"},
        {"kind": "rrect", "x": 32, "y": 16, "w": 36, "h": 26, "r": 7, "tone": "paper"},
    ],
    "tote": [
        {
            "kind": "stroke",
            "points": [[30, 58], [34, 82], [66, 82], [70, 58]],
            "width": 6.0,
            "tone": "ink",
        },
        {"kind": "poly", "points": [[14, 8], [86, 8], [78, 62], [22, 62]], "tone": "ink"},
        {"kind": "rect", "x": 24, "y": 42, "w": 52, "h": 5, "tone": "paper"},
    ],
    "briefcase": [
        {
            "kind": "stroke",
            "points": [[40, 70], [40, 82], [60, 82], [60, 70]],
            "width": 6.0,
            "tone": "ink",
        },
        {"kind": "rrect", "x": 8, "y": 16, "w": 84, "h": 56, "r": 7, "tone": "ink"},
        {"kind": "rect", "x": 8, "y": 40, "w": 84, "h": 6, "tone": "paper"},
        {"kind": "rect", "x": 43, "y": 36, "w": 14, "h": 14, "tone": "paper"},
    ],
    "garment": [
        {
            "kind": "stroke",
            "points": [[50, 74], [50, 90], [61, 95]],
            "width": 5.0,
            "tone": "ink",
        },
        {
            "kind": "poly",
            "points": [[26, 4], [74, 4], [80, 68], [50, 82], [20, 68]],
            "tone": "ink",
        },
        {"kind": "rect", "x": 47, "y": 4, "w": 6, "h": 64, "tone": "paper"},
    ],
    "box": [
        {"kind": "rrect", "x": 10, "y": 10, "w": 80, "h": 66, "r": 5, "tone": "ink"},
        {"kind": "rect", "x": 43, "y": 10, "w": 14, "h": 66, "tone": "paper"},
        {"kind": "rect", "x": 10, "y": 48, "w": 80, "h": 5, "tone": "paper"},
    ],
}

ICON_NAMES = tuple(ICONS)

# How the owner's choice reads back to them, and on the print proof.
ICON_LABELS: dict[str, str] = {
    "suitcase": "Suitcase",
    "roller": "Carry-on",
    "duffel": "Duffel",
    "backpack": "Backpack",
    "tote": "Tote",
    "briefcase": "Briefcase",
    "garment": "Garment bag",
    "box": "Box",
}

ICON_BOX = 100.0


def ops(name: str | None) -> list[Op]:
    """The drawing operations for an icon, or an empty list for no icon."""
    if not name:
        return []
    return ICONS.get(name, [])


def colour(name: str | None) -> str:
    """The hex colour for a palette name, falling back to ink."""
    return ICON_COLORS.get(name or DEFAULT_ICON_COLOR, ICON_COLORS[DEFAULT_ICON_COLOR])
