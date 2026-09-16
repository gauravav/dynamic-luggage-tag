"""The browser preview and the printed tag must draw the same motif.

Runs the Python geometry (what the PDF prints) and the TypeScript port (what
the browser shows) over a wide spread of designs and box sizes, and compares
every coordinate and colour. Before this existed the two implementations
were separate and drifted: the ladder printed as full-width rungs but
previewed as dashes.
"""

from __future__ import annotations

import json
import math
import shutil
import subprocess
from pathlib import Path

import pytest

from app.core import design as design_module
from app.core.motif import motif_shapes
from app.core.print_layout import BLEED_W_MM, front_layout

SCRIPT = Path(__file__).resolve().parents[2] / "web" / "scripts" / "motif-parity.mjs"
TOLERANCE = 1e-9
# Resolved once to an absolute path, so the test never runs whichever `node`
# happens to be first on PATH at call time.
NODE = shutil.which("node")


def _node_can_strip_types() -> bool:
    if NODE is None:
        return False
    probe = subprocess.run(  # noqa: S603 - fixed arguments, no external input
        [NODE, "-p", "Boolean(process.features.typescript)"],
        capture_output=True,
        text=True,
        check=False,
    )
    return probe.stdout.strip() == "true"


pytestmark = pytest.mark.skipif(
    not _node_can_strip_types(),
    reason="needs Node 22.6+ to run the TypeScript port directly",
)


def _cases() -> list[dict]:
    designs: list[dict] = []

    # Every motif in every palette, at both extremes of each numeric field.
    for motif in design_module.MOTIFS:
        for palette in design_module.PALETTES:
            for density, weight, angle, offset in ((4, 6, 0, 0), (9, 14, 165, 100)):
                designs.append(
                    design_module.from_dict(
                        {
                            "palette": palette,
                            "motif": motif,
                            "density": density,
                            "weight": weight,
                            "angle": angle,
                            "offset": offset,
                        }
                    ).to_dict()
                )

    # And a spread of real generated designs, deterministic across runs.
    for index in range(200):
        seed = index.to_bytes(2, "big") * 8
        designs.append(design_module.generate(seed).to_dict())

    # Every box the motif is actually drawn into.
    heights = [
        front_layout(accent_band=False)["pattern"][3],
        front_layout(accent_band=True)["pattern"][3],
        12.0,  # back-face strip
    ]
    return [
        {"design": spec, "width": BLEED_W_MM, "height": height}
        for spec in designs
        for height in heights
    ]


def _run_typescript(cases: list[dict]) -> dict:
    result = subprocess.run(  # noqa: S603 - fixed arguments; cases go via stdin
        [NODE, str(SCRIPT)],
        input=json.dumps({"cases": cases}),
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _assert_same(python, typescript, path: str) -> None:
    if isinstance(python, dict):
        assert isinstance(typescript, dict), f"{path}: expected an object"
        assert set(python) == set(typescript), (
            f"{path}: keys differ {sorted(python)} vs {sorted(typescript)}"
        )
        for key in python:
            _assert_same(python[key], typescript[key], f"{path}.{key}")
    elif isinstance(python, (list, tuple)):
        assert isinstance(typescript, list), f"{path}: expected a list"
        assert len(python) == len(typescript), (
            f"{path}: {len(python)} items in Python, {len(typescript)} in TypeScript"
        )
        for index, (a, b) in enumerate(zip(python, typescript, strict=True)):
            _assert_same(a, b, f"{path}[{index}]")
    elif isinstance(python, float) or isinstance(typescript, float):
        assert math.isclose(python, typescript, rel_tol=0, abs_tol=TOLERANCE), (
            f"{path}: {python!r} in Python, {typescript!r} in TypeScript"
        )
    else:
        assert python == typescript, f"{path}: {python!r} in Python, {typescript!r} in TypeScript"


def test_motif_shapes_match_across_languages():
    cases = _cases()
    typescript = _run_typescript(cases)

    for index, case in enumerate(cases):
        spec = design_module.from_dict(case["design"])
        python = motif_shapes(spec, case["width"], case["height"])
        label = f"{spec.palette}/{spec.motif} d{spec.density} h{case['height']:.1f}"
        _assert_same(python, typescript["shapes"][index], label)


def test_front_layout_matches_across_languages():
    typescript = _run_typescript([])["layouts"]
    _assert_same(front_layout(accent_band=False), typescript["plain"], "layout(plain)")
    _assert_same(front_layout(accent_band=True), typescript["band"], "layout(band)")


def test_the_cases_cover_every_motif():
    motifs = {case["design"]["motif"] for case in _cases()}
    assert motifs == set(design_module.MOTIFS)
