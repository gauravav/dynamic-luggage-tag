// Evaluates the TypeScript motif, layout and icon ports for the parity test in
// api/tests/test_motif_parity.py. Reads cases as JSON on stdin, writes the
// computed geometry as JSON on stdout.
//
// Runs the .ts source directly with Node's built-in type stripping (Node 22.6+),
// so the test exercises exactly the code the browser ships — no build step,
// no second copy.
import { ICONS, ICON_COLORS } from '../src/lib/icons.ts'
import { backLayout, frontLayout, motifShapes } from '../src/lib/motif.ts'

let input = ''
for await (const chunk of process.stdin) input += chunk
const { cases } = JSON.parse(input)

process.stdout.write(
  JSON.stringify({
    shapes: cases.map(({ design, width, height }) => motifShapes(design, width, height)),
    layouts: { plain: frontLayout(false), band: frontLayout(true), back: backLayout() },
    icons: ICONS,
    iconColors: ICON_COLORS,
  }),
)
