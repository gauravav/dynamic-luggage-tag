/**
 * The tag face, drawn from a design spec.
 *
 * Proportioned to the physical tag: 74.10 x 108.40 mm at the bleed, so what
 * the dashboard shows matches what the print PDF produces.
 */

import { useId } from 'react'
import type { DesignSpec } from '../api/client'
import { patternTile } from '../lib/design'

const BLEED_W = 74.1
const BLEED_H = 108.4
// Same insets the PDF uses: 2.00 mm of bleed, then 2.50 mm of safety.
const SAFE_INSET = 4.5
const HOLE_ZONE = 16
const HOLE_R = 2.75
const HOLE_CY = 2 + 8.5

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
  // useId keeps two tags on the same page from sharing a <pattern> definition.
  const uid = useId().replace(/:/g, '')
  const patternKey = `motif-${uid}`
  const tile = patternTile(design)

  const safeX = SAFE_INSET
  const safeW = BLEED_W - SAFE_INSET * 2
  const patternTop = HOLE_ZONE
  const patternH = 30

  return (
    <svg
      className={className ?? 'tag-art'}
      viewBox={`0 0 ${BLEED_W} ${crest ? HOLE_ZONE + 34 : BLEED_H}`}
      role="img"
      aria-label={title ?? `Luggage tag design: ${design.palette} ${design.motif}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern
          id={patternKey}
          width={tile.size}
          height={tile.size}
          patternUnits="userSpaceOnUse"
          patternTransform={tile.rotate ? `rotate(${tile.rotate})` : undefined}
        >
          {tile.shapes.map((shape, index) => {
            if (shape.kind === 'rect') {
              return (
                <rect
                  key={index}
                  x={shape.x}
                  y={shape.y}
                  width={shape.width}
                  height={shape.height}
                  fill={shape.fill}
                />
              )
            }
            if (shape.kind === 'circle') {
              return (
                <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r} fill={shape.fill} />
              )
            }
            return (
              <path
                key={index}
                d={shape.d}
                stroke={shape.stroke}
                strokeWidth={shape.strokeWidth}
                fill="none"
                strokeLinecap="square"
              />
            )
          })}
        </pattern>
      </defs>

      {/* Field colour runs to the bleed edge, as it does in print. */}
      <rect x={0} y={0} width={BLEED_W} height={BLEED_H} fill={design.field} />

      {/* Motif band, also full-bleed left to right. */}
      <g>
        <rect x={0} y={patternTop} width={BLEED_W} height={patternH} fill={design.field} />
        <rect
          x={0}
          y={patternTop}
          width={BLEED_W}
          height={patternH}
          fill={`url(#${patternKey})`}
          opacity={0.92}
        />
      </g>

      <line
        x1={safeX}
        y1={patternTop + patternH + 3.5}
        x2={safeX + safeW}
        y2={patternTop + patternH + 3.5}
        stroke={design.ink}
        strokeWidth={0.4}
      />

      {design.accent_band && (
        <rect
          x={safeX}
          y={patternTop + patternH + 8}
          width={safeW}
          height={3.2}
          fill={design.accent}
        />
      )}

      {name && !crest && (
        <text
          x={safeX}
          y={patternTop + patternH + (design.accent_band ? 20 : 16)}
          fill={design.ink}
          fontFamily="Fraunces, Georgia, serif"
          fontSize={7}
          fontWeight={600}
        >
          {truncate(name, 20)}
        </text>
      )}
      {subtitle && !crest && (
        <text
          x={safeX}
          y={patternTop + patternH + (design.accent_band ? 26.5 : 22.5)}
          fill={design.ink}
          opacity={0.62}
          fontFamily="IBM Plex Sans, sans-serif"
          fontSize={4}
        >
          {truncate(subtitle, 30)}
        </text>
      )}

      {showCode && !crest && (
        <CodeBlock design={design} x={safeX} y={BLEED_H - SAFE_INSET - 30} />
      )}

      {/* Where the strap hole is punched. */}
      <circle
        cx={BLEED_W / 2}
        cy={HOLE_CY}
        r={HOLE_R}
        fill={design.field}
        stroke={design.ink}
        strokeOpacity={0.35}
        strokeWidth={0.3}
      />
    </svg>
  )
}

/**
 * A stand-in for the QR symbol.
 *
 * Deliberately not a real code: the dashboard renders many tags at once and
 * the scannable symbol lives behind an authenticated endpoint, so a preview
 * that looked scannable would invite someone to try scanning it.
 */
function CodeBlock({ design, x, y }: { design: DesignSpec; x: number; y: number }) {
  const cells = 7
  const unit = 26 / cells
  const filled = [0, 1, 2, 6, 8, 12, 13, 16, 18, 20, 24, 27, 30, 32, 35, 38, 40, 42, 44, 47, 48]
  return (
    <g transform={`translate(${x} ${y})`} aria-hidden="true">
      <rect x={0} y={0} width={26} height={26} rx={1.5} fill="#FFFFFF" />
      {Array.from({ length: cells * cells }, (_, index) =>
        filled.includes(index) ? (
          <rect
            key={index}
            x={(index % cells) * unit + unit * 0.5}
            y={Math.floor(index / cells) * unit + unit * 0.5}
            width={unit * 0.8}
            height={unit * 0.8}
            fill={design.ink}
          />
        ) : null,
      )}
    </g>
  )
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
