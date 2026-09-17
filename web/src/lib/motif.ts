/**
 * Motif geometry and front-face layout — a line-for-line port of
 * `api/app/core/motif.py` and `front_layout()` in `api/app/core/print_layout.py`.
 *
 * The PDF is what gets printed, so Python is the reference and this file
 * follows it. Do not "improve" the geometry here: change it in Python, port
 * the change, and `api/tests/test_motif_parity.py` confirms the two still
 * produce identical shapes. That test is what stops the browser preview and
 * the printed tag drifting apart again.
 *
 * Units are millimetres. Coordinates use PDF's convention — origin at the
 * bottom-left, y increasing upward — and the component flips y when drawing.
 *
 * Kept to syntax Node can run with type stripping alone (no enums, no
 * parameter properties), so the parity test can execute this file directly.
 */

import type { DesignSpec } from '../api/client'

export type Rgb = [number, number, number]

export type Shape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill: Rgb }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: Rgb }
  | {
      kind: 'line'
      x1: number
      y1: number
      x2: number
      y2: number
      stroke: Rgb
      strokeWidth: number
      cap: 'butt' | 'round'
    }
  | {
      kind: 'polyline'
      points: [number, number][]
      stroke: Rgb
      strokeWidth: number
      cap: 'butt' | 'round'
    }

// Template geometry, as in print_layout.py.
export const BLEED_H_MM = 108.4
export const BLEED_W_MM = 74.1
export const TRIM_W_MM = 70.1
export const SAFE_W_MM = 65.1
export const BLEED_MARGIN_MM = (BLEED_W_MM - TRIM_W_MM) / 2
export const SAFE_MARGIN_MM = (TRIM_W_MM - SAFE_W_MM) / 2
export const HOLE_DIAMETER_MM = 5.5
export const HOLE_CENTRE_FROM_TRIM_TOP_MM = 8.5
export const HOLE_PLATE_PAD_MM = 3.0
export const PANEL_PAD_MM = 3.5
export const PANEL_RADIUS_MM = 3.0
export const NFC_DISC_DIAMETER_MM = 25.0

const BACKGROUND_TINT = 0.12

/** Python's modulo, which is never negative for a positive divisor. */
function pyMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

/** Python's int() on a float: truncation toward zero. */
const pyInt = Math.trunc

export function hexToRgb(value: string): Rgb {
  const hex = value.replace(/^#/, '')
  return [
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  ]
}

export function tint(base: Rgb, toward: Rgb, amount: number): Rgb {
  return [
    base[0] + (toward[0] - base[0]) * amount,
    base[1] + (toward[1] - base[1]) * amount,
    base[2] + (toward[2] - base[2]) * amount,
  ]
}

/** print_layout._muted: the ink lightened toward white. */
export function muted(color: Rgb): Rgb {
  return [
    Math.min(1, color[0] + (1 - color[0]) * 0.42),
    Math.min(1, color[1] + (1 - color[1]) * 0.42),
    Math.min(1, color[2] + (1 - color[2]) * 0.42),
  ]
}

export function rgbToCss(color: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(color[0])}${channel(color[1])}${channel(color[2])}`
}

export function motifShapes(design: DesignSpec, width: number, height: number): Shape[] {
  const ink = hexToRgb(design.ink)
  const accent = hexToRgb(design.accent)
  const shapes: Shape[] = [
    {
      kind: 'rect',
      x: 0,
      y: 0,
      width,
      height,
      fill: tint(hexToRgb(design.field), ink, BACKGROUND_TINT),
    },
  ]

  const period = width / design.density
  const weight = design.weight / 10
  const phase = (design.offset / 100) * period

  if (design.motif === 'dot') {
    const radius = Math.min(period * 0.24, weight * 1.8)
    const rows = Math.max(2, pyInt(height / period) + 2)
    for (let row = 0; row < rows; row++) {
      const y = row * period + phase * 0.5
      const stagger = pyMod(row, 2) ? period / 2 : 0
      for (let col = -1; col < design.density + 2; col++) {
        shapes.push({
          kind: 'circle',
          cx: col * period + stagger + phase,
          cy: y,
          r: radius,
          fill: pyMod(row + col, 5) === 0 ? accent : ink,
        })
      }
    }
  } else if (design.motif === 'weave') {
    shapes.push(...diagonalLines(width, height, 45, period, weight, ink))
    shapes.push(...diagonalLines(width, height, -45, period, weight * 0.55, accent))
  } else if (design.motif === 'diagonal') {
    const angle = Math.max(20, Math.min(70, design.angle || 60))
    shapes.push(...diagonalLines(width, height, angle, period, weight, ink))
  } else if (design.motif === 'chevron') {
    const rows = Math.max(2, pyInt(height / period) + 2)
    for (let row = 0; row < rows; row++) {
      const y = row * period
      let x = -period
      const points: [number, number][] = [[x, y]]
      let up = true
      while (x < width + period) {
        x += period / 2
        points.push([x, y + (up ? period / 2 : 0)])
        up = !up
      }
      shapes.push({ kind: 'polyline', points, stroke: ink, strokeWidth: weight, cap: 'round' })
    }
  } else if (design.motif === 'grid') {
    for (let col = 0; col < design.density + 2; col++) {
      const x = col * period + phase
      shapes.push(line(x, 0, x, height, ink, weight * 0.6))
    }
    const rows = pyInt(height / period) + 2
    for (let row = 0; row < rows; row++) {
      const y = row * period
      shapes.push(line(0, y, width, y, ink, weight * 0.6))
    }
  } else {
    // ladder
    const rungs = Math.max(3, pyInt(height / (period * 0.7)))
    for (let index = 0; index < rungs; index++) {
      const inset = pyMod(index, 3) * (width * 0.06)
      shapes.push({
        kind: 'rect',
        x: inset,
        y: index * (height / rungs),
        width: width - inset * 2,
        height: weight,
        fill: pyMod(index, 4) === 0 ? accent : ink,
      })
    }
  }

  return shapes
}

function line(x1: number, y1: number, x2: number, y2: number, stroke: Rgb, width: number): Shape {
  return { kind: 'line', x1, y1, x2, y2, stroke, strokeWidth: width, cap: 'butt' }
}

function diagonalLines(
  width: number,
  height: number,
  angleDeg: number,
  period: number,
  weight: number,
  color: Rgb,
): Shape[] {
  const radians = (angleDeg * Math.PI) / 180
  const span = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))
  const steps = pyInt(span / period) + 3
  const dx = Math.cos(radians) * (width + height)
  const dy = Math.sin(radians) * (width + height)
  const nx = -Math.sin(radians) * period
  const ny = Math.cos(radians) * period
  const lines: Shape[] = []
  for (let index = -steps; index <= steps; index++) {
    const ox = width / 2 + nx * index
    const oy = height / 2 + ny * index
    lines.push(line(ox - dx / 2, oy - dy / 2, ox + dx / 2, oy + dy / 2, color, weight))
  }
  return lines
}

export type Rect = [x: number, y: number, width: number, height: number]
export type Disc = [cx: number, cy: number, r: number]

export interface FrontLayout {
  footnote_y: number
  qr: Rect
  subtitle_baseline: number
  name_baseline: number
  icon: Rect
  name_indent: number
  band: Rect
  panel: Rect
  panel_radius: number
  content: [x: number, width: number]
  hole: Disc
  pattern: Rect
}

export interface BackLayout {
  nfc: Disc
  nfc_kicker_baseline: number
  nfc_label_baseline: number
  panel: Rect
  panel_radius: number
  content: [x: number, width: number]
  heading_baseline: number
  body_floor: number
  qr: Rect
  footer_baseline: number
  hole: Disc
  pattern: Rect
}

/** print_layout.front_layout(). Keys match the Python dict for the parity test. */
export function frontLayout(accentBand: boolean): FrontLayout {
  const safeX = BLEED_MARGIN_MM + SAFE_MARGIN_MM
  const safeY = safeX

  const contentX = safeX + PANEL_PAD_MM
  const contentW = SAFE_W_MM - PANEL_PAD_MM * 2

  const panelBottom = safeY
  const footnoteY = panelBottom + 3.0
  const qrSide = Math.min(contentW * 0.42, 24.0)
  const qr: Rect = [contentX, footnoteY + 3.5, qrSide, qrSide]

  const subtitleBaseline = qr[1] + qrSide + 5.0
  const nameBaseline = subtitleBaseline + 7.5

  const iconSize = 13.0
  const icon: Rect = [contentX, subtitleBaseline - 1.0, iconSize, iconSize]
  const nameIndent = iconSize + 3.0

  const bandTop = icon[1] + iconSize + 3.0
  const bandHeight = accentBand ? 3.2 : 0.0
  const panelTop = bandTop + bandHeight + 3.0

  const holeCentreY = BLEED_H_MM - BLEED_MARGIN_MM - HOLE_CENTRE_FROM_TRIM_TOP_MM
  return {
    footnote_y: footnoteY,
    qr,
    subtitle_baseline: subtitleBaseline,
    name_baseline: nameBaseline,
    icon,
    name_indent: nameIndent,
    band: [contentX, bandTop, contentW, bandHeight],
    panel: [safeX, panelBottom, SAFE_W_MM, panelTop - panelBottom],
    panel_radius: PANEL_RADIUS_MM,
    content: [contentX, contentW],
    hole: [BLEED_W_MM / 2, holeCentreY, HOLE_DIAMETER_MM / 2 + HOLE_PLATE_PAD_MM],
    pattern: [0.0, 0.0, BLEED_W_MM, BLEED_H_MM],
  }
}

/** print_layout.back_layout(). Keys match the Python dict for the parity test. */
export function backLayout(): BackLayout {
  const safeX = BLEED_MARGIN_MM + SAFE_MARGIN_MM
  const safeY = safeX
  const contentX = safeX + PANEL_PAD_MM
  const contentW = SAFE_W_MM - PANEL_PAD_MM * 2

  const nfcR = NFC_DISC_DIAMETER_MM / 2
  const nfcCy = 76.0
  const nfc: Disc = [BLEED_W_MM / 2, nfcCy, nfcR]

  const panelBottom = safeY
  const panelTop = 60.0
  const footerBaseline = panelBottom + 2.5
  const qrSide = 19.0
  const qr: Rect = [BLEED_W_MM / 2 - qrSide / 2, footerBaseline + 4.0, qrSide, qrSide]
  const bodyFloor = qr[1] + qrSide + 3.5
  const headingBaseline = panelTop - 6.0

  const holeCentreY = BLEED_H_MM - BLEED_MARGIN_MM - HOLE_CENTRE_FROM_TRIM_TOP_MM
  return {
    nfc,
    nfc_kicker_baseline: nfcCy + 3.0,
    nfc_label_baseline: nfcCy - 5.5,
    panel: [safeX, panelBottom, SAFE_W_MM, panelTop - panelBottom],
    panel_radius: PANEL_RADIUS_MM,
    content: [contentX, contentW],
    heading_baseline: headingBaseline,
    body_floor: bodyFloor,
    qr,
    footer_baseline: footerBaseline,
    hole: [BLEED_W_MM / 2, holeCentreY, HOLE_DIAMETER_MM / 2 + HOLE_PLATE_PAD_MM],
    pattern: [0.0, 0.0, BLEED_W_MM, BLEED_H_MM],
  }
}
