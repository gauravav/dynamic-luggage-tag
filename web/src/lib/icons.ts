/**
 * Bag icons — a line-for-line port of `api/app/core/icons.py`.
 *
 * Python is the reference, because Python is what draws the PDF that actually
 * gets printed. Do not adjust a coordinate here: change it there, port it, and
 * `api/tests/test_motif_parity.py` confirms the two still agree.
 *
 * Coordinates live in a 0-100 box with the origin at the bottom-left and y
 * increasing upward (PDF's convention). The renderer flips y.
 *
 * Kept to syntax Node can run with type stripping alone, so the parity test
 * can execute this file directly.
 */

export type IconTone = 'ink' | 'paper'

export type IconOp =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; tone: IconTone }
  | { kind: 'rrect'; x: number; y: number; w: number; h: number; r: number; tone: IconTone }
  | { kind: 'circle'; cx: number; cy: number; r: number; tone: IconTone }
  | { kind: 'poly'; points: number[][]; tone: IconTone }
  | { kind: 'stroke'; points: number[][]; width: number; tone: IconTone }

export const ICON_BOX = 100.0

export const ICON_COLORS: Record<string, string> = {
  ink: '#242017',
  forest: '#2F5D4E',
  brick: '#9C3B2A',
  brass: '#8C6221',
  indigo: '#33447A',
  plum: '#6B3560',
  teal: '#1F5C63',
  ochre: '#A56A16',
  slate: '#3B4A52',
}

export const DEFAULT_ICON_COLOR = 'ink'

export const ICONS: Record<string, IconOp[]> = {
  suitcase: [
    { kind: "stroke", points: [[38, 74], [38, 86], [44, 92], [56, 92], [62, 86], [62, 74]], width: 6.0, tone: "ink" },
    { kind: "rrect", x: 10, y: 10, w: 80, h: 66, r: 9, tone: "ink" },
    { kind: "rect", x: 28, y: 10, w: 8, h: 66, tone: "paper" },
    { kind: "rect", x: 64, y: 10, w: 8, h: 66, tone: "paper" },
    { kind: "rect", x: 44, y: 44, w: 12, h: 7, tone: "paper" },
  ],
  roller: [
    { kind: "stroke", points: [[36, 70], [36, 94], [64, 94], [64, 70]], width: 6.0, tone: "ink" },
    { kind: "rrect", x: 14, y: 16, w: 72, h: 58, r: 8, tone: "ink" },
    { kind: "rect", x: 14, y: 43, w: 72, h: 5, tone: "paper" },
    { kind: "circle", cx: 27, cy: 9, r: 7, tone: "ink" },
    { kind: "circle", cx: 73, cy: 9, r: 7, tone: "ink" },
  ],
  duffel: [
    { kind: "stroke", points: [[33, 60], [37, 82], [63, 82], [67, 60]], width: 6.0, tone: "ink" },
    { kind: "rrect", x: 6, y: 22, w: 88, h: 44, r: 22, tone: "ink" },
    { kind: "rect", x: 22, y: 41, w: 56, h: 5, tone: "paper" },
  ],
  backpack: [
    { kind: "rect", x: 25, y: 58, w: 9, h: 26, tone: "ink" },
    { kind: "rect", x: 66, y: 58, w: 9, h: 26, tone: "ink" },
    { kind: "rrect", x: 12, y: 6, w: 76, h: 72, r: 20, tone: "ink" },
    { kind: "rect", x: 12, y: 54, w: 76, h: 5, tone: "paper" },
    { kind: "rrect", x: 32, y: 16, w: 36, h: 26, r: 7, tone: "paper" },
  ],
  tote: [
    { kind: "stroke", points: [[30, 58], [34, 82], [66, 82], [70, 58]], width: 6.0, tone: "ink" },
    { kind: "poly", points: [[14, 8], [86, 8], [78, 62], [22, 62]], tone: "ink" },
    { kind: "rect", x: 24, y: 42, w: 52, h: 5, tone: "paper" },
  ],
  briefcase: [
    { kind: "stroke", points: [[40, 70], [40, 82], [60, 82], [60, 70]], width: 6.0, tone: "ink" },
    { kind: "rrect", x: 8, y: 16, w: 84, h: 56, r: 7, tone: "ink" },
    { kind: "rect", x: 8, y: 40, w: 84, h: 6, tone: "paper" },
    { kind: "rect", x: 43, y: 36, w: 14, h: 14, tone: "paper" },
  ],
  garment: [
    { kind: "stroke", points: [[50, 74], [50, 90], [61, 95]], width: 5.0, tone: "ink" },
    { kind: "poly", points: [[26, 4], [74, 4], [80, 68], [50, 82], [20, 68]], tone: "ink" },
    { kind: "rect", x: 47, y: 4, w: 6, h: 64, tone: "paper" },
  ],
  box: [
    { kind: "rrect", x: 10, y: 10, w: 80, h: 66, r: 5, tone: "ink" },
    { kind: "rect", x: 43, y: 10, w: 14, h: 66, tone: "paper" },
    { kind: "rect", x: 10, y: 48, w: 80, h: 5, tone: "paper" },
  ],
}

export const ICON_NAMES = Object.keys(ICONS)

/** How the owner's choice reads back to them. */
export const ICON_LABELS: Record<string, string> = {
  suitcase: 'Suitcase',
  roller: 'Carry-on',
  duffel: 'Duffel',
  backpack: 'Backpack',
  tote: 'Tote',
  briefcase: 'Briefcase',
  garment: 'Garment bag',
  box: 'Box',
}

/** The drawing operations for an icon, or nothing at all. */
export function iconOps(name: string | null | undefined): IconOp[] {
  if (!name) return []
  return ICONS[name] ?? []
}

/** The hex colour for a palette name, falling back to ink. */
export function iconColour(name: string | null | undefined): string {
  return ICON_COLORS[name ?? DEFAULT_ICON_COLOR] ?? ICON_COLORS[DEFAULT_ICON_COLOR]
}
