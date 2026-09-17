/**
 * The mole that holds your luggage tag while you sign in.
 *
 * It exists to answer a question people are right to ask at a password field:
 * is anything watching me type? So it behaves like something that can be
 * trusted to look away.
 *
 *   watching   you are in the email field — it reads along as you type, eyes
 *              tracking left to right
 *   hiding     you are in the password field — it lifts the tag over its eyes
 *   peeking    you pressed Show — it lowers the tag just enough to squint over
 *              the top, because now you have said you want it read back
 *   idle       nothing focused; it looks ahead and blinks
 *
 * Everything animates through `MotionConfig reducedMotion="user"` (main.tsx),
 * so anyone who asks their OS for less motion gets the poses without the
 * travel between them.
 */

import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

export type MoleState = 'idle' | 'watching' | 'hiding' | 'peeking'

const FUR = '#6B5F52'
const FUR_DARK = '#564C41'
const SNOUT = '#C9A08C'
const NOSE = '#6E4F42'
const EAR = '#D9A8A0'
const PUPIL = '#242017'

/** Eye centres, and the geometry the lids and the tag are measured against. */
const EYE_Y = 72
const EYE_R = 8.5
const EYES = [85, 115]

/**
 * How high the tag is held, per pose.
 *
 * The eyes run from y=63.5 to y=80.5. `hiding` clears their top edge outright;
 * `peeking` cuts them in half, so what shows over the tag is the upper half of
 * a pupil. Held low, the tag has to clear the snout too, or the mole looks
 * muzzled rather than relaxed.
 */
const TAG_Y: Record<MoleState, number> = {
  idle: 112,
  watching: 120,
  peeking: 72,
  hiding: 56,
}

interface Props {
  state: MoleState
  /** Where along the line it is reading, 0 to 1. Only used while watching. */
  gaze?: number
  className?: string
}

export function LuggageMole({ state, gaze = 0, className }: Props) {
  const blinking = useBlink(state === 'idle' || state === 'watching')
  const reduced = useReducedMotion()

  const eyesShut = state === 'hiding' || blinking
  const squint = state === 'peeking'
  // Reading runs left to right, and the head follows a little way behind the
  // eyes — turning the whole head for every character would read as a twitch.
  const look = (Math.min(1, Math.max(0, gaze)) - 0.5) * 2
  const tracking = state === 'watching'

  return (
    <div className={className ?? 'mole'} aria-hidden="true">
      <svg viewBox="0 0 200 170" width="100%" height="100%">
        <ellipse cx="100" cy="155" rx="52" ry="7" fill="rgba(36,32,23,0.10)" />

        <motion.g
          animate={{ rotate: tracking ? look * 3 : 0, y: state === 'hiding' ? 2 : 0 }}
          transition={{ type: 'spring', stiffness: 170, damping: 18 }}
          style={{ transformBox: 'view-box', transformOrigin: '100px 130px' }}
        >
          {/* Body, then head: drawn in that order so the head sits in front. */}
          <ellipse cx="100" cy="120" rx="45" ry="35" fill={FUR} />
          <ellipse cx="100" cy="132" rx="30" ry="22" fill={FUR_DARK} opacity="0.35" />

          <Ear x={73} />
          <Ear x={127} />

          <circle cx="100" cy="76" r="37" fill={FUR} />

          {EYES.map((cx, index) => (
            <Eye
              key={cx}
              cx={cx}
              shut={eyesShut}
              squint={squint}
              look={tracking ? look : 0}
              delay={index * 0.02}
            />
          ))}

          {/* Snout: it lifts a touch while reading, as if following the line. */}
          <motion.g
            animate={{ y: tracking ? -1.5 : 0, x: tracking ? look * 2 : 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}
          >
            {/* A snout that tapers to the nose, rather than a round muzzle:
                the one feature that says mole rather than bear cub. */}
            <path
              d="M83 86 C 83 74 117 74 117 86 C 117 98 111 108 100 108 C 89 108 83 98 83 86 Z"
              fill={SNOUT}
            />
            <ellipse cx="100" cy="101" rx="8" ry="6" fill={NOSE} />
            <circle cx="96.8" cy="100" r="1.3" fill="#3A2A22" />
            <circle cx="103.2" cy="100" r="1.3" fill="#3A2A22" />
            <path
              d="M100 106 v3.5 M100 109 q-5 3.5 -9 0.5 M100 109 q5 3.5 9 0.5"
              fill="none"
              stroke={NOSE}
              strokeWidth="1.7"
              strokeLinecap="round"
            />
            {[-1, 1].map((side) => (
              <g key={side}>
                {[-4, 1, 6].map((drop) => (
                  <line
                    key={drop}
                    x1={100 + side * 15}
                    y1={95 + drop}
                    x2={100 + side * 36}
                    y2={90 + drop * 1.9}
                    stroke={FUR_DARK}
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    opacity="0.75"
                  />
                ))}
              </g>
            ))}
          </motion.g>
        </motion.g>

        {/* The tag itself, and the paws holding it. */}
        <motion.g
          initial={false}
          animate={{ y: TAG_Y[state] }}
          transition={
            reduced
              ? { duration: 0 }
              : // Springy, but not bouncy enough to flash the eyes back open
                // on the way up to cover them.
                { type: 'spring', stiffness: 260, damping: 26 }
          }
        >
          <HeldTag />
          <Paw x={62} />
          <Paw x={138} />
        </motion.g>
      </svg>
    </div>
  )
}

/** Barely there, which is the point: a mole's ears are folds, not saucers. */
function Ear({ x }: { x: number }) {
  return (
    <g>
      <ellipse cx={x} cy={56} rx={6} ry={6.5} fill={FUR_DARK} />
      <ellipse cx={x} cy={56.5} rx={2.6} ry={3} fill={EAR} />
    </g>
  )
}

/**
 * One eye.
 *
 * The lid is a block of fur that slides down over a clipped eye, so closing is
 * a real movement rather than the eye being swapped for a line.
 */
function Eye({
  cx,
  shut,
  squint,
  look,
  delay,
}: {
  cx: number
  shut: boolean
  squint: boolean
  look: number
  delay: number
}) {
  const clipId = `mole-eye-${cx}`
  // 0 = wide open, 1 = shut. The squint only narrows the eye a little: the
  // tag edge is already doing most of the covering, and a hard squint on top
  // of it leaves nothing to see at all.
  const closed = shut ? 1 : squint ? 0.25 : 0
  return (
    <g>
      <clipPath id={clipId}>
        <circle cx={cx} cy={EYE_Y} r={EYE_R} />
      </clipPath>
      <circle cx={cx} cy={EYE_Y} r={EYE_R + 1.2} fill={FUR_DARK} />
      <g clipPath={`url(#${clipId})`}>
        <circle cx={cx} cy={EYE_Y} r={EYE_R} fill="#FFFFFF" />
        <motion.g
          // Peeking, the pupils ride up into the sliver above the tag.
          animate={{ x: look * 3.4, y: shut ? 1.5 : squint ? -1.8 : 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22, delay }}
        >
          <circle cx={cx} cy={EYE_Y} r={4.3} fill={PUPIL} />
          <circle cx={cx - 1.5} cy={EYE_Y - 1.8} r={1.5} fill="#FFFFFF" opacity="0.9" />
        </motion.g>
        <motion.g
          initial={false}
          animate={{ y: -(EYE_R * 2 + 2) * (1 - closed) }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
        >
          <rect
            x={cx - EYE_R - 1}
            y={EYE_Y - EYE_R - 1}
            width={EYE_R * 2 + 2}
            height={EYE_R * 2 + 2}
            fill={FUR}
          />
          <line
            x1={cx - EYE_R - 1}
            y1={EYE_Y + EYE_R + 0.6}
            x2={cx + EYE_R + 1}
            y2={EYE_Y + EYE_R + 0.6}
            stroke={FUR_DARK}
            strokeWidth="1.6"
          />
        </motion.g>
      </g>
    </g>
  )
}

/**
 * A paw curled over the top edge of the tag.
 *
 * Broad, turned outward and tipped with pale digging claws — a mole's hands
 * are the other half of what makes it recognisable.
 */
function Paw({ x }: { x: number }) {
  const outward = x < 100 ? -1 : 1
  return (
    <g transform={`rotate(${outward * -14} ${x} 8)`}>
      <ellipse cx={x} cy={9} rx={13} ry={10} fill={FUR_DARK} />
      {[-7, -2.4, 2.4, 7].map((offset) => (
        <path
          key={offset}
          d={`M${x + offset} 6 q ${offset * 0.25} -5 ${offset * 0.45} -6.5`}
          fill="none"
          stroke="#E8D9C6"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      ))}
    </g>
  )
}

/** The tag in its paws: the same shape the rest of the app draws, simplified. */
function HeldTag() {
  return (
    <g>
      <clipPath id="mole-tag-clip">
        <rect x={58} y={0} width={84} height={120} rx={9} />
      </clipPath>
      <rect
        x={58}
        y={0}
        width={84}
        height={120}
        rx={9}
        fill="#EDF1EC"
        stroke="#B9C7BF"
        strokeWidth="1.5"
      />
      <g clipPath="url(#mole-tag-clip)" opacity="0.85">
        {[-80, -56, -32, -8, 16, 40, 64, 88].map((offset) => (
          <line
            key={offset}
            x1={58 + offset}
            y1={124}
            x2={58 + offset + 124}
            y2={0}
            stroke={offset % 48 === 0 ? '#8C6221' : '#2F5D4E'}
            strokeWidth="3"
          />
        ))}
      </g>
      <circle cx={100} cy={16} r={5.5} fill="#EDF1EC" stroke="#B9C7BF" strokeWidth="1.5" />
      <rect x={70} y={74} width={44} height={5} rx={2.5} fill="#2F5D4E" />
      <rect x={70} y={85} width={30} height={4} rx={2} fill="#2F5D4E" opacity="0.5" />
      <rect x={70} y={96} width={22} height={16} rx={3} fill="#FFFFFF" />
    </g>
  )
}

/**
 * An occasional blink, on a human-ish irregular rhythm.
 *
 * Paused whenever the eyes are already covered: a blink underneath the tag is
 * motion nobody can see, and it would fight the pose on the way back out.
 */
function useBlink(active: boolean): boolean {
  const [blinking, setBlinking] = useState(false)

  useEffect(() => {
    if (!active) {
      setBlinking(false)
      return
    }
    let shut: number | undefined
    const schedule = () => {
      const next = 2600 + Math.random() * 3400
      return window.setTimeout(() => {
        setBlinking(true)
        shut = window.setTimeout(() => {
          setBlinking(false)
          open = schedule()
        }, 130)
      }, next)
    }
    let open = schedule()
    return () => {
      window.clearTimeout(open)
      if (shut !== undefined) window.clearTimeout(shut)
    }
  }, [active])

  return blinking
}
