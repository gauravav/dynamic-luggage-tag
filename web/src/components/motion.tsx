/**
 * Shared motion vocabulary.
 *
 * One small set of movements reused everywhere, so the app feels consistent:
 * things arrive by rising gently into place, lists cascade, and actions
 * acknowledge themselves. Everything goes through `MotionConfig
 * reducedMotion="user"` (see main.tsx): anyone who asks their OS for reduced
 * motion gets instant state changes, with opacity fades only.
 */

import { AnimatePresence, motion, useInView, type HTMLMotionProps, type Transition } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * True once the element has been scrolled into view — or once a short grace
 * period has passed, whichever comes first.
 *
 * The fallback matters: an IntersectionObserver may never report an element
 * that is skipped over, which happens with an anchor jump, Cmd+Down, a
 * restored scroll position or find-in-page. Without it, those sections would
 * stay at opacity 0 permanently — invisible content, not just a missed
 * animation.
 */
type ViewportMargin = NonNullable<Parameters<typeof useInView>[1]>['margin']

function useRevealed(margin: ViewportMargin = '-60px'): [React.RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin })
  const [elapsed, setElapsed] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setElapsed(true), 2500)
    return () => window.clearTimeout(timer)
  }, [])
  return [ref, inView || elapsed]
}

export const spring: Transition = { type: 'spring', stiffness: 380, damping: 30 }
export const softSpring: Transition = { type: 'spring', stiffness: 220, damping: 24 }

/** Rises gently into place on mount. */
export function Reveal({
  children,
  delay = 0,
  y = 14,
  ...rest
}: { children: ReactNode; delay?: number; y?: number } & HTMLMotionProps<'div'>) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...softSpring, delay }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

/** Like Reveal, but waits until scrolled into view. Plays once. */
export function RevealOnScroll({
  children,
  delay = 0,
  ...rest
}: { children: ReactNode; delay?: number } & HTMLMotionProps<'div'>) {
  const [ref, revealed] = useRevealed()
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={revealed ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      transition={{ ...softSpring, delay }}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

const staggerParent = {
  hidden: {},
  shown: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
}
const staggerChild = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  shown: { opacity: 1, y: 0, scale: 1, transition: softSpring },
}

/** A container whose StaggerItem children cascade in one after another. */
export function Stagger({
  children,
  onScroll = false,
  ...rest
}: { children: ReactNode; onScroll?: boolean } & Omit<HTMLMotionProps<'div'>, 'onScroll'>) {
  const [ref, revealed] = useRevealed('-40px')
  return (
    <motion.div
      ref={ref}
      variants={staggerParent}
      initial="hidden"
      animate={onScroll ? (revealed ? 'shown' : 'hidden') : 'shown'}
      {...rest}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, ...rest }: { children: ReactNode } & HTMLMotionProps<'div'>) {
  return (
    <motion.div variants={staggerChild} {...rest}>
      {children}
    </motion.div>
  )
}

/** A spinner that sits inside a button while its action runs. */
export function ButtonSpinner() {
  return <span className="btn__spinner" aria-hidden="true" />
}

/** Button contents that swap label for spinner + busy label, with a cross-fade. */
export function BusyLabel({ busy, idle, working }: { busy: boolean; idle: ReactNode; working: ReactNode }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={busy ? 'busy' : 'idle'}
        className="btn__label"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.14 }}
      >
        {busy && <ButtonSpinner />}
        {busy ? working : idle}
      </motion.span>
    </AnimatePresence>
  )
}

/**
 * Label for a "send" button: a paper plane that takes off while sending and
 * glides back in once the button is ready again.
 */
export function SendLabel({ busy, idle = 'Send', working = 'Sending…' }: { busy: boolean; idle?: string; working?: string }) {
  return (
    <span className="btn__label">
      <AnimatePresence mode="popLayout" initial={false}>
        {!busy && (
          <motion.svg
            key="plane"
            className="btn__icon"
            viewBox="0 0 24 24"
            width="16"
            height="16"
            aria-hidden="true"
            initial={{ x: -18, y: 10, opacity: 0, rotate: -20 }}
            animate={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            exit={{ x: 60, y: -36, opacity: 0, rotate: 12, transition: { duration: 0.45, ease: 'easeIn' } }}
            transition={spring}
          >
            <path d="M2.5 11.2 21 3.5l-6.8 17.3-3.1-7.1-8.6-2.5Zm8.6 2.5L21 3.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
          </motion.svg>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={busy ? 'busy' : 'idle'}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.14 }}
        >
          {busy ? working : idle}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/** Shimmering placeholder blocks while content loads. */
export function Skeleton({ height = 16, width = '100%', radius = 8, style }: {
  height?: number | string
  width?: number | string
  radius?: number
  style?: React.CSSProperties
}) {
  return <span className="skeleton" style={{ height, width, borderRadius: radius, ...style }} aria-hidden="true" />
}

/** A tick that pops in: for confirmations like "Saved". */
export function SuccessTick({ size = 18 }: { size?: number }) {
  return (
    <motion.svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="success-tick">
      <motion.circle
        cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      />
      <motion.path
        d="M7.5 12.5 10.5 15.5 16.5 9"
        fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.3, delay: 0.25, ease: 'easeOut' }}
      />
    </motion.svg>
  )
}
