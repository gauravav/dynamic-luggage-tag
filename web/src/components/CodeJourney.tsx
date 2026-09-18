/**
 * What happens to the six suitcases once the code is submitted.
 *
 * They are loaded onto a plane, it takes off, it lands, they come off onto a
 * carousel — and then either the owner collects them or somebody else walks
 * off with them. Which of those two endings plays is the answer to whether
 * the code was right, told as the thing the whole product is about.
 *
 * The scene is one SVG on a fixed clock. Each phase knows when it starts, so
 * nothing is chained off anything else finishing and a slow frame cannot
 * leave a suitcase stranded on the tarmac.
 *
 * It is `aria-hidden` throughout and the form announces the real outcome in
 * text: nobody should have to watch an aeroplane to find out whether they are
 * signed in.
 */

import { motion } from 'motion/react'
import { useReducedMotion } from 'motion/react'

export type JourneyPhase = 'idle' | 'flying' | 'collected' | 'taken'

/** Seconds, from submit. The verdict lands at `ARRIVES`. */
const LOADING = 0
const TAKEOFF = 0.9
const CRUISE = 1.7
const LANDING = 2.6
const UNLOAD = 3.3
const ARRIVES = 4.1
export const JOURNEY_MS = 5200

const INK = '#2F5D4E'
const DEEP = '#1F4034'
const BRASS = '#8C6221'
const BRICK = '#9C3B2A'
const LINE = '#DCD0AF'
const PAPER = '#FAF6EC'

const CASES = [0, 1, 2, 3, 4, 5]

export function CodeJourney({ phase }: { phase: JourneyPhase }) {
  const reduced = useReducedMotion()
  const flying = phase !== 'idle'
  const ending = phase === 'collected' || phase === 'taken'

  // Reduced motion gets the ending and none of the travel: the information is
  // in who picks the cases up, not in the aeroplane.
  if (reduced) {
    return (
      <div className="journey" aria-hidden="true">
        <svg viewBox="0 0 320 120" className="journey__art">
          <Belt />
          {CASES.map((index) => (
            <Case key={index} x={96 + index * 22} y={78} tone={index % 3 === 0 ? BRASS : INK} />
          ))}
          {ending && <Collector taken={phase === 'taken'} instant />}
        </svg>
      </div>
    )
  }

  return (
    <div className="journey" aria-hidden="true">
      <svg viewBox="0 0 320 120" className="journey__art">
        {/* Ground line and the belt the cases end up on. */}
        <Belt />

        {/* The plane: taxis in, climbs away, returns from the left. */}
        <motion.g
          initial={{ x: -140, y: 0, opacity: 0 }}
          animate={
            flying
              ? {
                  x: [-140, 40, 40, 300, -180, 40, 40],
                  y: [0, 0, 0, -70, -70, 0, 0],
                  opacity: [0, 1, 1, 1, 1, 1, 1],
                }
              : { x: -140, y: 0, opacity: 0 }
          }
          transition={{
            duration: UNLOAD,
            times: [0, 0.16, 0.3, 0.46, 0.5, 0.74, 1],
            ease: 'easeInOut',
          }}
        >
          <Plane />
        </motion.g>

        {/* The six cases: on the apron, into the hold, out again, onto the
            belt. Each one leaves and returns a beat after the one before. */}
        {CASES.map((index) => (
          <motion.g
            key={index}
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={
              flying
                ? {
                    x: [0, 44 - index * 22, 44 - index * 22, 0, 0],
                    y: [0, -6, -6, 0, 0],
                    opacity: [1, 1, 0, 1, 1],
                  }
                : { x: 0, y: 0, opacity: 1 }
            }
            transition={{
              duration: UNLOAD,
              times: [0, 0.2, 0.26, 0.82, 1],
              delay: index * 0.06,
              ease: 'easeInOut',
            }}
          >
            <Case x={96 + index * 22} y={78} tone={index % 3 === 0 ? BRASS : INK} />
          </motion.g>
        ))}

        {/* And whoever is waiting at the carousel. */}
        {ending && <Collector taken={phase === 'taken'} />}
      </svg>
    </div>
  )
}

function Belt() {
  return (
    <g>
      <rect x="86" y="92" width="150" height="12" rx="5" fill="#E2DAC6" />
      <rect x="86" y="104" width="150" height="4" rx="2" fill="#CFC5AC" />
      <motion.g
        animate={{ x: [0, -18] }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
      >
        {Array.from({ length: 12 }, (_, index) => (
          <line
            key={index}
            x1={86 + index * 18}
            y1="92"
            x2={86 + index * 18 - 6}
            y2="104"
            stroke={LINE}
            strokeWidth="1.6"
          />
        ))}
      </motion.g>
    </g>
  )
}

function Plane() {
  return (
    <g>
      <ellipse cx="60" cy="60" rx="46" ry="12" fill={PAPER} stroke={DEEP} strokeWidth="2.4" />
      <path d="M96 60 L118 46 L110 60 L118 74 Z" fill={DEEP} />
      <path d="M52 52 L70 28 L78 28 L64 52 Z" fill={INK} />
      <path d="M52 68 L68 86 L76 86 L64 68 Z" fill={INK} opacity="0.55" />
      {[36, 48, 60, 72].map((cx) => (
        <circle key={cx} cx={cx} cy="57" r="2.6" fill={INK} opacity="0.5" />
      ))}
      <rect x="24" y="66" width="18" height="10" rx="3" fill={DEEP} opacity="0.25" />
    </g>
  )
}

function Case({ x, y, tone }: { x: number; y: number; tone: string }) {
  return (
    <g>
      <rect x={x + 5} y={y - 4} width="8" height="4" rx="1.6" fill={tone} />
      <rect x={x} y={y} width="18" height="14" rx="3" fill={tone} />
      <rect x={x + 4} y={y} width="3" height="14" fill={PAPER} opacity="0.45" />
      <rect x={x + 11} y={y} width="3" height="14" fill={PAPER} opacity="0.45" />
    </g>
  )
}

/**
 * The figure at the belt.
 *
 * The owner arrives from the right and stops; the imposter comes from the
 * left, grabs a case and keeps going. The difference is deliberately legible
 * without the colour: one of them leaves with something.
 */
function Collector({ taken, instant }: { taken: boolean; instant?: boolean }) {
  const tone = taken ? BRICK : INK
  return (
    <motion.g
      initial={instant ? false : { x: taken ? -70 : 70, opacity: 0 }}
      animate={
        instant
          ? { x: taken ? 22 : 0, opacity: 1 }
          : taken
            ? { x: [-70, 0, 22], opacity: [0, 1, 1] }
            : { x: [70, 0], opacity: [0, 1] }
      }
      transition={{ duration: instant ? 0 : ARRIVES - UNLOAD, ease: 'easeOut' }}
    >
      <g transform="translate(222 52)">
        <circle cx="0" cy="0" r="9" fill={tone} />
        <path d="M-11 34 C-11 16 11 16 11 34 Z" fill={tone} />
        {taken && (
          <>
            {/* Walking off with one of them. */}
            <rect x="12" y="24" width="16" height="12" rx="3" fill={BRASS} />
            <rect x="9" y="22" width="12" height="3" rx="1.5" fill={tone} />
          </>
        )}
      </g>
      {taken && (
        <motion.g
          animate={{ opacity: [0, 1] }}
          transition={{ delay: 0.25, duration: 0.3 }}
          transform="translate(222 24)"
        >
          <circle cx="0" cy="0" r="10" fill={BRICK} />
          <path
            d="M-4 -4 L4 4 M4 -4 L-4 4"
            stroke={PAPER}
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </motion.g>
      )}
    </motion.g>
  )
}

/** Phase boundaries, exported so the form can narrate them in text. */
export const JOURNEY_STEPS = [
  { at: LOADING, caption: 'Loading…' },
  { at: TAKEOFF, caption: 'Taking off…' },
  { at: CRUISE, caption: 'In the air…' },
  { at: LANDING, caption: 'Landing…' },
  { at: UNLOAD, caption: 'Unloading…' },
  { at: ARRIVES, caption: 'At the carousel…' },
]
