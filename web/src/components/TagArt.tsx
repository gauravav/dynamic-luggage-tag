/**
 * The tag face, drawn from a design spec.
 *
 * A preview of the printed tag, not an impression of it. The motif shapes and
 * the front-face layout come from `lib/motif.ts`, a port of the Python code
 * that renders the print PDF, and `api/tests/test_motif_parity.py` checks the
 * two produce identical geometry. This component only converts coordinates
 * (print uses a bottom-left origin, SVG a top-left one) and draws.
 *
 * The viewBox is the bleed in millimetres, 74.10 x 108.40.
 */

import { useId } from 'react'
import type { DesignSpec } from '../api/client'
import {
  BLEED_H_MM,
  BLEED_MARGIN_MM,
  BLEED_W_MM,
  HOLE_CENTRE_FROM_TRIM_TOP_MM,
  HOLE_DIAMETER_MM,
  SAFE_W_MM,
  frontLayout,
  hexToRgb,
  motifShapes,
  muted,
  rgbToCss,
  type Shape,
} from '../lib/motif'

const PT = 25.4 / 72 // one PostScript point, in millimetres

interface Props {
  design: DesignSpec
  name?: string | null
  subtitle?: string | null
  /** Draws the QR placeholder block. Off for small previews. */
  showCode?: boolean
  /**
   * Crops to the top of the tag — hole, motif and rule.
   *
   * For a finder holding the bag, the motif is the whole question: is this the
   * tag I am looking at? The rest of the face is dead space on screen.
   */
  crest?: boolean
  className?: string
  title?: string
}

export function TagArt({
  design,
  name,
  subtitle,
  showCode = true,
  crest = false,
  className,
  title,
}: Props) {
  // useId keeps two tags on one page from sharing a clip path.
  const clipId = `motif-clip-${useId().replace(/:/g, '')}`

  const layout = frontLayout(design.accent_band)
  const [patternX, patternY, patternW, patternH] = layout.pattern
  const shapes = motifShapes(design, patternW, patternH)

  // Print coordinates grow upward from the bottom edge; SVG grows downward.
  const flipY = (y: number) => BLEED_H_MM - y
  const ink = design.ink
  const mutedInk = rgbToCss(muted(hexToRgb(design.ink)))

  const ruleY = flipY(layout.rule_y)
  const viewHeight = crest ? ruleY + 2 : BLEED_H_MM

  return (
    <svg
      className={className ?? 'tag-art'}
      viewBox={`0 0 ${BLEED_W_MM} ${viewHeight}`}
      role="img"
      aria-label={title ?? `Luggage tag design: ${design.palette} ${design.motif}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id={clipId}>
          <rect
            x={patternX}
            y={flipY(patternY + patternH)}
            width={patternW}
            height={patternH}
          />
        </clipPath>
      </defs>

      {/* Field colour runs to the bleed edge, as it does in print. */}
      <rect x={0} y={0} width={BLEED_W_MM} height={BLEED_H_MM} fill={design.field} />

      <g clipPath={`url(#${clipId})`}>
        {shapes.map((shape, index) => (
          <MotifShape
            key={index}
            shape={shape}
            originX={patternX}
            originY={patternY}
            flipY={flipY}
          />
        ))}
      </g>

      <line
        x1={layout.rule[0]}
        y1={ruleY}
        x2={layout.rule[1]}
        y2={ruleY}
        stroke={ink}
        strokeWidth={0.5 * PT}
      />

      {!crest && design.accent_band && (
        <rect
          x={layout.band[0]}
          y={flipY(layout.band[1] + layout.band[3])}
          width={layout.band[2]}
          height={layout.band[3]}
          fill={design.accent}
        />
      )}

      {!crest && name && (
        <FittedText
          text={name}
          x={layout.band[0]}
          y={flipY(layout.name_baseline)}
          maxPt={16}
          minPt={9}
          fill={ink}
          weight={700}
        />
      )}
      {!crest && subtitle && (
        <FittedText
          text={subtitle}
          x={layout.band[0]}
          y={flipY(layout.subtitle_baseline)}
          maxPt={8.5}
          minPt={6.5}
          fill={mutedInk}
          weight={400}
        />
      )}

      {showCode && !crest && (
        <CodeBlock
          color={ink}
          x={layout.qr[0]}
          y={flipY(layout.qr[1] + layout.qr[3])}
          size={layout.qr[2]}
        />
      )}

      {/* Where the strap hole is punched. */}
      <circle
        cx={BLEED_W_MM / 2}
        cy={BLEED_MARGIN_MM + HOLE_CENTRE_FROM_TRIM_TOP_MM}
        r={HOLE_DIAMETER_MM / 2}
        fill={design.field}
        stroke={mutedInk}
        strokeWidth={0.3 * PT}
      />
    </svg>
  )
}

function MotifShape({
  shape,
  originX,
  originY,
  flipY,
}: {
  shape: Shape
  originX: number
  originY: number
  flipY: (y: number) => number
}) {
  const x = (value: number) => originX + value
  const y = (value: number) => flipY(originY + value)

  switch (shape.kind) {
    case 'rect':
      return (
        <rect
          x={x(shape.x)}
          y={y(shape.y + shape.height)}
          width={shape.width}
          height={shape.height}
          fill={rgbToCss(shape.fill)}
        />
      )
    case 'circle':
      return <circle cx={x(shape.cx)} cy={y(shape.cy)} r={shape.r} fill={rgbToCss(shape.fill)} />
    case 'line':
      return (
        <line
          x1={x(shape.x1)}
          y1={y(shape.y1)}
          x2={x(shape.x2)}
          y2={y(shape.y2)}
          stroke={rgbToCss(shape.stroke)}
          strokeWidth={shape.strokeWidth}
          strokeLinecap={shape.cap}
        />
      )
    case 'polyline':
      return (
        <polyline
          points={shape.points.map(([px, py]) => `${x(px)},${y(py)}`).join(' ')}
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
 * One line of type, shrunk to fit the safety width, then ellipsised.
 *
 * Print measures the embedded font exactly; the browser cannot without laying
 * the text out first, so this estimates the width. It is a preview of where
 * the name sits and how large it prints, not a typesetting guarantee.
 */
function FittedText({
  text,
  x,
  y,
  maxPt,
  minPt,
  fill,
  weight,
}: {
  text: string
  x: number
  y: number
  maxPt: number
  minPt: number
  fill: string
  weight: number
}) {
  const averageAdvance = weight >= 700 ? 0.62 : 0.56 // em, for a humanist sans
  const widthAt = (pt: number, value: string) => value.length * pt * PT * averageAdvance

  let size = maxPt
  while (size > minPt && widthAt(size, text) > SAFE_W_MM) size -= 0.25

  let shown = text
  while (shown.length > 1 && widthAt(size, `${shown}…`) > SAFE_W_MM) shown = shown.slice(0, -1)
  if (shown !== text) shown = `${shown}…`

  return (
    <text
      x={x}
      y={y}
      fill={fill}
      // The PDF embeds Bitstream Vera Sans; Verdana is the closest widely
      // installed relative, with DejaVu Sans (Vera's descendant) preferred.
      fontFamily="'DejaVu Sans', 'Bitstream Vera Sans', Verdana, sans-serif"
      fontSize={size * PT}
      fontWeight={weight}
    >
      {shown}
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
