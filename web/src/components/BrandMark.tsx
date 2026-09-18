/**
 * The mascot, at brand size.
 *
 * The same mole as the favicon and the companion, reduced to what survives at
 * 24 pixels in a header: a head over a tag, two eyes, a snout, two paws. It
 * replaced a striped square that was a picture of the product; this is a
 * picture of the thing people remember.
 *
 * Drawn rather than loaded as an image so it inherits the page's colours and
 * can blink — a static mark would be fine, and a mark that notices you is
 * better.
 */

import { motion } from 'motion/react'
import { useEffect, useState } from 'react'

const FUR = '#6B5F52'
const FUR_DARK = '#4A4036'
const SNOUT = '#C9A08C'
const NOSE = '#6E4F42'

export function BrandMark({ size = 26 }: { size?: number }) {
  const blinking = useBlink()

  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      className="brand__mole"
    >
      <ellipse cx="22" cy="17" rx="4.4" ry="4.8" fill={FUR_DARK} />
      <ellipse cx="42" cy="17" rx="4.4" ry="4.8" fill={FUR_DARK} />
      <circle cx="32" cy="24" r="15.5" fill={FUR} />

      {/* The eyes shut by dropping a lid of fur, as they do everywhere else. */}
      {[25.5, 38.5].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="21" r="4.6" fill="#FFFFFF" />
          <circle cx={cx} cy="21.4" r="2.4" fill="#242017" />
          <motion.rect
            x={cx - 5}
            y="15.4"
            width="10"
            height="11"
            fill={FUR}
            initial={false}
            animate={{ y: blinking ? 0 : -12 }}
            transition={{ duration: 0.09 }}
          />
        </g>
      ))}

      <path
        d="M25 30 C25 24 39 24 39 30 C39 35 36 38 32 38 C28 38 25 35 25 30 Z"
        fill={SNOUT}
      />
      <ellipse cx="32" cy="34" rx="3.6" ry="2.7" fill={NOSE} />

      <clipPath id="brand-tag">
        <rect x="14" y="36" width="36" height="26" rx="5" />
      </clipPath>
      <rect
        x="14"
        y="36"
        width="36"
        height="26"
        rx="5"
        fill="#EDF1EC"
        stroke="#B9C7BF"
        strokeWidth="1.5"
      />
      <g clipPath="url(#brand-tag)">
        <path
          d="M8 60 L30 32 M20 68 L44 34 M34 70 L58 38"
          stroke="#2F5D4E"
          strokeWidth="5"
          fill="none"
        />
        <path d="M14 68 L38 34" stroke="#8C6221" strokeWidth="5" fill="none" />
      </g>

      <ellipse cx="16" cy="37" rx="6" ry="4.6" fill={FUR_DARK} />
      <ellipse cx="48" cy="37" rx="6" ry="4.6" fill={FUR_DARK} />
    </svg>
  )
}

/** An occasional blink, on an irregular rhythm. Same idea as the companion. */
function useBlink(): boolean {
  const [blinking, setBlinking] = useState(false)
  useEffect(() => {
    let shut: number | undefined
    const schedule = (): number =>
      window.setTimeout(
        () => {
          setBlinking(true)
          shut = window.setTimeout(() => {
            setBlinking(false)
            open = schedule()
          }, 120)
        },
        3200 + Math.random() * 4200,
      )
    let open = schedule()
    return () => {
      window.clearTimeout(open)
      if (shut !== undefined) window.clearTimeout(shut)
    }
  }, [])
  return blinking
}
