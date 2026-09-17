/** Small animated illustrations for moments of confirmation. */

import { motion } from 'motion/react'
import type { ReactNode } from 'react'

/** An envelope that seals itself and floats off: "a link is on its way". */
export function MailSent({ size = 96 }: { size?: number }) {
  return (
    <motion.svg
      viewBox="0 0 120 100"
      width={size}
      height={(size * 100) / 120}
      aria-hidden="true"
      initial={{ opacity: 0, y: 20, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 18 }}
      style={{ overflow: 'visible' }}
    >
      <motion.g animate={{ y: [0, -4, 0] }} transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 1.2 }}>
        {/* The letter slides down into the envelope, then the flap closes over it. */}
        <motion.rect
          x="34" y="14" width="52" height="40" rx="3" fill="#FFFFFF" stroke="#DCD0AF" strokeWidth="1.5"
          initial={{ y: -18 }}
          animate={{ y: 14 }}
          transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.2 }}
        />
        <rect x="22" y="40" width="76" height="50" rx="6" fill="#2F5D4E" />
        <motion.path
          d="M22 46 60 70 98 46"
          fill="#1F4034"
          stroke="#E4EFEA"
          strokeWidth="1.5"
          strokeLinejoin="round"
          style={{ transformBox: 'view-box', transformOrigin: '60px 46px' }}
          initial={{ scaleY: -1 }}
          animate={{ scaleY: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.55 }}
        />
        <motion.circle
          cx="60" cy="66" r="6" fill="#9C3B2A"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 14, delay: 0.85 }}
          style={{ transformBox: 'view-box', transformOrigin: '60px 66px' }}
        />
      </motion.g>
      {[0, 1, 2].map((index) => (
        <motion.circle
          key={index}
          cx={30 + index * 30} cy="96" r="2" fill="#8C6221"
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: [0, 1, 0], y: [-2, -18] }}
          transition={{ duration: 1.4, delay: 1 + index * 0.2, repeat: Infinity, repeatDelay: 1.8 }}
        />
      ))}
    </motion.svg>
  )
}

/** A paper plane looping away: "your message was sent". */
export function MessageSent({ size = 88 }: { size?: number }) {
  return (
    <motion.svg viewBox="0 0 120 90" width={size} height={(size * 90) / 120} aria-hidden="true" style={{ overflow: 'visible' }}>
      <motion.path
        d="M8 78 C 30 70, 36 40, 64 44 S 100 30, 112 10"
        fill="none" stroke="#DCD0AF" strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: 'easeInOut' }}
      />
      <motion.g
        initial={{ x: -96, y: 60, rotate: 20, opacity: 0 }}
        animate={{ x: 0, y: 0, rotate: -18, opacity: 1 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      >
        <path d="M84 20 118 4 104 38 96 26Z" fill="#9C3B2A" />
        <path d="M84 20 96 26 118 4Z" fill="#7C2E20" />
      </motion.g>
    </motion.svg>
  )
}

/** A map pin dropping in with a bounce: "city shared". */
export function PinDrop({ size = 28 }: { size?: number }) {
  return (
    <motion.svg viewBox="0 0 24 30" width={size} height={(size * 30) / 24} aria-hidden="true" style={{ overflow: 'visible', flexShrink: 0 }}>
      <motion.ellipse
        cx="12" cy="28" rx="5" ry="1.6" fill="rgba(36,32,23,0.2)"
        initial={{ scale: 0.2, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.35, duration: 0.2 }}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      />
      <motion.g
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 14 }}
      >
        <path d="M12 1.5a8.5 8.5 0 0 0-8.5 8.5c0 6.3 8.5 16 8.5 16s8.5-9.7 8.5-16A8.5 8.5 0 0 0 12 1.5Z" fill="#2F5D4E" />
        <circle cx="12" cy="10" r="3.2" fill="#FAF6EC" />
      </motion.g>
    </motion.svg>
  )
}

/**
 * Hangs its children from the top like a luggage tag on a strap.
 *
 * Two movements, nested so they compose: the outer one drops the tag in and
 * lets it swing to rest, the inner one keeps it swaying gently for as long as
 * it is on screen — a tag on a bag is never quite still. `excited` swings it
 * wider, for the tag someone has just tapped a phone against.
 *
 * Anyone who asks their OS for reduced motion gets neither: `MotionConfig
 * reducedMotion="user"` in main.tsx drops both to a fade.
 */
export function SwingingTag({
  children,
  sway = true,
  delay = 0,
  idle = true,
  excited = false,
}: {
  children: ReactNode
  sway?: boolean
  delay?: number
  /** Keeps swaying after it has settled. */
  idle?: boolean
  excited?: boolean
}) {
  return (
    <motion.div
      style={{ transformOrigin: '50% 0%' }}
      initial={{ rotate: -14, y: -24, opacity: 0 }}
      animate={
        sway
          ? { rotate: [-14, 7, -4, 2, -1, 0], y: 0, opacity: 1 }
          : { rotate: 0, y: 0, opacity: 1 }
      }
      transition={{ duration: 1.4, ease: 'easeOut', delay, opacity: { duration: 0.25, delay } }}
    >
      <motion.div
        style={{ transformOrigin: '50% 0%' }}
        animate={idle ? { rotate: excited ? [-3.4, 3.4, -3.4] : [-1.3, 1.3, -1.3] } : { rotate: 0 }}
        transition={{
          duration: excited ? 1.9 : 5.2,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: delay + (sway ? 1.4 : 0),
        }}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}
