/**
 * Design helpers for the browser: a fallback spec, names, and date formatting.
 *
 * The spec itself is generated server-side (`api/app/core/design.py`). The
 * motif geometry lives in `lib/motif.ts`, a tested port of the code that draws
 * the print PDF.
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
