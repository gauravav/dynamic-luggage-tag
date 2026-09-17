/**
 * What a page shows while it is still fetching.
 *
 * Rather than a spinner, it shows the thing the app is actually for: a tag
 * hanging on a strap while a reader sweeps it and the pattern resolves. The
 * caption changes as it goes, so a slow connection reads as progress through
 * real steps rather than as a stall.
 *
 * It is one `role="status"` with a plain label. Screen readers get "Loading",
 * once — not a caption line rewriting itself every second and interrupting.
 */

import { motion } from 'motion/react'
import { useEffect, useState } from 'react'

/** Each caption holds for this long before the next one takes over. */
const STEP_MS = 1400

const STEPS = ['Reading the tag…', 'Matching the pattern…', 'Checking who may see what…']

const FIELD = '#EDF1EC'
const INK = '#2F5D4E'
const ACCENT = '#8C6221'
const LINE = '#B9C7BF'

export function PageLoader({
  label = 'Loading',
  captions = STEPS,
  className,
}: {
  label?: string
  captions?: string[]
  className?: string
}) {
  const step = useStep(captions.length)

  return (
    <div className={`loader${className ? ` ${className}` : ''}`} role="status" aria-label={label}>
      <svg viewBox="0 0 160 150" className="loader__art" aria-hidden="true">
        <defs>
          {/* The beam is brightest at its centre and fades at both edges, so it
              reads as a moving light rather than as a sliding rectangle. */}
          <linearGradient id="loader-beam" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
            <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
          <clipPath id="loader-tag">
            <rect x="46" y="26" width="68" height="96" rx="8" />
          </clipPath>
        </defs>

        {/* The strap it hangs from. */}
        <line x1="80" y1="6" x2="80" y2="30" stroke={LINE} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="80" cy="6" r="4" fill="none" stroke={LINE} strokeWidth="2.5" />

        <motion.g
          style={{ transformBox: 'view-box', transformOrigin: '80px 8px' }}
          animate={{ rotate: [-3.5, 3.5, -3.5] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <rect
            x="46"
            y="26"
            width="68"
            height="96"
            rx="8"
            fill={FIELD}
            stroke={LINE}
            strokeWidth="2"
          />

          <g clipPath="url(#loader-tag)">
            {/* The pattern resolves stripe by stripe, then starts over —
                the tag being recognised, not merely waited on. */}
            {[-70, -46, -22, 2, 26, 50, 74].map((offset, index) => (
              <motion.line
                key={offset}
                x1={46 + offset}
                y1={126}
                x2={46 + offset + 100}
                y2={22}
                stroke={index % 3 === 0 ? ACCENT : INK}
                strokeWidth="4"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: [0, 1, 1, 0], opacity: [0, 1, 1, 0] }}
                transition={{
                  duration: 2.6,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: index * 0.09,
                }}
              />
            ))}

            {/* The reader sweeping down the face. */}
            <motion.rect
              x="46"
              width="68"
              height="26"
              fill="url(#loader-beam)"
              initial={{ y: 18 }}
              animate={{ y: [18, 110, 18] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          </g>

          <circle cx="80" cy="38" r="4.5" fill={FIELD} stroke={LINE} strokeWidth="2" />
        </motion.g>

        {/* Someone's phone, held up to it, throwing NFC waves across. */}
        <g>
          <rect x="6" y="62" width="26" height="44" rx="5" fill={INK} />
          <rect x="9.5" y="66" width="19" height="34" rx="3" fill="#E4EFEA" />
          {[0, 1, 2].map((index) => (
            <motion.path
              key={index}
              d={['M36 76 a12 12 0 0 1 0 16', 'M41 70 a20 20 0 0 1 0 28', 'M46 64 a28 28 0 0 1 0 40'][index]}
              fill="none"
              stroke={ACCENT}
              strokeWidth="2.6"
              strokeLinecap="round"
              animate={{ opacity: [0.15, 1, 0.15] }}
              transition={{
                duration: 1.3,
                repeat: Infinity,
                ease: 'easeInOut',
                delay: index * 0.18,
              }}
            />
          ))}
        </g>
      </svg>

      <p className="loader__caption" aria-hidden="true">
        {captions.map((caption, index) => (
          <motion.span
            key={caption}
            className="loader__line"
            initial={false}
            animate={{ opacity: index === step ? 1 : 0, y: index === step ? 0 : 6 }}
            transition={{ duration: 0.28 }}
          >
            {caption}
          </motion.span>
        ))}
      </p>
    </div>
  )
}

/** Advances through the captions, and stops at the last one. */
function useStep(count: number): number {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (step >= count - 1) return
    const timer = window.setTimeout(() => setStep((previous) => previous + 1), STEP_MS)
    return () => window.clearTimeout(timer)
  }, [step, count])
  return step
}
