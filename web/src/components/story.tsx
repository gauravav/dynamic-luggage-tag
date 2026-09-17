/**
 * The four scenes that carry the landing page's argument.
 *
 * Each one loops on its own and says a single thing, in order:
 *
 *   CarouselScene       you can pick your bag out of a moving belt
 *   MarkLostScene       the tag says nothing personal until you say so
 *   FinderScene         a stranger taps it and you hear about it
 *   EncryptedRelayScene and what passes between you is sealed on the way
 *
 * The bags are drawn with the same icon geometry the printed tag uses
 * (`lib/icons.ts`), so the shapes on the marketing page and the shapes on the
 * product are literally the same shapes.
 *
 * They are decoration: each is `aria-hidden`, and the prose beside them makes
 * the same point for anyone who never sees them. Reduced motion is handled
 * globally by `MotionConfig` in main.tsx.
 */

import { motion, type Transition } from 'motion/react'
import { BagGlyphShapes } from './BagGlyph'

const FIELD = '#EDF1EC'
const PAPER = '#FAF6EC'
const INK = '#2F5D4E'
const DEEP = '#1F4034'
const BRICK = '#9C3B2A'
const BRASS = '#8C6221'
const LINE = '#DCD0AF'
const GREY = '#B4AD9C'

function Scene({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 260 150" className="scene" role="img" aria-label={label}>
      {children}
    </svg>
  )
}

/** A bag on the belt, drawn from the shared icon geometry. */
function Bag({
  x,
  icon,
  color,
  size = 52,
}: {
  x: number
  icon: string
  color: string
  size?: number
}) {
  return (
    <g transform={`translate(${x} ${104 - size}) scale(${size / 100})`}>
      <BagGlyphShapes icon={icon} color={color} paper={PAPER} />
    </g>
  )
}

/**
 * A baggage belt with four bags going by, one of them yours.
 *
 * The belt runs continuously and the train of bags is drawn twice, offset by
 * exactly one loop width, so the seam never arrives.
 */
export function CarouselScene() {
  // Spaced so no two silhouettes touch: bags that overlap read as one object.
  const others = [
    { x: 0, icon: 'suitcase' },
    { x: 120, icon: 'duffel' },
    { x: 198, icon: 'backpack' },
  ]
  const LOOP = 260

  return (
    <Scene label="Bags going past on a belt, with one carrying your pattern picked out">
      {/* The belt, and the slats that show it moving. */}
      <rect x="0" y="104" width="260" height="22" rx="4" fill="#E2DAC6" />
      <g clipPath="url(#belt-clip)">
        <clipPath id="belt-clip">
          <rect x="0" y="104" width="260" height="22" rx="4" />
        </clipPath>
        <motion.g
          animate={{ x: [0, -26] }}
          transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
        >
          {Array.from({ length: 12 }, (_, index) => (
            <line
              key={index}
              x1={index * 26}
              y1="104"
              x2={index * 26 - 8}
              y2="126"
              stroke={LINE}
              strokeWidth="2"
            />
          ))}
        </motion.g>
      </g>
      <rect x="0" y="126" width="260" height="5" rx="2.5" fill="#CFC5AC" />

      <motion.g
        animate={{ x: [0, -LOOP] }}
        transition={{ duration: 11, repeat: Infinity, ease: 'linear' }}
      >
        {[0, LOOP].map((offset) => (
          <g key={offset} transform={`translate(${offset} 0)`}>
            {others.map((bag) => (
              <Bag key={bag.x} x={bag.x} icon={bag.icon} color={GREY} />
            ))}
            <YourBag x={52} />
          </g>
        ))}
      </motion.g>
    </Scene>
  )
}

/** The traveller's own bag: patterned, tagged, and ringed as it passes. */
function YourBag({ x }: { x: number }) {
  return (
    <g>
      <Bag x={x} icon="roller" color={INK} size={62} />
      {/* The tag swinging off the handle. */}
      <motion.g
        style={{ transformBox: 'view-box', transformOrigin: `${x + 46}px 54px` }}
        animate={{ rotate: [-9, 9, -9] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      >
        <line x1={x + 46} y1="54" x2={x + 46} y2="62" stroke={BRASS} strokeWidth="1.6" />
        <rect
          x={x + 39}
          y="62"
          width="15"
          height="20"
          rx="2.5"
          fill={FIELD}
          stroke={BRASS}
          strokeWidth="1.4"
        />
        <line x1={x + 41} y1="66" x2={x + 52} y2="78" stroke={INK} strokeWidth="1.8" />
        <line x1={x + 45} y1="64" x2={x + 54} y2="74" stroke={BRASS} strokeWidth="1.8" />
      </motion.g>
      {/* "That one." A ring that finds it, over and over. */}
      {[0, 1].map((index) => (
        <motion.circle
          key={index}
          cx={x + 31}
          cy="72"
          r="34"
          fill="none"
          stroke={BRASS}
          strokeWidth="2.4"
          initial={{ opacity: 0, scale: 0.55 }}
          animate={{ opacity: [0, 0.75, 0], scale: [0.55, 1, 1.12] }}
          transition={{
            duration: 2.2,
            repeat: Infinity,
            repeatDelay: 1.4,
            ease: 'easeOut',
            delay: index * 0.45,
          }}
          style={{ transformBox: 'view-box', transformOrigin: `${x + 31}px 72px` }}
        />
      ))}
    </g>
  )
}

/**
 * The owner flipping a bag to lost, and the tag changing what it says.
 *
 * One loop: safe, the switch slides over, the tag turns and pulses, then it
 * all settles back — so the scene reads both ways round.
 */
export function MarkLostScene() {
  // Every keyframe track below runs on this one clock, so the switch, the
  // pill and the tag can never drift out of step with one another.
  const beat: Transition = {
    duration: 6,
    repeat: Infinity,
    times: [0, 0.22, 0.34, 0.8, 0.92, 1],
    ease: 'easeInOut',
  }
  const lost = [0, 0, 1, 1, 0, 0]

  return (
    <Scene label="An owner switching a bag to lost, and the tag changing to match">
      {/* The owner's phone, with the one switch that matters. */}
      <rect x="12" y="16" width="104" height="120" rx="12" fill={DEEP} />
      <rect x="18" y="26" width="92" height="100" rx="7" fill={PAPER} />
      <rect x="26" y="36" width="52" height="6" rx="3" fill={LINE} />
      <rect x="26" y="50" width="40" height="5" rx="2.5" fill="#E6DCC3" />

      <rect x="26" y="70" width="58" height="6" rx="3" fill="#CFC5AC" />
      <rect x="26" y="84" width="40" height="5" rx="2.5" fill="#E6DCC3" />

      <motion.rect
        x="26"
        y="102"
        width="34"
        height="18"
        rx="9"
        fill="#CFC5AC"
        animate={{ fill: lost.map((on) => (on ? BRICK : '#CFC5AC')) }}
        transition={beat}
      />
      <motion.circle
        cx="35"
        cy="111"
        r="7"
        fill={PAPER}
        animate={{ cx: lost.map((on) => (on ? 51 : 35)) }}
        transition={beat}
      />
      <motion.rect
        x="68"
        y="106"
        width="30"
        height="9"
        rx="4.5"
        fill={INK}
        animate={{ fill: lost.map((on) => (on ? BRICK : INK)) }}
        transition={beat}
      />

      {/* The tag, which is what a stranger would actually be holding. */}
      <motion.g
        style={{ transformBox: 'view-box', transformOrigin: '186px 14px' }}
        animate={{ rotate: [0, 0, -5, 4, 0, 0] }}
        transition={beat}
      >
        <line x1="186" y1="10" x2="186" y2="26" stroke={LINE} strokeWidth="2.5" />
        <rect
          x="156"
          y="26"
          width="60"
          height="86"
          rx="8"
          fill={FIELD}
          stroke={LINE}
          strokeWidth="2"
        />
        <circle cx="186" cy="37" r="4" fill={FIELD} stroke={LINE} strokeWidth="1.8" />

        {/* The status pill: the whole point of the scene. */}
        <motion.rect
          x="166"
          y="52"
          width="40"
          height="14"
          rx="7"
          fill="#E4EFEA"
          animate={{ fill: lost.map((on) => (on ? '#F5E1DC' : '#E4EFEA')) }}
          transition={beat}
        />
        <motion.circle
          cx="174"
          cy="59"
          r="3"
          fill={INK}
          animate={{ fill: lost.map((on) => (on ? BRICK : INK)) }}
          transition={beat}
        />
        <motion.rect
          x="180"
          y="56.5"
          width="20"
          height="5"
          rx="2.5"
          fill={INK}
          animate={{ fill: lost.map((on) => (on ? BRICK : INK)) }}
          transition={beat}
        />

        {/* Only once it is lost does a name appear on it. */}
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: lost }} transition={beat}>
          <rect x="166" y="74" width="40" height="6" rx="3" fill={INK} />
          <rect x="166" y="86" width="28" height="4.5" rx="2.25" fill={GREY} />
        </motion.g>
        <motion.rect
          x="166"
          y="74"
          width="40"
          height="6"
          rx="3"
          fill={LINE}
          animate={{ opacity: lost.map((on) => (on ? 0 : 1)) }}
          transition={beat}
        />
      </motion.g>

      {/* The alarm going off, once it is lost. */}
      <motion.circle
        cx="186"
        cy="59"
        r="30"
        fill="none"
        stroke={BRICK}
        strokeWidth="2"
        style={{ transformBox: 'view-box', transformOrigin: '186px 59px' }}
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: [0, 0, 0.6, 0, 0, 0], scale: [0.7, 0.7, 1.3, 1.5, 0.7, 0.7] }}
        transition={beat}
      />
    </Scene>
  )
}

/**
 * A passer-by taps the tag, and the owner hears about it.
 *
 * Three beats on one clock: the tap, the note travelling, the phone lighting
 * up. Nothing about the finder travels with it — which is the point the
 * prose beside the scene makes.
 */
export function FinderScene() {
  const beat: Transition = { duration: 5, repeat: Infinity, ease: 'easeInOut' }

  return (
    <Scene label="A passer-by tapping a tag, and a notification reaching the owner">
      {/* The bag, with its tag. */}
      <g transform="translate(6 46) scale(0.58)">
        <BagGlyphShapes icon="duffel" color={INK} paper={PAPER} />
      </g>
      <rect x="44" y="60" width="17" height="24" rx="3" fill={FIELD} stroke={BRASS} strokeWidth="1.6" />
      <line x1="47" y1="66" x2="58" y2="78" stroke={INK} strokeWidth="2" />

      {/* The finder's phone, arriving and tapping. */}
      <motion.g
        initial={{ x: 26, opacity: 0 }}
        animate={{ x: [26, 0, 0, 26, 26], opacity: [0, 1, 1, 0, 0] }}
        transition={{ ...beat, times: [0, 0.14, 0.34, 0.46, 1] }}
      >
        <rect x="70" y="52" width="24" height="42" rx="5" fill={DEEP} />
        <rect x="73" y="56" width="18" height="32" rx="3" fill="#E4EFEA" />
        {[0, 1, 2].map((index) => (
          <motion.path
            key={index}
            d={['M66 66 a10 10 0 0 0 0 14', 'M61 61 a17 17 0 0 0 0 24', 'M56 56 a24 24 0 0 0 0 34'][index]}
            fill="none"
            stroke={BRASS}
            strokeWidth="2.4"
            strokeLinecap="round"
            animate={{ opacity: [0, 1, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.16, ease: 'easeInOut' }}
          />
        ))}
      </motion.g>

      {/* The note travelling — along a path that is drawn as it goes. */}
      <motion.path
        d="M104 62 C 140 30 176 30 206 54"
        fill="none"
        stroke={LINE}
        strokeWidth="2"
        strokeDasharray="4 5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: [0, 0, 1, 1, 0] }}
        transition={{ ...beat, times: [0, 0.34, 0.6, 0.86, 1] }}
      />
      <motion.g
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{
          x: [0, 0, 102, 102, 0],
          y: [0, 0, -8, -8, 0],
          opacity: [0, 0, 1, 0, 0],
          scale: [0.6, 0.6, 1, 1, 0.6],
        }}
        transition={{ ...beat, times: [0, 0.36, 0.6, 0.72, 1] }}
        style={{ transformBox: 'view-box', transformOrigin: '112px 58px' }}
      >
        <rect x="102" y="50" width="22" height="16" rx="3" fill={PAPER} stroke={INK} strokeWidth="1.8" />
        <path d="M102 52 l11 8 l11 -8" fill="none" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      </motion.g>

      {/* The owner's phone, lighting up. */}
      <rect x="196" y="40" width="52" height="86" rx="10" fill={DEEP} />
      <rect x="201" y="47" width="42" height="72" rx="5" fill={PAPER} />
      <motion.g
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: [0, 0, 0, 1, 1, 0], y: [-6, -6, -6, 0, 0, -6] }}
        transition={{ ...beat, times: [0, 0.5, 0.62, 0.7, 0.92, 1] }}
      >
        <rect x="206" y="54" width="32" height="22" rx="4" fill={FIELD} stroke={INK} strokeWidth="1.4" />
        <circle cx="213" cy="61" r="3" fill={BRASS} />
        <rect x="219" y="59" width="15" height="4" rx="2" fill={INK} />
        <rect x="210" y="68" width="24" height="3.5" rx="1.75" fill={GREY} />
      </motion.g>
      <motion.circle
        cx="244"
        cy="44"
        r="6"
        fill={BRICK}
        style={{ transformBox: 'view-box', transformOrigin: '244px 44px' }}
        initial={{ scale: 0 }}
        animate={{ scale: [0, 0, 0, 1, 1, 0] }}
        transition={{ ...beat, times: [0, 0.5, 0.64, 0.72, 0.92, 1] }}
      />
    </Scene>
  )
}

/**
 * What the relay actually does to a message in transit.
 *
 * The words leave one phone legible, scramble the instant they are on the
 * wire, and land legible at the other end. The padlock rides along with them.
 */
export function EncryptedRelayScene() {
  const beat: Transition = { duration: 4.6, repeat: Infinity, ease: 'linear' }

  return (
    <Scene label="A message leaving one phone, scrambled in transit, arriving readable at the other">
      {[16, 196].map((x) => (
        <g key={x}>
          <rect x={x} y="30" width="48" height="90" rx="9" fill={DEEP} />
          <rect x={x + 4} y="36" width="40" height="78" rx="5" fill={PAPER} />
        </g>
      ))}

      {/* The channel between them. */}
      <line x1="68" y1="75" x2="192" y2="75" stroke={LINE} strokeWidth="2" strokeDasharray="3 6" />

      {/* The message, legible at both ends and scrambled in the middle. */}
      <motion.g
        animate={{ x: [0, 124] }}
        transition={beat}
        style={{ transformBox: 'view-box', transformOrigin: '80px 75px' }}
      >
        <rect x="64" y="62" width="34" height="26" rx="5" fill={FIELD} stroke={INK} strokeWidth="1.6" />
        {/* Readable lines, which fade out as the scramble fades in. */}
        <motion.g
          initial={{ opacity: 1 }}
          animate={{ opacity: [1, 0, 0, 1] }}
          transition={{ ...beat, times: [0, 0.16, 0.84, 1] }}
        >
          <rect x="70" y="69" width="22" height="3.6" rx="1.8" fill={INK} />
          <rect x="70" y="77" width="15" height="3.6" rx="1.8" fill={GREY} />
        </motion.g>
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{ ...beat, times: [0, 0.16, 0.84, 1] }}
        >
          {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
            <motion.rect
              key={index}
              x={70 + (index % 4) * 6}
              y={69 + Math.floor(index / 4) * 8}
              width="4"
              height="3.6"
              rx="1"
              fill={BRASS}
              animate={{ opacity: [1, 0.25, 1] }}
              transition={{
                duration: 0.4,
                repeat: Infinity,
                delay: index * 0.07,
                ease: 'linear',
              }}
            />
          ))}
        </motion.g>
      </motion.g>

      {/* A padlock closing over the channel: it is sealed the whole way. */}
      <g transform="translate(118 96)">
        <motion.path
          d="M8 12 V7 a8 8 0 0 1 16 0 V12"
          fill="none"
          stroke={INK}
          strokeWidth="3.4"
          strokeLinecap="round"
          initial={{ y: -5 }}
          animate={{ y: [-5, 0, 0, -5] }}
          transition={{ ...beat, times: [0, 0.18, 0.82, 1], ease: 'easeOut' }}
        />
        <rect x="2" y="11" width="28" height="22" rx="5" fill={INK} />
        <circle cx="16" cy="20" r="3" fill={PAPER} />
        <rect x="14.6" y="21" width="2.8" height="7" rx="1.4" fill={PAPER} />
      </g>

      {/* Nothing in the middle can read it — including us. */}
      <g transform="translate(112 24)" opacity="0.75">
        <path
          d="M2 10 C 10 1 26 1 34 10 C 26 19 10 19 2 10 Z"
          fill="none"
          stroke={GREY}
          strokeWidth="2"
        />
        <circle cx="18" cy="10" r="4" fill="none" stroke={GREY} strokeWidth="2" />
        <line x1="2" y1="19" x2="34" y2="1" stroke={BRICK} strokeWidth="2.4" strokeLinecap="round" />
      </g>
    </Scene>
  )
}
