"""Motif geometry, independent of what draws it.

The traveller's motif is drawn in two places: the print PDF
(``print_layout.py``) and the browser (``web/src/lib/motif.ts``). They used to
be separate implementations that were only meant to agree, and drifted — the
ladder came out as dashes on screen and full-width rungs on paper.

Now the shapes are computed in exactly one algorithm, here, and ported
line-for-line to TypeScript. Both renderers only *draw* the shapes they are
given. ``tests/test_motif_parity.py`` runs both implementations over every
motif and palette and compares every coordinate, so a change to one without
the other fails the build instead of shipping a tag that looks different in
print.

Units and origin
----------------
Millimetres, relative to the box the motif fills, with the origin at the
**bottom-left** and y increasing upward — PDF's convention, because the PDF is
what gets printed and its output must not move. The browser flips y when it
draws.

Colours are ``(r, g, b)`` floats in 0-1, as the PDF uses them, so neither side
rounds before the other has finished computing.
"""

from __future__ import annotations

import math
from typing import Any

from .design import Design

Rgb = tuple[float, float, float]
Shape = dict[str, Any]

# Tint applied to the field colour behind the marks, toward the ink.
BACKGROUND_TINT = 0.12


def hex_to_rgb(value: str) -> Rgb:
    value = value.lstrip("#")
    return (
        int(value[0:2], 16) / 255.0,
        int(value[2:4], 16) / 255.0,
        int(value[4:6], 16) / 255.0,
    )


def tint(base: Rgb, toward: Rgb, amount: float) -> Rgb:
    return (
        base[0] + (toward[0] - base[0]) * amount,
        base[1] + (toward[1] - base[1]) * amount,
        base[2] + (toward[2] - base[2]) * amount,
    )


def motif_shapes(design: Design, width: float, height: float) -> list[Shape]:
    """Every mark in the motif, in draw order, for a ``width`` x ``height`` mm box.

    The caller clips to the box: shapes deliberately overshoot it so a cut edge
    never shows where a mark stops.
    """
    ink = hex_to_rgb(design.ink)
    accent = hex_to_rgb(design.accent)
    shapes: list[Shape] = [
        {
            "kind": "rect",
            "x": 0.0,
            "y": 0.0,
            "width": width,
            "height": height,
            "fill": tint(hex_to_rgb(design.field), ink, BACKGROUND_TINT),
        }
    ]

    period = width / design.density
    weight = design.weight / 10.0
    phase = (design.offset / 100.0) * period

    if design.motif == "dot":
        radius = min(period * 0.24, weight * 1.8)
        rows = max(2, int(height / period) + 2)
        for row in range(rows):
            y = row * period + phase * 0.5
            stagger = (period / 2.0) if row % 2 else 0.0
            for col in range(-1, design.density + 2):
                shapes.append(
                    {
                        "kind": "circle",
                        "cx": col * period + stagger + phase,
                        "cy": y,
                        "r": radius,
                        "fill": accent if (row + col) % 5 == 0 else ink,
                    }
                )

    elif design.motif == "weave":
        shapes += _diagonal_lines(width, height, 45, period, weight, ink)
        shapes += _diagonal_lines(width, height, -45, period, weight * 0.55, accent)

    elif design.motif == "diagonal":
        angle = max(20, min(70, design.angle or 60))
        shapes += _diagonal_lines(width, height, angle, period, weight, ink)

    elif design.motif == "chevron":
        rows = max(2, int(height / period) + 2)
        for row in range(rows):
            y = row * period
            x = -period
            points = [(x, y)]
            up = True
            while x < width + period:
                x += period / 2.0
                points.append((x, y + (period / 2.0 if up else 0.0)))
                up = not up
            shapes.append(
                {
                    "kind": "polyline",
                    "points": points,
                    "stroke": ink,
                    "strokeWidth": weight,
                    "cap": "round",
                }
            )

    elif design.motif == "grid":
        for col in range(design.density + 2):
            x = col * period + phase
            shapes.append(_line(x, 0.0, x, height, ink, weight * 0.6))
        for row in range(int(height / period) + 2):
            y = row * period
            shapes.append(_line(0.0, y, width, y, ink, weight * 0.6))

    else:  # ladder
        rungs = max(3, int(height / (period * 0.7)))
        for index in range(rungs):
            inset = (index % 3) * (width * 0.06)
            shapes.append(
                {
                    "kind": "rect",
                    "x": inset,
                    "y": index * (height / rungs),
                    "width": width - inset * 2,
                    "height": weight,
                    "fill": accent if index % 4 == 0 else ink,
                }
            )

    return shapes


def _line(x1: float, y1: float, x2: float, y2: float, stroke: Rgb, width: float) -> Shape:
    return {
        "kind": "line",
        "x1": x1,
        "y1": y1,
        "x2": x2,
        "y2": y2,
        "stroke": stroke,
        "strokeWidth": width,
        "cap": "butt",
    }


def _diagonal_lines(
    width: float, height: float, angle_deg: float, period: float, weight: float, color: Rgb
) -> list[Shape]:
    """Evenly spaced parallel lines at ``angle_deg``, overshooting the box.

    Spacing is stepped along the axis perpendicular to the lines, so the gap
    stays ``period`` at any angle rather than shearing as the angle changes.
    """
    radians = math.radians(angle_deg)
    span = abs(width * math.sin(radians)) + abs(height * math.cos(radians))
    steps = int(span / period) + 3
    dx = math.cos(radians) * (width + height)
    dy = math.sin(radians) * (width + height)
    nx = -math.sin(radians) * period
    ny = math.cos(radians) * period
    lines = []
    for index in range(-steps, steps + 1):
        ox = width / 2.0 + nx * index
        oy = height / 2.0 + ny * index
        lines.append(
            _line(ox - dx / 2.0, oy - dy / 2.0, ox + dx / 2.0, oy + dy / 2.0, color, weight)
        )
    return lines
