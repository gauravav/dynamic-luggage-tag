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

from . import icons
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
# A disc of plain field behind the punch, so the motif stops short of the hole
# rather than being cut through by it.
HOLE_PLATE_PAD_MM = 3.0

# The motif covers the whole tag: it is what the owner picks their bag out by
# from twenty metres down a carousel, and a band of pattern at the top is not
# enough to do that. Everything that has to be read instead sits on a plate of
# plain field colour, and these are that plate's margins.
PANEL_PAD_MM = 3.5
PANEL_RADIUS_MM = 3.0

# The round NFC sticker's landing zone on the back face (a 25 mm disc).
NFC_DISC_DIAMETER_MM = 25.0

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
    # The owner's bag icon and its colour, both chosen from fixed lists in
    # ``core/icons.py``. None means no icon, and the name plate closes up.
    icon: str | None = None
    icon_color: str | None = None
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

    Origin at the bottom-left of the bleed, y upward.

    The plate at the bottom holds two columns side by side: the QR symbol on
    the left, and the name, subtitle and bag icon stacked to the right of it.
    Stacking them instead — symbol under name — made the plate half the height
    of the tag and left the motif a strip along the top. The motif is what
    someone recognises a bag by from the far end of a carousel, so it gets the
    room, and the plate takes only what has to be read close up.

    Nothing on this face explains what the code is for. The back has room to
    say it properly, and a line of instructions here would cost the pattern
    another six millimetres to tell a finder what the page they are about to
    open tells them anyway.

    A pure function so the browser preview (``web/src/lib/motif.ts``) can use
    the same numbers and put every plate exactly where print does.

    Rectangles are ``(x, y, width, height)``.
    """
    safe_x = BLEED_MARGIN_MM + SAFE_MARGIN_MM
    safe_y = safe_x

    content_x = safe_x + PANEL_PAD_MM
    content_w = SAFE_W_MM - PANEL_PAD_MM * 2.0

    panel_bottom = safe_y
    footnote_y = panel_bottom + 3.0

    # Left column: the symbol. 22 mm still leaves every module well above the
    # size a phone camera needs, and buys the right column four more.
    qr_side = 22.0
    qr = (content_x, footnote_y + 3.5, qr_side, qr_side)
    columns_top = qr[1] + qr_side

    # Right column: icon at the top, then the name, then the subtitle.
    text_x = qr[0] + qr_side + 4.0
    text_w = content_x + content_w - text_x
    icon_size = 9.5
    icon = (text_x, columns_top - icon_size, icon_size, icon_size)
    name_baseline = icon[1] - 4.0
    subtitle_baseline = name_baseline - 6.5

    band_top = columns_top + 3.0
    band_height = 3.2 if accent_band else 0.0
    panel_top = band_top + band_height + 3.0

    hole_centre_y = BLEED_H_MM - BLEED_MARGIN_MM - HOLE_CENTRE_FROM_TRIM_TOP_MM
    return {
        "footnote_y": footnote_y,
        "qr": qr,
        "subtitle_baseline": subtitle_baseline,
        "name_baseline": name_baseline,
        "icon": icon,
        # The column the type sits in, beside the symbol rather than under it.
        "text": (text_x, text_w),
        "band": (content_x, band_top, content_w, band_height),
        "panel": (safe_x, panel_bottom, SAFE_W_MM, panel_top - panel_bottom),
        "panel_radius": PANEL_RADIUS_MM,
        "content": (content_x, content_w),
        "hole": (BLEED_W_MM / 2.0, hole_centre_y, HOLE_DIAMETER_MM / 2.0 + HOLE_PLATE_PAD_MM),
        "pattern": (0.0, 0.0, BLEED_W_MM, BLEED_H_MM),
    }


def back_layout() -> dict:
    """Where everything on the back face goes, in millimetres.

    Same conventions as :func:`front_layout`, and the same idea: pattern
    everywhere, plates where something has to be read. The extra element here
    is ``nfc`` — the disc the round NFC sticker is meant to land on, marked so
    the owner sticks it somewhere a phone can actually find it and a finder
    knows to tap it.
    """
    safe_x = BLEED_MARGIN_MM + SAFE_MARGIN_MM
    safe_y = safe_x
    content_x = safe_x + PANEL_PAD_MM
    content_w = SAFE_W_MM - PANEL_PAD_MM * 2.0

    nfc_r = NFC_DISC_DIAMETER_MM / 2.0
    nfc_cy = 76.0
    nfc = (BLEED_W_MM / 2.0, nfc_cy, nfc_r)

    panel_bottom = safe_y
    panel_top = 60.0
    footer_baseline = panel_bottom + 2.5
    qr_side = 19.0
    qr = (BLEED_W_MM / 2.0 - qr_side / 2.0, footer_baseline + 4.0, qr_side, qr_side)
    # Nothing may be set below this line, or type lands on the symbol's quiet
    # zone and the code stops scanning.
    body_floor = qr[1] + qr_side + 3.5
    heading_baseline = panel_top - 6.0

    hole_centre_y = BLEED_H_MM - BLEED_MARGIN_MM - HOLE_CENTRE_FROM_TRIM_TOP_MM
    return {
        "nfc": nfc,
        "nfc_kicker_baseline": nfc_cy + 3.0,
        "nfc_label_baseline": nfc_cy - 5.5,
        "panel": (safe_x, panel_bottom, SAFE_W_MM, panel_top - panel_bottom),
        "panel_radius": PANEL_RADIUS_MM,
        "content": (content_x, content_w),
        "heading_baseline": heading_baseline,
        "body_floor": body_floor,
        "qr": qr,
        "footer_baseline": footer_baseline,
        "hole": (BLEED_W_MM / 2.0, hole_centre_y, HOLE_DIAMETER_MM / 2.0 + HOLE_PLATE_PAD_MM),
        "pattern": (0.0, 0.0, BLEED_W_MM, BLEED_H_MM),
    }


def _draw_front(pdf: canvas.Canvas, face: TagFace, *, guides: bool) -> None:
    """Front face: motif over the whole tag, with the plate beneath it."""
    _apply_boxes(pdf)
    design = face.design
    ink = HexColor(design.ink)
    field = HexColor(design.field)
    muted = _muted(ink)

    layout = front_layout(accent_band=design.accent_band)

    # Field colour covers the full bleed, never only the trim — and then the
    # motif covers the field.
    pdf.setFillColor(field)
    pdf.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    _draw_motif(pdf, Box(*(value * mm for value in layout["pattern"])), design)

    _draw_plate(pdf, Box(*(value * mm for value in layout["panel"])), design)

    content_x, content_w = (value * mm for value in layout["content"])
    text_x, text_w = (value * mm for value in layout["text"])
    footnote_y = layout["footnote_y"] * mm
    qr_box = Box(*(value * mm for value in layout["qr"]))
    band_top = layout["band"][1] * mm
    band_height = layout["band"][3] * mm

    if design.accent_band:
        pdf.setFillColor(HexColor(design.accent))
        pdf.rect(content_x, band_top, content_w, band_height, stroke=0, fill=1)

    _draw_qr(pdf, qr_box, face.scan_url, ink)

    if face.icon:
        _draw_icon(pdf, Box(*(value * mm for value in layout["icon"])), face, design)

    if face.display_name:
        _draw_fitted(
            pdf,
            face.display_name,
            font=FONT_BOLD,
            max_size=14,
            min_size=8,
            x=text_x,
            y=layout["name_baseline"] * mm,
            max_width=text_w,
            color=ink,
        )
    if face.subtitle:
        _draw_fitted(
            pdf,
            face.subtitle,
            font=FONT_REGULAR,
            max_size=8,
            min_size=6,
            x=text_x,
            y=layout["subtitle_baseline"] * mm,
            max_width=text_w,
            color=muted,
        )

    pdf.setFillColor(muted)
    pdf.setFont(FONT_REGULAR, 5.4)
    pdf.drawString(
        content_x, footnote_y, "No personal details are shown unless this bag is reported lost."
    )

    _punch_hole(pdf, design, layout)
    if guides:
        _draw_guides(pdf)


def _draw_back(pdf: canvas.Canvas, face: TagFace, *, guides: bool) -> None:
    """Back face: the NFC landing disc above a short note and a second symbol.

    The disc is the point of this face. A round sticker hidden anywhere else on
    the bag is a sticker nobody taps, so the tag says where it goes and says
    what to do with it.

    Type steps down rather than running into the symbol's quiet zone: a code
    with text over its quiet zone may not scan at all.
    """
    _apply_boxes(pdf)
    design = face.design
    ink = HexColor(design.ink)
    field = HexColor(design.field)
    muted = _muted(ink)

    layout = back_layout()

    pdf.setFillColor(field)
    pdf.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    _draw_motif(pdf, Box(*(value * mm for value in layout["pattern"])), design)

    _draw_nfc_disc(pdf, layout, design)
    _draw_plate(pdf, Box(*(value * mm for value in layout["panel"])), design)

    content_x, content_w = (value * mm for value in layout["content"])
    qr_box = Box(*(value * mm for value in layout["qr"]))
    floor = layout["body_floor"] * mm

    body = (
        "Tap the circle above with your phone, or scan the code below. "
        "The page tells you whether the owner has reported this bag lost, and "
        "lets you message them without either of you sharing a number."
    )

    # Largest size at which the heading and the note still clear the symbol.
    size, leading = 7.4, 9.4
    for candidate in (7.4, 7.0, 6.6, 6.2, 5.8):
        size = candidate
        leading = candidate * 1.28
        needed = 11.5 * 1.2 + 3 * mm + len(_wrap(body, FONT_REGULAR, size, content_w)) * leading
        if layout["heading_baseline"] * mm - needed >= floor:
            break

    cursor = _draw_fitted(
        pdf,
        "If you found this bag",
        font=FONT_BOLD,
        max_size=11.5,
        min_size=9,
        x=content_x,
        y=layout["heading_baseline"] * mm,
        max_width=content_w,
        color=ink,
    )
    cursor -= 3 * mm
    _draw_wrapped(
        pdf,
        body,
        font=FONT_REGULAR,
        size=size,
        leading=leading,
        x=content_x,
        top=cursor,
        max_width=content_w,
        color=ink,
    )

    _draw_qr(pdf, qr_box, face.scan_url, ink)

    pdf.setFillColor(muted)
    pdf.setFont(FONT_REGULAR, 5.4)
    pdf.drawCentredString(
        BLEED_W_MM / 2.0 * mm, layout["footer_baseline"] * mm, "dynamic luggage tag"
    )

    _punch_hole(pdf, design, layout)
    if guides:
        _draw_guides(pdf)


# --------------------------------------------------------------------------
# Drawing primitives
# --------------------------------------------------------------------------


def _draw_plate(pdf: canvas.Canvas, box: Box, design: Design) -> None:
    """A rounded plate of plain field colour, laid over the motif."""
    pdf.setFillColor(HexColor(design.field))
    pdf.setStrokeColor(_muted(HexColor(design.ink)))
    pdf.setLineWidth(0.4)
    pdf.roundRect(box.x, box.y, box.width, box.height, PANEL_RADIUS_MM * mm, stroke=1, fill=1)


def _draw_nfc_disc(pdf: canvas.Canvas, layout: dict, design: Design) -> None:
    """The round sticker's landing zone, and the two words that explain it."""
    cx, cy, radius = (value * mm for value in layout["nfc"])
    ink = HexColor(design.ink)
    muted = _muted(ink)

    pdf.setFillColor(HexColor(design.field))
    pdf.setStrokeColor(muted)
    pdf.setLineWidth(0.5)
    pdf.circle(cx, cy, radius, stroke=1, fill=1)

    # A dashed inner ring: the sticker's own edge, so it is obvious the circle
    # is somewhere to put something rather than somewhere to write.
    pdf.saveState()
    pdf.setDash(1.6, 1.6)
    pdf.setStrokeColor(muted)
    pdf.setLineWidth(0.6)
    pdf.circle(cx, cy, radius - 1.6 * mm, stroke=1, fill=0)
    pdf.restoreState()

    pdf.setFillColor(muted)
    pdf.setFont(FONT_REGULAR, 5.4)
    pdf.drawCentredString(cx, layout["nfc_kicker_baseline"] * mm, "NFC STICKER")
    pdf.setFillColor(ink)
    pdf.setFont(FONT_BOLD, 8.4)
    pdf.drawCentredString(cx, layout["nfc_label_baseline"] * mm, "SCAN HERE")


def _draw_icon(pdf: canvas.Canvas, box: Box, face: TagFace, design: Design) -> None:
    """The owner's bag icon, from the shared geometry in ``core/icons.py``."""
    ink = HexColor(icons.colour(face.icon_color))
    paper = HexColor(design.field)
    scale = box.width / icons.ICON_BOX

    def px(value: float) -> float:
        return box.x + value * scale

    def py(value: float) -> float:
        return box.y + value * scale

    def trace(points: list[list[float]]):
        (first_x, first_y), *rest = points
        path = pdf.beginPath()
        path.moveTo(px(first_x), py(first_y))
        for x, y in rest:
            path.lineTo(px(x), py(y))
        return path

    for op in icons.ops(face.icon):
        tone = ink if op["tone"] == "ink" else paper
        pdf.setFillColor(tone)
        pdf.setStrokeColor(tone)
        kind = op["kind"]
        if kind == "rect":
            pdf.rect(px(op["x"]), py(op["y"]), op["w"] * scale, op["h"] * scale, stroke=0, fill=1)
        elif kind == "rrect":
            pdf.roundRect(
                px(op["x"]),
                py(op["y"]),
                op["w"] * scale,
                op["h"] * scale,
                op["r"] * scale,
                stroke=0,
                fill=1,
            )
        elif kind == "circle":
            pdf.circle(px(op["cx"]), py(op["cy"]), op["r"] * scale, stroke=0, fill=1)
        elif kind == "poly":
            path = trace(op["points"])
            path.close()
            pdf.drawPath(path, stroke=0, fill=1)
        else:  # stroke
            pdf.setLineWidth(op["width"] * scale)
            pdf.setLineCap(1)
            pdf.setLineJoin(1)
            pdf.drawPath(trace(op["points"]), stroke=1, fill=0)


def _punch_hole(pdf: canvas.Canvas, design: Design, layout: dict) -> None:
    """Marks where the strap hole is punched, on its own plate of field colour.

    The plate is what stops the motif — which now runs to every edge — from
    being cut through by the punch.
    """
    cx, cy, plate_radius = (value * mm for value in layout["hole"])
    muted = _muted(HexColor(design.ink))

    pdf.setFillColor(HexColor(design.field))
    pdf.setStrokeColor(muted)
    pdf.setLineWidth(0.3)
    pdf.circle(cx, cy, plate_radius, stroke=0, fill=1)
    pdf.circle(cx, cy, (HOLE_DIAMETER_MM / 2.0) * mm, stroke=1, fill=1)


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
