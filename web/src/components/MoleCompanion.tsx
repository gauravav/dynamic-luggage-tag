/**
 * The mole, everywhere.
 *
 * It sits in the bottom-right corner of every page, half below the edge, and
 * has something to say about whatever is on screen. Tap it and it comes up
 * with a line; leave it alone and it offers a tip after a while; ignore the
 * tips and it stops offering them.
 *
 * Three rules keep it on the right side of charming:
 *
 *  - It never covers anything. It sits clear of the phone tab bar, and the
 *    bubble opens upward into empty space.
 *  - It runs out of things to say. Each page has a short script, and once the
 *    tips are used the mole stops volunteering and waits to be tapped.
 *  - It can be sent away, and remembers — and can be brought back from
 *    Settings, because an off switch with no on switch is a trapdoor.
 *
 * What it says lives in `lib/moleScript.ts`, keyed by route, so a page can
 * never forget to describe itself.
 */

import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LuggageMole, type MoleState } from './LuggageMole'
import { errandOrder, type Antic, type Errand, type Prop } from '../lib/moleErrands'
import { moleIsHidden, onMolePreferenceChange, setMoleHidden } from '../lib/molePreference'
import { scriptFor, type MoleLine } from '../lib/moleScript'

/** How long a line stays up on its own before the mole drops back down. */
const READ_MS = 7000
/** Quiet time before it offers the next tip. */
const IDLE_MS = 24_000
/** Quiet time before it gets up and goes somewhere. Longer: it is a bigger
 *  interruption than a line of text, so it has to be rarer. */
const ERRAND_MS = 52_000
const WALK_MS = 1500
const ANTIC_MS = 1400

/** How each antic moves, once the mole has arrived. */
const ANTICS: Record<Antic, Record<string, number[]>> = {
  dig: { y: [0, 90, 90, 0], rotate: [0, 0, 0, 0] },
  hop: { y: [0, -26, 0, -18, 0] },
  spin: { rotate: [0, 360] },
  peek: { y: [0, 34, 0], rotate: [0, -8, 0] },
  stretch: { scaleY: [1, 1.22, 1], y: [0, -10, 0] },
  wobble: { rotate: [0, -14, 12, -8, 0] },
  sit: { y: [0, 18, 18, 0] },
  shiver: { x: [0, -5, 5, -4, 3, 0] },
}

export function MoleCompanion({ signedIn }: { signedIn: boolean }) {
  const { pathname } = useLocation()
  const script = scriptFor(pathname, signedIn)

  // Settings can turn it back on, so this follows the shared preference
  // rather than a copy taken at mount.
  const [dismissed, setDismissed] = useState(moleIsHidden)
  useEffect(() => onMolePreferenceChange(() => setDismissed(moleIsHidden())), [])
  const [line, setLine] = useState<MoleLine | null>(null)
  const [nextTip, setNextTip] = useState(0)
  const [nudged, setNudged] = useState(false)
  const [errand, setErrand] = useState<Errand | null>(null)
  const [away, setAway] = useState(0)
  const deck = useRef<Errand[]>([])
  const closeTimer = useRef<number | undefined>(undefined)

  const say = useCallback((next: MoleLine) => {
    setLine(next)
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setLine(null), READ_MS)
  }, [])

  // A greeting when the page changes, then nothing until asked or until the
  // page has been quiet for a while.
  useEffect(() => {
    setNextTip(0)
    setLine(null)
    if (!script || dismissed) return
    const hello = window.setTimeout(() => say(script.greeting), 1100)
    return () => window.clearTimeout(hello)
  }, [pathname, script, dismissed, say])

  // One tip at a time, and only while there are tips left to give.
  useEffect(() => {
    if (!script || dismissed || line !== null) return
    if (nextTip >= script.tips.length) return
    const timer = window.setTimeout(() => {
      say(script.tips[nextTip]!)
      setNextTip((previous) => previous + 1)
    }, IDLE_MS)
    return () => window.clearTimeout(timer)
  }, [script, dismissed, line, nextTip, say])

  // Every so often it goes and does something. One full shuffle of the thirty
  // errands before any of them comes round again, so they are not all the
  // same three.
  useEffect(() => {
    if (!script || dismissed || line !== null || errand !== null) return
    const timer = window.setTimeout(() => {
      if (deck.current.length === 0) deck.current = errandOrder()
      const next = deck.current.pop()!
      setErrand(next)

      // Out, do the thing, say it, and back. The corner is home.
      const width = typeof window === 'undefined' ? 1000 : window.innerWidth
      setAway(Math.round((next.to - 1) * width + 70))
      const arrive = window.setTimeout(() => say({ text: next.line }), WALK_MS + ANTIC_MS)
      const home = window.setTimeout(
        () => {
          setAway(0)
          window.setTimeout(() => setErrand(null), WALK_MS)
        },
        WALK_MS + ANTIC_MS + 2600,
      )
      closeTimer.current = home
      return () => {
        window.clearTimeout(arrive)
        window.clearTimeout(home)
      }
    }, ERRAND_MS)
    return () => window.clearTimeout(timer)
  }, [script, dismissed, line, errand, say])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  if (!script || dismissed) return null

  /** Tapping asks for the next thing it has, and wraps round when asked again. */
  function poke() {
    if (!script) return
    // Caught mid-errand: it comes straight home rather than being talked at
    // from across the room.
    if (errand) {
      setAway(0)
      setErrand(null)
    }
    setNudged(true)
    window.setTimeout(() => setNudged(false), 700)
    if (line !== null) {
      setLine(null)
      return
    }
    const index = nextTip % (script.tips.length || 1)
    say(script.tips[index] ?? script.greeting)
    setNextTip(index + 1)
  }

  function sendAway() {
    setLine(null)
    setMoleHidden(true)
  }

  // Up when it is talking, peeking otherwise.
  const pose: MoleState = line ? 'watching' : 'idle'

  return (
    <motion.div
      className={`mole-companion${signedIn ? ' mole-companion--app' : ''}`}
      animate={{ x: away }}
      transition={{ duration: WALK_MS / 1000, ease: 'easeInOut' }}
    >
      <AnimatePresence>
        {line && (
          <motion.div
            className="mole-bubble"
            // Polite, and only the text: the mole is decorative, what it says
            // is not, and it must never interrupt what someone is reading.
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 12, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          >
            <p>{line.text}</p>
            {line.to && line.cta && (
              <Link className="btn btn--primary btn--sm" to={line.to} onClick={() => setLine(null)}>
                {line.cta}
              </Link>
            )}
            <button
              type="button"
              className="mole-bubble__away"
              onClick={sendAway}
              // Says where the way back is, because a dismissal people cannot
              // undo is one they make once and regret quietly.
              title="Hide the mole. You can bring it back in Settings."
            >
              Don’t show me again — you can undo this in Settings
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        className="mole-companion__button"
        onClick={poke}
        aria-label={line ? 'Hide what the mole is saying' : 'Ask the mole about this page'}
        aria-expanded={line !== null}
        // Peeking over the edge, rising when it has something to say, and
        // doing whatever the errand asked for when it gets where it is going.
        animate={
          errand
            ? { y: '20%', ...ANTICS[errand.antic] }
            : { y: line ? '6%' : '44%', rotate: nudged ? [0, -5, 4, 0] : 0 }
        }
        transition={
          errand
            ? { duration: ANTIC_MS / 1000, delay: WALK_MS / 1000, ease: 'easeInOut' }
            : { type: 'spring', stiffness: 260, damping: 24, rotate: { duration: 0.6 } }
        }
        whileTap={{ scale: 0.94 }}
      >
        {errand?.prop && <ErrandProp prop={errand.prop} />}
        <LuggageMole state={pose} gaze={line ? 0.65 : 0.5} className="mole" />
      </motion.button>
    </motion.div>
  )
}

/** The small thing the mole comes back carrying. */
function ErrandProp({ prop }: { prop: Exclude<Prop, null> }) {
  return (
    <motion.span
      className="mole-prop"
      initial={{ opacity: 0, scale: 0.4 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 1.2, type: 'spring', stiffness: 400, damping: 20 }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" width="22" height="22">{PROPS[prop]}</svg>
    </motion.span>
  )
}

const PROPS: Record<Exclude<Prop, null>, React.ReactNode> = {
  tag: (
    <g>
      <rect x="6" y="4" width="12" height="17" rx="2.5" fill="#EDF1EC" stroke="#8C6221" strokeWidth="1.6" />
      <circle cx="12" cy="8" r="1.5" fill="#8C6221" />
      <path d="M8 13 L16 13 M8 16 L13 16" stroke="#2F5D4E" strokeWidth="1.6" strokeLinecap="round" />
    </g>
  ),
  case: (
    <g>
      <rect x="9" y="3" width="6" height="3" rx="1.2" fill="#2F5D4E" />
      <rect x="4" y="6" width="16" height="14" rx="2.5" fill="#2F5D4E" />
      <rect x="8" y="6" width="2" height="14" fill="#FAF6EC" opacity="0.5" />
      <rect x="14" y="6" width="2" height="14" fill="#FAF6EC" opacity="0.5" />
    </g>
  ),
  letter: (
    <g>
      <rect x="3" y="7" width="18" height="12" rx="2" fill="#FAF6EC" stroke="#2F5D4E" strokeWidth="1.6" />
      <path d="M3 8 L12 15 L21 8" fill="none" stroke="#2F5D4E" strokeWidth="1.6" strokeLinejoin="round" />
    </g>
  ),
  key: (
    <g>
      <circle cx="8" cy="12" r="5" fill="none" stroke="#8C6221" strokeWidth="2.2" />
      <path d="M13 12 H21 M18 12 V16 M21 12 V15" stroke="#8C6221" strokeWidth="2.2" strokeLinecap="round" />
    </g>
  ),
  magnifier: (
    <g>
      <circle cx="10" cy="10" r="6" fill="#E4EFEA" stroke="#2F5D4E" strokeWidth="2" />
      <path d="M14.5 14.5 L21 21" stroke="#2F5D4E" strokeWidth="2.4" strokeLinecap="round" />
    </g>
  ),
  lamp: (
    <g>
      <path d="M12 3 a6 6 0 0 1 4 10.5 V16 h-8 v-2.5 A6 6 0 0 1 12 3Z" fill="#F6EFDE" stroke="#8C6221" strokeWidth="1.6" />
      <rect x="9" y="17" width="6" height="4" rx="1.4" fill="#8C6221" />
    </g>
  ),
  seed: (
    <g>
      <ellipse cx="12" cy="15" rx="5" ry="6" fill="#8C6221" />
      <path d="M12 9 C12 5 15 3 18 3 C18 7 15 9 12 9Z" fill="#2F5D4E" />
    </g>
  ),
}
