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
 *  - It can be sent away for good, and remembers. A mascot with no off switch
 *    is a mascot people resent.
 *
 * What it says lives in `lib/moleScript.ts`, keyed by route, so a page can
 * never forget to describe itself.
 */

import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LuggageMole, type MoleState } from './LuggageMole'
import { scriptFor, type MoleLine } from '../lib/moleScript'

/** How long a line stays up on its own before the mole drops back down. */
const READ_MS = 7000
/** Quiet time before it offers the next tip. */
const IDLE_MS = 24_000
const DISMISSED_KEY = 'dlt.mole.dismissed'

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    // Private windows and blocked storage both throw. The mole shows up.
    return false
  }
}

export function MoleCompanion({ signedIn }: { signedIn: boolean }) {
  const { pathname } = useLocation()
  const script = scriptFor(pathname, signedIn)

  const [dismissed, setDismissed] = useState(wasDismissed)
  const [line, setLine] = useState<MoleLine | null>(null)
  const [nextTip, setNextTip] = useState(0)
  const [nudged, setNudged] = useState(false)
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

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  if (!script || dismissed) return null

  /** Tapping asks for the next thing it has, and wraps round when asked again. */
  function poke() {
    if (!script) return
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
    setDismissed(true)
    setLine(null)
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1')
    } catch {
      // Then it comes back next time. Better than failing to close now.
    }
  }

  // Up when it is talking, peeking otherwise.
  const pose: MoleState = line ? 'watching' : 'idle'

  return (
    <div className={`mole-companion${signedIn ? ' mole-companion--app' : ''}`}>
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
              title="Hide the mole on every page"
            >
              Don’t show me again
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
        // Peeking over the edge, and rising when it has something to say.
        animate={{ y: line ? '6%' : '44%', rotate: nudged ? [0, -5, 4, 0] : 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24, rotate: { duration: 0.6 } }}
        whileTap={{ scale: 0.94 }}
      >
        <LuggageMole state={pose} gaze={line ? 0.65 : 0.5} className="mole" />
      </motion.button>
    </div>
  )
}
