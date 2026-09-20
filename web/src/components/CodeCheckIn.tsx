/**
 * What happens to the six suitcases once the code is submitted.
 *
 * They close ranks into one big case, and if the code was right that case is
 * given a luggage tag — which is the whole product, told in the two seconds
 * someone is waiting to be let in. A wrong code refuses the case instead: it
 * shakes, nothing is tagged, and the six come back apart to be retyped.
 *
 * The scene is one SVG drawn over the code boxes, so the big case grows from
 * exactly where the small ones piled up. It is `aria-hidden` throughout and
 * the form announces the real outcome in text: nobody should have to watch a
 * suitcase to find out whether they are signed in.
 */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

export type CheckInPhase = 'idle' | 'merging' | 'tagged' | 'rejected'

/** How long the tag takes to swing on and settle, before the page moves. */
export const CHECKIN_MS = 1400
/** How long a refused case is held before the six cases come back. */
export const REJECT_MS = 900

const INK = '#2F5D4E'
const BRASS = '#8C6221'
const BRICK = '#9C3B2A'
const PAPER = '#FAF6EC'
const WHITE = '#FFFFFF'

export function CodeCheckIn({ phase }: { phase: CheckInPhase }) {
  const reduced = useReducedMotion()
  const refused = phase === 'rejected'
  const tone = refused ? BRICK : INK

  return (
    <AnimatePresence>
      {phase !== 'idle' && (
        <motion.div
          className="checkin__scene"
          aria-hidden="true"
          // The case is assembled from the pile the six boxes just made, so it
          // arrives small and grows — a beat after they start converging.
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.28 }}
          animate={
            refused
              ? { opacity: 1, scale: 1, x: [0, -10, 9, -5, 3, 0] }
              : { opacity: 1, scale: 1 }
          }
          exit={{ opacity: 0, scale: reduced ? 1 : 0.9, transition: { duration: 0.18 } }}
          transition={{
            default: { type: 'spring', stiffness: 250, damping: 20, delay: reduced ? 0 : 0.22 },
            // The refusal is a reaction, not an entrance: it plays at once.
            x: { duration: 0.45, delay: 0 },
          }}
        >
          <svg viewBox="0 0 200 172" className="checkin__art">
            {/* The handle, drawn first so the body covers its lower half. */}
            <rect
              x="62"
              y="26"
              width="36"
              height="24"
              rx="11"
              fill="none"
              stroke={tone}
              strokeWidth="5"
            />
            {/* The case the six became: same white body, same straps, bigger. */}
            <rect
              x="24"
              y="44"
              width="112"
              height="88"
              rx="14"
              fill={WHITE}
              stroke={tone}
              strokeWidth="3.5"
            />
            <rect x="48" y="44" width="10" height="88" fill={tone} opacity="0.16" />
            <rect x="102" y="44" width="10" height="88" fill={tone} opacity="0.16" />
            <rect x="72" y="126" width="16" height="6" rx="3" fill={tone} opacity="0.3" />
            <rect x="38" y="132" width="16" height="8" rx="4" fill={tone} opacity="0.45" />
            <rect x="106" y="132" width="16" height="8" rx="4" fill={tone} opacity="0.45" />

            {phase === 'tagged' && (
              <>
                {/* The string, tied to the handle and drawn towards the tag. */}
                <motion.path
                  d="M94 32 C 116 20, 146 26, 158 44"
                  fill="none"
                  stroke={BRASS}
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  initial={reduced ? { opacity: 0 } : { pathLength: 0 }}
                  animate={reduced ? { opacity: 1 } : { pathLength: 1 }}
                  transition={{ duration: 0.3 }}
                />
                {/* The tag itself, swinging down onto the handle and settling.
                    It pivots on its grommet, which is where the string ends. */}
                <g transform="translate(158 46)">
                  <motion.g
                    style={{ transformBox: 'fill-box', transformOrigin: '50% 8%' }}
                    initial={reduced ? { opacity: 0 } : { rotate: -52, opacity: 0 }}
                    animate={
                      reduced
                        ? { opacity: 1 }
                        : { rotate: [-52, 12, -6, 2, 0], opacity: 1 }
                    }
                    transition={
                      reduced
                        ? { duration: 0.2 }
                        : { duration: 0.85, delay: 0.14, ease: 'easeOut', times: [0, 0.45, 0.68, 0.86, 1] }
                    }
                  >
                    <Tag />
                  </motion.g>
                </g>
              </>
            )}
          </svg>
          {/* Nothing is said about a refusal here: the form's own notice says
              it, in words a screen reader is actually given. */}
          {phase !== 'rejected' && (
            <p className="checkin__caption">
              {phase === 'tagged' ? 'Tagged. Off you go.' : 'Checking in…'}
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** A paper luggage tag, hanging from the grommet at its local origin. */
function Tag() {
  return (
    <g>
      <path
        d="M-24 8 L-13 -6 L13 -6 L24 8 L24 54 A6 6 0 0 1 18 60 L-18 60 A6 6 0 0 1 -24 54 Z"
        fill={PAPER}
        stroke={BRASS}
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <circle cx="0" cy="2" r="4.4" fill="none" stroke={BRASS} strokeWidth="2.2" />
      {/* Where a name would go. */}
      <rect x="-14" y="16" width="28" height="3.4" rx="1.7" fill={INK} opacity="0.22" />
      <rect x="-14" y="25" width="18" height="3.4" rx="1.7" fill={INK} opacity="0.22" />
      <circle cx="0" cy="43" r="11" fill={INK} />
      <path
        d="M-5 43 L-1.6 46.4 L5.4 39"
        fill="none"
        stroke={WHITE}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  )
}
