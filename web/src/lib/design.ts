/**
 * Browser-side renderer for the design spec.
 *
 * The API is the source of truth for the spec itself — see
 * `api/app/core/design.py`, which generates it deterministically from the
 * traveller's seed. This file only draws it. The Python side draws the same
 * spec into the print PDF (`api/app/core/print_layout.py`), so a change to the
 * motif list or the palette has to land in both renderers.
 *
 * Motifs are expressed as SVG <pattern> tiles: the same shapes the PDF draws,
 * but tiled by the browser rather than plotted one by one.
 */

import type { DesignSpec } from '../api/client'

export const FALLBACK_DESIGN: DesignSpec = {
  version: 1,
  palette: 'forest',
  field: '#EDF1EC',
  ink: '#2F5D4E',
  accent: '#8C6221',
  motif: 'weave',
  density: 6,
  weight: 10,
  angle: 45,
  offset: 0,
  accent_band: false,
}

export interface PatternTile {
  /** Tile size in user units. */
  size: number
  /** Rotation applied to the whole tile, in degrees. */
  rotate: number
  /** Shapes drawn inside one tile. */
  shapes: TileShape[]
}

export type TileShape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; fill: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: string }
  | { kind: 'path'; d: string; stroke: string; strokeWidth: number }

/**
 * Builds the repeating tile for a design.
 *
 * `density` sets how many marks span the artwork, and `weight` is a stroke
 * width in tenths of a millimetre on the print side — here it is scaled into
 * the same proportion of the tile, so both renderings read at the same weight.
 */
export function patternTile(design: DesignSpec): PatternTile {
  const size = Math.max(6, 48 / Math.max(2, design.density)) * 2
  const stroke = Math.max(0.8, (design.weight / 10) * (size / 12))
  const { ink, accent } = design

  switch (design.motif) {
    case 'dot': {
      const r = Math.max(1, size * 0.14)
      return {
        size,
        rotate: 0,
        shapes: [
          { kind: 'circle', cx: size * 0.25, cy: size * 0.25, r, fill: ink },
          { kind: 'circle', cx: size * 0.75, cy: size * 0.75, r, fill: accent },
        ],
      }
    }

    case 'diagonal':
      return {
        size,
        rotate: clampAngle(design.angle, 20, 70),
        shapes: [
          { kind: 'rect', x: 0, y: 0, width: stroke, height: size, fill: ink },
        ],
      }

    case 'chevron':
      return {
        size,
        rotate: 0,
        shapes: [
          {
            kind: 'path',
            d: `M0 ${size * 0.72} L${size * 0.5} ${size * 0.28} L${size} ${size * 0.72}`,
            stroke: ink,
            strokeWidth: stroke,
          },
        ],
      }

    case 'grid':
      return {
        size,
        rotate: 0,
        shapes: [
          { kind: 'rect', x: 0, y: 0, width: stroke, height: size, fill: ink },
          { kind: 'rect', x: 0, y: 0, width: size, height: stroke, fill: ink },
        ],
      }

    case 'ladder':
      return {
        size,
        rotate: 0,
        shapes: [
          { kind: 'rect', x: 0, y: 0, width: size, height: stroke * 1.6, fill: ink },
          { kind: 'rect', x: 0, y: size * 0.5, width: size * 0.55, height: stroke * 1.6, fill: accent },
        ],
      }

    case 'weave':
    default:
      return {
        size,
        rotate: 0,
        shapes: [
          {
            kind: 'path',
            d: `M0 0 L${size} ${size}`,
            stroke: ink,
            strokeWidth: stroke,
          },
          {
            kind: 'path',
            d: `M${size} 0 L0 ${size}`,
            stroke: accent,
            strokeWidth: stroke * 0.55,
          },
        ],
      }
  }
}

function clampAngle(angle: number, min: number, max: number): number {
  const normalized = ((angle % 180) + 180) % 180
  return Math.min(max, Math.max(min, normalized))
}

/** A stable id per design, so two tags on one page do not share a <pattern>. */
export function patternId(design: DesignSpec, suffix: string): string {
  return `motif-${design.palette}-${design.motif}-${design.density}-${design.angle}-${suffix}`
}

/** Human-readable name for a design, used as the tag's caption. */
export function describe(design: DesignSpec): string {
  const motif: Record<string, string> = {
    weave: 'weave',
    dot: 'dot',
    diagonal: 'diagonal',
    chevron: 'chevron',
    grid: 'grid',
    ladder: 'ladder',
  }
  const palette = design.palette.charAt(0).toUpperCase() + design.palette.slice(1)
  return `${palette} ${motif[design.motif] ?? design.motif}`
}

/** Formats an ISO timestamp for display, in the viewer's own locale. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

/** "3 days from now" / "2 hours ago", for retention and activity copy. */
export function relativeTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const deltaSeconds = Math.round((date.getTime() - Date.now()) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, seconds] of units) {
    if (Math.abs(deltaSeconds) >= seconds) {
      return formatter.format(Math.round(deltaSeconds / seconds), unit)
    }
  }
  return formatter.format(deltaSeconds, 'second')
}
