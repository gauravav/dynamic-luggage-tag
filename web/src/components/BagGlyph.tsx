/**
 * The owner's bag icon, drawn from the geometry shared with the print renderer.
 *
 * `lib/icons.ts` stores each icon in a 0-100 box with the origin at the
 * bottom-left, because that is PDF's convention and the PDF is what gets
 * printed. This module flips it once, into the 0-100 top-left box SVG wants,
 * and everything on screen draws from the result: the tag face scales the same
 * group down to 13 mm, the picker shows it at 34 px.
 *
 * Two tones: `ink` is the colour the owner chose, `paper` is whatever surface
 * the icon sits on, used to cut a zip or a strap out of a filled shape.
 */

import { ICON_BOX, iconOps, type IconOp } from '../lib/icons'

interface Tones {
  icon: string | null | undefined
  color: string
  /** The surface behind the icon, for the cut-out details. */
  paper: string
}

/** Flips the stored y, which grows upward, into SVG's, which grows downward. */
const flip = (y: number) => ICON_BOX - y

/** The icon's shapes, in a 0-100 box with the origin at the top-left. */
export function BagGlyphShapes({ icon, color, paper }: Tones) {
  const tone = (op: IconOp) => (op.tone === 'ink' ? color : paper)
  const points = (op: Extract<IconOp, { points: [number, number][] }>) =>
    op.points.map(([x, y]) => `${x},${flip(y)}`).join(' ')

  return (
    <>
      {iconOps(icon).map((op, index) => {
        switch (op.kind) {
          case 'rect':
            return (
              <rect
                key={index}
                x={op.x}
                y={flip(op.y + op.h)}
                width={op.w}
                height={op.h}
                fill={tone(op)}
              />
            )
          case 'rrect':
            return (
              <rect
                key={index}
                x={op.x}
                y={flip(op.y + op.h)}
                width={op.w}
                height={op.h}
                rx={op.r}
                fill={tone(op)}
              />
            )
          case 'circle':
            return <circle key={index} cx={op.cx} cy={flip(op.cy)} r={op.r} fill={tone(op)} />
          case 'poly':
            return <polygon key={index} points={points(op)} fill={tone(op)} />
          case 'stroke':
            return (
              <polyline
                key={index}
                points={points(op)}
                fill="none"
                stroke={tone(op)}
                strokeWidth={op.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )
        }
      })}
    </>
  )
}

/** The icon on its own, for pickers and lists. */
export function BagGlyph({
  icon,
  color,
  paper,
  size = 34,
  title,
}: Tones & { size?: number; title?: string }) {
  return (
    <svg
      viewBox={`0 0 ${ICON_BOX} ${ICON_BOX}`}
      width={size}
      height={size}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <BagGlyphShapes icon={icon} color={color} paper={paper} />
    </svg>
  )
}
