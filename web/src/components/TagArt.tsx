/**
 * The tag face, drawn from a design spec.
 *
 * A preview of the printed tag, not an impression of it. The motif shapes, the
 * icon geometry and both face layouts come from `lib/motif.ts` and
 * `lib/icons.ts`, ports of the Python that renders the print PDF, and
 * `api/tests/test_motif_parity.py` checks the two produce identical geometry.
 * This component only converts coordinates (print uses a bottom-left origin,
 * SVG a top-left one) and draws.
 *
 * The viewBox is the bleed in millimetres, 74.10 x 108.40.
 */

import { useId } from 'react'
import type { DesignSpec } from '../api/client'
import { BagGlyphShapes } from './BagGlyph'
import { ICON_BOX, iconColour } from '../lib/icons'
import {
  BLEED_H_MM,
  BLEED_W_MM,
  HOLE_DIAMETER_MM,
  SAFE_W_MM,
  backLayout,
  frontLayout,
  hexToRgb,
  motifShapes,
  muted,
  rgbToCss,
  type Rect,
  type Shape,
} from '../lib/motif'

const PT = 25.4 / 72 // one PostScript point, in millimetres

interface Props {
  design: DesignSpec
  name?: string | null
  subtitle?: string | null
  /** The owner's bag icon and its colour, as stored on the tag. */
  icon?: string | null
  iconColor?: string | null
  /** Draws the QR placeholder block. Off for small previews. */
  showCode?: boolean
  /**
   * Crops to the top of the tag — the hole and the motif above the name plate.
   *
   * For a finder holding the bag, the motif is the whole question: is this the
   * tag I am looking at? The rest of the face is dead space on screen.
   */
  crest?: boolean
  /** Which face to draw. The back is where the NFC sticker goes. */
  side?: 'front' | 'back'
  className?: string
  title?: string
}

export function TagArt({
  design,
  name,
  subtitle,
  icon,
  iconColor,
  showCode = true,
  crest = false,
  side = 'front',
  className,
  title,
}: Props) {
  return side === 'back' ? (
    <BackFace design={design} className={className} title={title} />
  ) : (
    <FrontFace
      design={design}
      name={name}
      subtitle={subtitle}
      icon={icon}
      iconColor={iconColor}
      showCode={showCode}
      crest={crest}
      className={className}
      title={title}
    />
  )
}

function FrontFace({
  design,
  name,
  subtitle,
  icon,
  iconColor,
  showCode,
  crest,
  className,
  title,
}: Omit<Props, 'side'>) {
  const layout = frontLayout(design.accent_band)
  const ink = design.ink
  const mutedInk = rgbToCss(muted(hexToRgb(design.ink)))
  const [contentX] = layout.content
  const [, panelY, , panelH] = layout.panel
  const [textX, textW] = layout.text

  // Cropping for the crest stops just above the name plate, so what is left is
  // pattern and the punch — the part you recognise across a baggage hall.
  const panelTopFromTop = BLEED_H_MM - (panelY + panelH)
  const viewHeight = crest ? panelTopFromTop : BLEED_H_MM

  return (
    <Face
      className={className}
      viewHeight={viewHeight}
      label={title ?? `Luggage tag design: ${design.palette} ${design.motif}`}
      design={design}
    >
      {!crest && (
        <>
          <Plate rect={layout.panel} radius={layout.panel_radius} design={design} />

          {design.accent_band && (
            <rect
              x={layout.band[0]}
              y={flipY(layout.band[1] + layout.band[3])}
              width={layout.band[2]}
              height={layout.band[3]}
              fill={design.accent}
            />
          )}

          {showCode && (
            <CodeBlock
              color={ink}
              x={layout.qr[0]}
              y={flipY(layout.qr[1] + layout.qr[3])}
              size={layout.qr[2]}
            />
          )}

          {icon && (
            <BagIcon rect={layout.icon} icon={icon} color={iconColour(iconColor)} design={design} />
          )}

          {name && (
            <FittedText
              text={name}
              x={textX}
              y={flipY(layout.name_baseline)}
              maxPt={14}
              minPt={8}
              maxWidth={textW}
              fill={ink}
              weight={700}
            />
          )}
          {subtitle && (
            <FittedText
              text={subtitle}
              x={textX}
              y={flipY(layout.subtitle_baseline)}
              maxPt={8}
              minPt={6}
              maxWidth={textW}
              fill={mutedInk}
              weight={400}
            />
          )}

          <text
            x={contentX}
            y={flipY(layout.footnote_y)}
            fill={mutedInk}
            fontFamily={FACE_FONT}
            fontSize={5.4 * PT}
          >
            No personal details are shown unless this bag is reported lost.
          </text>
        </>
      )}

      <HolePlate disc={layout.hole} design={design} />
    </Face>
  )
}

function BackFace({ design, className, title }: Pick<Props, 'design' | 'className' | 'title'>) {
  const layout = backLayout()
  const ink = design.ink
  const mutedInk = rgbToCss(muted(hexToRgb(design.ink)))
  const [contentX, contentW] = layout.content
  const [nfcCx, nfcCy, nfcR] = layout.nfc

  return (
    <Face
      className={className}
      viewHeight={BLEED_H_MM}
      label={title ?? 'The back of the tag, with the NFC sticker circle'}
      design={design}
    >
      {/* Where the round NFC sticker goes. Marked, because a sticker put
          anywhere else on the bag is a sticker nobody taps. */}
      <circle
        cx={nfcCx}
        cy={flipY(nfcCy)}
        r={nfcR}
        fill={design.field}
        stroke={mutedInk}
        strokeWidth={0.5 * PT}
      />
      <circle
        cx={nfcCx}
        cy={flipY(nfcCy)}
        r={nfcR - 1.6}
        fill="none"
        stroke={mutedInk}
        strokeWidth={0.6 * PT}
        strokeDasharray="1.6 1.6"
      />
      {/* Both are pinned to the width they print at: whatever font the browser
          substitutes, neither may spill outside the circle. */}
      <text
        x={nfcCx}
        y={flipY(layout.nfc_kicker_baseline)}
        textAnchor="middle"
        textLength={12.5}
        lengthAdjust="spacingAndGlyphs"
        fill={mutedInk}
        fontFamily={FACE_FONT}
        fontSize={5.4 * PT}
      >
        NFC STICKER
      </text>
      <text
        x={nfcCx}
        y={flipY(layout.nfc_label_baseline)}
        textAnchor="middle"
        textLength={18.9}
        lengthAdjust="spacingAndGlyphs"
        fill={ink}
        fontFamily={FACE_FONT}
        fontSize={8.4 * PT}
        fontWeight={700}
      >
        SCAN HERE
      </text>

      <Plate rect={layout.panel} radius={layout.panel_radius} design={design} />

      <text
        x={contentX}
        y={flipY(layout.heading_baseline)}
        fill={ink}
        fontFamily={FACE_FONT}
        fontSize={11.5 * PT}
        fontWeight={700}
      >
        If you found this bag
      </text>
      <WrappedText
        text={
          'Tap the circle above with your phone, or scan the code below. The page tells you ' +
          'whether the owner has reported this bag lost, and lets you message them without ' +
          'either of you sharing a number.'
        }
        x={contentX}
        top={flipY(layout.heading_baseline) + 11.5 * PT * 1.2 + 3}
        sizePt={7.0}
        leadingPt={7.0 * 1.28}
        maxWidth={contentW}
        fill={ink}
      />

      <CodeBlock
        color={ink}
        x={layout.qr[0]}
        y={flipY(layout.qr[1] + layout.qr[3])}
        size={layout.qr[2]}
      />
      <text
        x={BLEED_W_MM / 2}
        y={flipY(layout.footer_baseline)}
        textAnchor="middle"
        fill={mutedInk}
        fontFamily={FACE_FONT}
        fontSize={5.4 * PT}
      >
        dynamic luggage tag
      </text>

      <HolePlate disc={layout.hole} design={design} />
    </Face>
  )
}

/* ------------------------------------------------------------ shared -- */

// The PDF embeds Bitstream Vera Sans; Verdana is the closest widely installed
// relative, with DejaVu Sans (Vera's descendant) preferred.
const FACE_FONT = "'DejaVu Sans', 'Bitstream Vera Sans', Verdana, sans-serif"

/** Print coordinates grow upward from the bottom edge; SVG grows downward. */
function flipY(y: number): number {
  return BLEED_H_MM - y
}

/** The field, the motif over it, and whatever the face draws on top. */
function Face({
  className,
  viewHeight,
  label,
  design,
  children,
}: {
  className?: string
  viewHeight: number
  label: string
  design: DesignSpec
  children: React.ReactNode
}) {
  // useId keeps two tags on one page from sharing a clip path.
  const clipId = `motif-clip-${useId().replace(/:/g, '')}`

  return (
    <svg
      className={className ?? 'tag-art'}
      viewBox={`0 0 ${BLEED_W_MM} ${viewHeight}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={BLEED_W_MM} height={BLEED_H_MM} />
        </clipPath>
      </defs>

      {/* Field colour runs to the bleed edge, as it does in print — and the
          motif runs over all of it. */}
      <rect x={0} y={0} width={BLEED_W_MM} height={BLEED_H_MM} fill={design.field} />
      <g clipPath={`url(#${clipId})`}>
        {motifShapes(design, BLEED_W_MM, BLEED_H_MM).map((shape, index) => (
          <MotifShape key={index} shape={shape} />
        ))}
      </g>

      {children}
    </svg>
  )
}

/** A rounded plate of plain field colour, laid over the motif. */
function Plate({ rect, radius, design }: { rect: Rect; radius: number; design: DesignSpec }) {
  const [x, y, width, height] = rect
  return (
    <rect
      x={x}
      y={flipY(y + height)}
      width={width}
      height={height}
      rx={radius}
      fill={design.field}
      stroke={rgbToCss(muted(hexToRgb(design.ink)))}
      strokeWidth={0.4 * PT}
    />
  )
}

/** Where the strap hole is punched, on its own plate so the motif stops short. */
function HolePlate({
  disc,
  design,
}: {
  disc: [number, number, number]
  design: DesignSpec
}) {
  const [cx, cy, plateRadius] = disc
  const mutedInk = rgbToCss(muted(hexToRgb(design.ink)))
  return (
    <g>
      <circle cx={cx} cy={flipY(cy)} r={plateRadius} fill={design.field} />
      <circle
        cx={cx}
        cy={flipY(cy)}
        r={HOLE_DIAMETER_MM / 2}
        fill={design.field}
        stroke={mutedInk}
        strokeWidth={0.3 * PT}
      />
    </g>
  )
}

/** The owner's bag icon, scaled from its own 0-100 box into tag millimetres. */
function BagIcon({
  rect,
  icon,
  color,
  design,
}: {
  rect: Rect
  icon: string
  color: string
  design: DesignSpec
}) {
  const [boxX, boxY, size] = rect
  const scale = size / ICON_BOX
  return (
    <g transform={`translate(${boxX} ${flipY(boxY + size)}) scale(${scale})`} aria-hidden="true">
      <BagGlyphShapes icon={icon} color={color} paper={design.field} />
    </g>
  )
}

function MotifShape({ shape }: { shape: Shape }) {
  switch (shape.kind) {
    case 'rect':
      return (
        <rect
          x={shape.x}
          y={flipY(shape.y + shape.height)}
          width={shape.width}
          height={shape.height}
          fill={rgbToCss(shape.fill)}
        />
      )
    case 'circle':
      return <circle cx={shape.cx} cy={flipY(shape.cy)} r={shape.r} fill={rgbToCss(shape.fill)} />
    case 'line':
      return (
        <line
          x1={shape.x1}
          y1={flipY(shape.y1)}
          x2={shape.x2}
          y2={flipY(shape.y2)}
          stroke={rgbToCss(shape.stroke)}
          strokeWidth={shape.strokeWidth}
          strokeLinecap={shape.cap}
        />
      )
    case 'polyline':
      return (
        <polyline
          points={shape.points.map(([px, py]) => `${px},${flipY(py)}`).join(' ')}
          fill="none"
          stroke={rgbToCss(shape.stroke)}
          strokeWidth={shape.strokeWidth}
          strokeLinecap={shape.cap}
          strokeLinejoin="miter"
        />
      )
  }
}

/**
 * Print measures the embedded font exactly; the browser cannot without laying
 * the text out first, so these estimate the width. They are a preview of where
 * type sits and how large it prints, not a typesetting guarantee.
 */
function advance(pt: number, weight: number, text: string): number {
  const perEm = weight >= 700 ? 0.62 : 0.56 // for a humanist sans
  return text.length * pt * PT * perEm
}

/** One line of type, shrunk to fit, then ellipsised. */
function FittedText({
  text,
  x,
  y,
  maxPt,
  minPt,
  maxWidth = SAFE_W_MM,
  fill,
  weight,
}: {
  text: string
  x: number
  y: number
  maxPt: number
  minPt: number
  maxWidth?: number
  fill: string
  weight: number
}) {
  let size = maxPt
  while (size > minPt && advance(size, weight, text) > maxWidth) size -= 0.25

  // Only a line that still overruns at the smallest size gets cut — matching
  // _draw_fitted, which shrinks first and ellipsises only as a last resort.
  let shown = text
  if (advance(size, weight, shown) > maxWidth) {
    while (shown.length > 1 && advance(size, weight, `${shown}…`) > maxWidth) {
      shown = shown.slice(0, -1)
    }
    shown = `${shown}…`
  }

  return (
    <text
      x={x}
      y={y}
      fill={fill}
      fontFamily={FACE_FONT}
      fontSize={size * PT}
      fontWeight={weight}
    >
      {shown}
    </text>
  )
}

/** A short paragraph, wrapped on word boundaries at the estimated width. */
function WrappedText({
  text,
  x,
  top,
  sizePt,
  leadingPt,
  maxWidth,
  fill,
}: {
  text: string
  x: number
  top: number
  sizePt: number
  leadingPt: number
  maxWidth: number
  fill: string
}) {
  const lines: string[] = []
  let current = ''
  for (const word of text.split(' ')) {
    const candidate = current ? `${current} ${word}` : word
    if (!current || advance(sizePt, 400, candidate) <= maxWidth) {
      current = candidate
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)

  return (
    <text x={x} y={top} fill={fill} fontFamily={FACE_FONT} fontSize={sizePt * PT}>
      {lines.map((line, index) => (
        <tspan key={index} x={x} dy={index === 0 ? 0 : leadingPt * PT}>
          {line}
        </tspan>
      ))}
    </text>
  )
}

/**
 * A stand-in for the QR symbol.
 *
 * Deliberately not a real code: the dashboard renders many tags at once and
 * the scannable symbol lives behind an authenticated endpoint, so a preview
 * that looked scannable would invite someone to try scanning it.
 */
function CodeBlock({ color, x, y, size }: { color: string; x: number; y: number; size: number }) {
  const cells = 7
  const unit = size / cells
  const filled = [0, 1, 2, 6, 8, 12, 13, 16, 18, 20, 24, 27, 30, 32, 35, 38, 40, 42, 44, 47, 48]
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      <rect x={0} y={0} width={size} height={size} fill="#FFFFFF" />
      {filled.map((index) => (
        <rect
          key={index}
          x={(index % cells) * unit + unit * 0.1}
          y={Math.floor(index / cells) * unit + unit * 0.1}
          width={unit * 0.8}
          height={unit * 0.8}
          fill={color}
        />
      ))}
    </g>
  )
}
