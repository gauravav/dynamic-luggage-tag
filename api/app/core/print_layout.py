"""Print-ready PDF for a physical luggage tag.

Geometry is fixed by the print supplier's template:

                      height              width
    Bleed      108.40 mm (4.27 in)   74.10 mm (2.92 in)
    Trim       104.40 mm (4.11 in)   70.10 mm (2.76 in)
    Safety      99.40 mm (3.91 in)   65.10 mm (2.56 in)

which works out to 2.00 mm of bleed outside the trim on every edge and a
further 2.50 mm of safety margin inside it. Artwork runs to the bleed edge so a
cut that drifts never exposes white paper; text and the QR symbol stay inside
the safety box so a cut that drifts never clips them.

The page declares all four PDF boxes — MediaBox and BleedBox at the bleed size,
TrimBox at the trim size, ArtBox at the safety size. A prepress workflow reads
those to impose the job; a PDF that declares only a page size leaves the
printer guessing where the cut line was meant to fall.

Fonts are embedded rather than relying on the standard 14, which many print
workflows reject outright.
"""

from __future__ import annotations

import io
import logging
import os
from dataclasses import dataclass

from reportlab.lib.colors import Color, HexColor
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

from . import qr as qr_module
from .design import Design
from .motif import motif_shapes

log = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Template geometry, in millimetres, exactly as supplied
# --------------------------------------------------------------------------
BLEED_H_MM, BLEED_W_MM = 108.40, 74.10
TRIM_H_MM, TRIM_W_MM = 104.40, 70.10
SAFE_H_MM, SAFE_W_MM = 99.40, 65.10

BLEED_MARGIN_MM = (BLEED_W_MM - TRIM_W_MM) / 2.0  # 2.00 mm on every edge
SAFE_MARGIN_MM = (TRIM_W_MM - SAFE_W_MM) / 2.0  # 2.50 mm inside the trim

# The strap hole, which the supplied box measurements do not cover. Both values
# are here rather than inline so they can be matched to whatever the supplier
# actually punches.
HOLE_DIAMETER_MM = 5.50
HOLE_CENTRE_FROM_TRIM_TOP_MM = 8.50
# Plain field kept clear at the top so the punch does not land mid-motif.
HOLE_ZONE_MM = 16.0

PAGE_W = BLEED_W_MM * mm
PAGE_H = BLEED_H_MM * mm

_BLEED_BOX = (0.0, 0.0, PAGE_W, PAGE_H)
_TRIM_BOX = (
    BLEED_MARGIN_MM * mm,
    BLEED_MARGIN_MM * mm,
    (BLEED_MARGIN_MM + TRIM_W_MM) * mm,
    (BLEED_MARGIN_MM + TRIM_H_MM) * mm,
)
_ART_BOX = (
    (BLEED_MARGIN_MM + SAFE_MARGIN_MM) * mm,
    (BLEED_MARGIN_MM + SAFE_MARGIN_MM) * mm,
    (BLEED_MARGIN_MM + SAFE_MARGIN_MM + SAFE_W_MM) * mm,
    (BLEED_MARGIN_MM + SAFE_MARGIN_MM + SAFE_H_MM) * mm,
)


@dataclass(frozen=True)
class Box:
    """A rectangle in points, origin bottom-left (PDF convention)."""

    x: float
    y: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def top(self) -> float:
        return self.y + self.height

    @property
    def cx(self) -> float:
        return self.x + self.width / 2.0


BLEED = Box(0.0, 0.0, PAGE_W, PAGE_H)
TRIM = Box(_TRIM_BOX[0], _TRIM_BOX[1], TRIM_W_MM * mm, TRIM_H_MM * mm)
SAFE = Box(_ART_BOX[0], _ART_BOX[1], SAFE_W_MM * mm, SAFE_H_MM * mm)


# --------------------------------------------------------------------------
# Fonts
# --------------------------------------------------------------------------
FONT_REGULAR = "Helvetica"
FONT_BOLD = "Helvetica-Bold"
_FONTS_READY = False


def _register_fonts() -> None:
    """Registers embeddable fonts, falling back to the standard 14.

    Bitstream Vera ships with ReportLab and its licence permits embedding and
    redistribution, so no font file has to be vendored into this repository.
    A fallback still produces a valid PDF, but one many print workflows reject
    for non-embedded fonts — so the fallback is logged, never silent.
    """
    global FONT_REGULAR, FONT_BOLD, _FONTS_READY
    if _FONTS_READY:
        return
    try:
        import reportlab

        # reportlab.fonts is a namespace package with no __file__ of its own.
        root = os.path.join(os.path.dirname(os.path.abspath(reportlab.__file__)), "fonts")
        pdfmetrics.registerFont(TTFont("DLTSans", os.path.join(root, "Vera.ttf")))
        pdfmetrics.registerFont(TTFont("DLTSans-Bold", os.path.join(root, "VeraBd.ttf")))
        pdfmetrics.registerFontFamily("DLTSans", normal="DLTSans", bold="DLTSans-Bold")
        FONT_REGULAR, FONT_BOLD = "DLTSans", "DLTSans-Bold"
    except Exception:  # noqa: BLE001 - a printable PDF beats no PDF at all
        log.warning(
            "Could not register embeddable fonts; falling back to the standard 14. "
            "The resulting PDF has no embedded fonts and some printers will reject it.",
            exc_info=True,
        )
        FONT_REGULAR, FONT_BOLD = "Helvetica", "Helvetica-Bold"
    _FONTS_READY = True


@dataclass(frozen=True)
class TagFace:
    """Everything printed on one tag."""

    design: Design
    scan_url: str
    display_name: str | None = None
    subtitle: str | None = None
    instruction: str = "Found this bag? Scan the code."


def render(
    face: TagFace,
    *,
    include_back: bool = True,
    guides: bool = False,
    title: str = "Luggage tag",
) -> bytes:
    """Renders the tag to PDF bytes.

    `guides` overlays the trim and safety rectangles for on-screen proofing.
    They are drawn into the artwork, so a guided PDF must not go to print.
    """
    _register_fonts()
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(PAGE_W, PAGE_H), pageCompression=1)

    # A file handed to a print shop should not carry the account that made it,
    # nor a toolchain fingerprint. Only the generic title is kept.
    pdf.setTitle(title)
    pdf.setAuthor("")
    pdf.setSubject("")
    pdf.setCreator("")
    pdf.setProducer("")
    pdf.setKeywords("")

    _draw_front(pdf, face, guides=guides)
    if include_back:
        pdf.showPage()
        _draw_back(pdf, face, guides=guides)

    pdf.save()
    return buffer.getvalue()


def _apply_boxes(pdf: canvas.Canvas) -> None:
    pdf.setPageSize((PAGE_W, PAGE_H))
    pdf.setBleedBox(_BLEED_BOX)
    pdf.setTrimBox(_TRIM_BOX)
    pdf.setArtBox(_ART_BOX)
    pdf.setCropBox(_BLEED_BOX)


# --------------------------------------------------------------------------
# Faces
# --------------------------------------------------------------------------


def front_layout(*, accent_band: bool) -> dict:
    """Where everything on the front face goes, in millimetres.

    Origin at the bottom-left of the bleed, y upward. Laid out from the bottom
    up: the QR block and the name plate are fixed commitments — a shrunken
    symbol will not scan and a clipped name defeats the tag — so they claim
    their space first, and the motif takes whatever height is left.

    A pure function so the browser preview (``web/src/lib/motif.ts``) can use
    the same numbers and put the motif band exactly where print does.

    Rectangles are ``(x, y, width, height)``.
    """
    safe_x = BLEED_MARGIN_MM + SAFE_MARGIN_MM
    safe_y = safe_x

    footnote_y = safe_y + 1.0
    qr_side = min(SAFE_W_MM * 0.40, 26.0)
    qr = (safe_x, footnote_y + 3.5, qr_side, qr_side)

    subtitle_baseline = qr[1] + qr_side + 5.0
    name_baseline = subtitle_baseline + 7.5
    band_top = name_baseline + 6.0
    band_height = 3.2 if accent_band else 0.0
    rule_y = band_top + band_height + 4.0

    pattern_bottom = rule_y + 3.5
    pattern_top = BLEED_H_MM - HOLE_ZONE_MM
    return {
        "footnote_y": footnote_y,
        "qr": qr,
        "subtitle_baseline": subtitle_baseline,
        "name_baseline": name_baseline,
        "band": (safe_x, band_top, SAFE_W_MM, band_height),
        "rule_y": rule_y,
        "rule": (safe_x, safe_x + SAFE_W_MM),
        "pattern": (0.0, pattern_bottom, BLEED_W_MM, pattern_top - pattern_bottom),
    }


def _draw_front(pdf: canvas.Canvas, face: TagFace, *, guides: bool) -> None:
    """Front face: motif, name plate, QR symbol.

    Laid out from the bottom up. The QR block and the name plate are fixed
    commitments — a shrunken symbol will not scan and a clipped name defeats
    the tag — so they claim their space first, and the motif takes whatever
    height is left. That way an optional accent band cannot push the name down
    onto the symbol.
    """
    _apply_boxes(pdf)
    design = face.design
    ink = HexColor(design.ink)
    muted = _muted(ink)

    # Field colour covers the full bleed, never only the trim.
    pdf.setFillColor(HexColor(design.field))
    pdf.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    layout = front_layout(accent_band=design.accent_band)
    footnote_y = layout["footnote_y"] * mm
    qr_box = Box(*(value * mm for value in layout["qr"]))
    subtitle_baseline = layout["subtitle_baseline"] * mm
    name_baseline = layout["name_baseline"] * mm
    band_top = layout["band"][1] * mm
    band_height = layout["band"][3] * mm
    rule_y = layout["rule_y"] * mm

    _draw_motif(pdf, Box(*(value * mm for value in layout["pattern"])), design)

    pdf.setStrokeColor(ink)
    pdf.setLineWidth(0.5)
    pdf.line(SAFE.x, rule_y, SAFE.right, rule_y)

    if design.accent_band:
        pdf.setFillColor(HexColor(design.accent))
        pdf.rect(SAFE.x, band_top, SAFE.width, band_height, stroke=0, fill=1)

    if face.display_name:
        _draw_fitted(
            pdf,
            face.display_name,
            font=FONT_BOLD,
            max_size=16,
            min_size=9,
            x=SAFE.x,
            y=name_baseline,
            max_width=SAFE.width,
            color=ink,
        )
    if face.subtitle:
        _draw_fitted(
            pdf,
            face.subtitle,
            font=FONT_REGULAR,
            max_size=8.5,
            min_size=6.5,
            x=SAFE.x,
            y=subtitle_baseline,
            max_width=SAFE.width,
            color=muted,
        )

    _draw_qr(pdf, qr_box, face.scan_url, ink)

    _draw_wrapped(
        pdf,
        face.instruction,
        font=FONT_REGULAR,
        size=7.4,
        leading=9.4,
        x=qr_box.right + 4 * mm,
        top=qr_box.top - 2.5 * mm,
        max_width=SAFE.right - qr_box.right - 4 * mm,
        color=muted,
    )

    pdf.setFillColor(muted)
    pdf.setFont(FONT_REGULAR, 5.4)
    pdf.drawString(
        SAFE.x, footnote_y, "No personal details are shown unless this bag is reported lost."
    )

    _punch_hole(pdf, design)
    if guides:
        _draw_guides(pdf)


def _draw_back(pdf: canvas.Canvas, face: TagFace, *, guides: bool) -> None:
    """Back face: finder instructions above a second QR symbol.

    Laid out like the front: the QR block is reserved first, from the bottom
    of the safety box, and the instructions must fit above it. If they would
    not, the type steps down rather than letting a line run into the quiet
    zone — a symbol with text over its quiet zone may not scan.
    """
    _apply_boxes(pdf)
    design = face.design
    ink = HexColor(design.ink)
    muted = _muted(ink)

    pdf.setFillColor(HexColor(design.field))
    pdf.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)

    # A narrow strip of the same motif keeps both faces recognisably one tag.
    strip = Box(0, PAGE_H - HOLE_ZONE_MM * mm - 12 * mm, PAGE_W, 12 * mm)
    _draw_motif(pdf, strip, design)

    footer_y = SAFE.y
    qr_side = min(SAFE.width * 0.40, 23 * mm)
    qr_box = Box(SAFE.cx - qr_side / 2.0, footer_y + 5 * mm, qr_side, qr_side)
    floor = qr_box.top + 4 * mm

    steps = (
        "Scan the code on the front.",
        "The page tells you whether the owner reported the bag lost.",
        "If they did, you can message them without sharing your number.",
        "If they did not, no personal details are shown at all.",
    )
    heading_top = strip.y - 9 * mm
    indent = 4.5 * mm

    # Largest size at which heading and steps clear the QR block.
    for size in (7.2, 6.9, 6.6, 6.3, 6.0):
        leading = size * 1.28
        needed = 11.5 * 1.2 + 3 * mm
        for step in steps:
            lines = len(_wrap(step, FONT_REGULAR, size, SAFE.width - indent))
            needed += lines * leading + 2 * mm
        if heading_top - needed >= floor:
            break

    cursor = _draw_fitted(
        pdf,
        "If you found this bag",
        font=FONT_BOLD,
        max_size=11.5,
        min_size=9,
        x=SAFE.x,
        y=heading_top,
        max_width=SAFE.width,
        color=ink,
    )
    cursor -= 3 * mm
    for index, step in enumerate(steps, start=1):
        pdf.setFillColor(HexColor(design.accent))
        pdf.setFont(FONT_BOLD, size)
        pdf.drawString(SAFE.x, cursor, str(index))
        cursor = _draw_wrapped(
            pdf,
            step,
            font=FONT_REGULAR,
            size=size,
            leading=leading,
            x=SAFE.x + indent,
            top=cursor,
            max_width=SAFE.width - indent,
            color=ink,
        )
        cursor -= 2 * mm

    _draw_qr(pdf, qr_box, face.scan_url, ink)

    pdf.setFillColor(muted)
    pdf.setFont(FONT_REGULAR, 5.4)
    pdf.drawCentredString(SAFE.cx, footer_y, "dynamic luggage tag")

    _punch_hole(pdf, design)
    if guides:
        _draw_guides(pdf)


# --------------------------------------------------------------------------
# Drawing primitives
# --------------------------------------------------------------------------


def _punch_hole(pdf: canvas.Canvas, design: Design) -> None:
    """Marks where the strap hole is punched, so nothing important sits there."""
    radius = (HOLE_DIAMETER_MM / 2.0) * mm
    centre_y = TRIM.top - HOLE_CENTRE_FROM_TRIM_TOP_MM * mm
    pdf.setFillColor(HexColor(design.field))
    pdf.setStrokeColor(_muted(HexColor(design.ink)))
    pdf.setLineWidth(0.3)
    pdf.circle(TRIM.cx, centre_y, radius, stroke=1, fill=1)


def _draw_qr(pdf: canvas.Canvas, box: Box, url: str, color: Color) -> None:
    """Draws the symbol with a quiet zone, snapped to whole modules.

    Adjacent modules are merged into horizontal runs: fewer path operations,
    and no hairline seams where two rectangles abut, which a RIP would
    anti-alias into grey lines that scanners read as noise.
    """
    modules = qr_module.matrix(url)
    count = len(modules)
    quiet = 2  # modules; the minimum quiet zone a scanner needs
    module_size = box.width / (count + quiet * 2)

    # A white quiet zone, because the field colour behind it may be tinted.
    pdf.setFillColor(Color(1, 1, 1))
    pdf.rect(box.x, box.y, box.width, box.width, stroke=0, fill=1)

    origin_x = box.x + module_size * quiet
    origin_y = box.y + module_size * quiet

    pdf.setFillColor(color)
    for row_index, row in enumerate(modules):
        # PDF y grows upward; the matrix's first row is the top of the symbol.
        y = origin_y + (count - 1 - row_index) * module_size
        run_start = None
        for col_index in range(count + 1):
            filled = col_index < count and bool(row[col_index])
            if filled and run_start is None:
                run_start = col_index
            elif not filled and run_start is not None:
                pdf.rect(
                    origin_x + run_start * module_size,
                    y,
                    (col_index - run_start) * module_size,
                    module_size,
                    stroke=0,
                    fill=1,
                )
                run_start = None


def _draw_motif(pdf: canvas.Canvas, box: Box, design: Design) -> None:
    """Paints the traveller's motif into `box`, clipped to it.

    The geometry comes from ``core/motif.py``, which the browser mirrors in
    ``web/src/lib/motif.ts``. This function only converts millimetres to
    points and draws — it must not decide where a mark goes, or print and
    screen drift apart again.
    """
    pdf.saveState()
    path = pdf.beginPath()
    path.rect(box.x, box.y, box.width, box.height)
    pdf.clipPath(path, stroke=0, fill=0)

    def px(value: float) -> float:
        return box.x + value * mm

    def py(value: float) -> float:
        return box.y + value * mm

    for shape in motif_shapes(design, box.width / mm, box.height / mm):
        kind = shape["kind"]
        if kind == "rect":
            pdf.setFillColor(Color(*shape["fill"]))
            pdf.rect(
                px(shape["x"]),
                py(shape["y"]),
                shape["width"] * mm,
                shape["height"] * mm,
                stroke=0,
                fill=1,
            )
        elif kind == "circle":
            pdf.setFillColor(Color(*shape["fill"]))
            pdf.circle(px(shape["cx"]), py(shape["cy"]), shape["r"] * mm, stroke=0, fill=1)
        else:
            pdf.setStrokeColor(Color(*shape["stroke"]))
            pdf.setLineWidth(shape["strokeWidth"] * mm)
            pdf.setLineCap(1 if shape["cap"] == "round" else 0)
            if kind == "line":
                pdf.line(px(shape["x1"]), py(shape["y1"]), px(shape["x2"]), py(shape["y2"]))
            else:  # polyline
                (first_x, first_y), *rest = shape["points"]
                line = pdf.beginPath()
                line.moveTo(px(first_x), py(first_y))
                for x, y in rest:
                    line.lineTo(px(x), py(y))
                pdf.drawPath(line, stroke=1, fill=0)

    pdf.restoreState()


def _draw_fitted(
    pdf: canvas.Canvas,
    text: str,
    *,
    font: str,
    max_size: float,
    min_size: float,
    x: float,
    y: float,
    max_width: float,
    color: Color,
) -> float:
    """Draws one line, shrinking the type until it fits. Returns the next baseline."""
    size = max_size
    while size > min_size and pdfmetrics.stringWidth(text, font, size) > max_width:
        size -= 0.25
    if pdfmetrics.stringWidth(text, font, size) > max_width:
        text = _ellipsize(text, font, size, max_width)
    pdf.setFont(font, size)
    pdf.setFillColor(color)
    pdf.drawString(x, y, text)
    return y - size * 1.2


def _draw_wrapped(
    pdf: canvas.Canvas,
    text: str,
    *,
    font: str,
    size: float,
    leading: float,
    x: float,
    top: float,
    max_width: float,
    color: Color,
) -> float:
    pdf.setFont(font, size)
    pdf.setFillColor(color)
    y = top
    for line in _wrap(text, font, size, max_width):
        pdf.drawString(x, y, line)
        y -= leading
    return y


def _wrap(text: str, font: str, size: float, max_width: float) -> list[str]:
    lines: list[str] = []
    current = ""
    for word in text.split():
        candidate = f"{current} {word}".strip()
        if not current or pdfmetrics.stringWidth(candidate, font, size) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _ellipsize(text: str, font: str, size: float, max_width: float) -> str:
    ellipsis = "…"
    while text and pdfmetrics.stringWidth(text + ellipsis, font, size) > max_width:
        text = text[:-1]
    return text + ellipsis


def _muted(color: Color) -> Color:
    return Color(
        min(1.0, color.red + (1 - color.red) * 0.42),
        min(1.0, color.green + (1 - color.green) * 0.42),
        min(1.0, color.blue + (1 - color.blue) * 0.42),
    )


def _draw_guides(pdf: canvas.Canvas) -> None:
    """Proofing overlay: trim in magenta, safety in cyan. Never for production."""
    pdf.setLineWidth(0.3)
    pdf.setStrokeColor(Color(1, 0, 1))
    pdf.rect(TRIM.x, TRIM.y, TRIM.width, TRIM.height, stroke=1, fill=0)
    pdf.setStrokeColor(Color(0, 0.6, 1))
    pdf.rect(SAFE.x, SAFE.y, SAFE.width, SAFE.height, stroke=1, fill=0)
