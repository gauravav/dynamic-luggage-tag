/**
 * A six-digit authentication code, as six little suitcases.
 *
 * One box per digit rather than one field for all six, because that is how
 * the code is read off a phone — in digits, not as a number — and because six
 * cases are what the check-in animation packs into one.
 *
 * The fiddly parts of a segmented input, all handled: typing moves forward,
 * backspace on an empty box moves back and clears the one before it, arrow
 * keys work, and pasting the whole code into any box fills all six. A phone
 * gets a numeric keypad, and the browser's own one-time-code autofill lands
 * correctly because every box carries the autocomplete hint.
 *
 * To a screen reader it is one labelled group of six numeric inputs, each
 * announcing its position.
 */

import { motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const LENGTH = 6

interface Props {
  value: string
  onChange: (value: string) => void
  /** Fired when the sixth digit lands, so the form can submit itself. */
  onComplete?: (value: string) => void
  label: string
  disabled?: boolean
  autoFocus?: boolean
  error?: boolean
  /** Closes the six cases into a single pile at the centre. */
  merging?: boolean
}

export function CodeInput({
  value,
  onChange,
  onComplete,
  label,
  disabled,
  autoFocus,
  error,
  merging,
}: Props) {
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const cases = useRef<(HTMLLabelElement | null)[]>([])
  const row = useRef<HTMLDivElement | null>(null)
  const digits = value.padEnd(LENGTH).slice(0, LENGTH).split('')

  // How far each case has to travel to reach the middle. Measured rather than
  // worked out from the CSS: the box and the gap both change with the
  // viewport, and a number guessed here would leave cases short of the pile.
  const [pull, setPull] = useState<number[] | null>(null)
  useLayoutEffect(() => {
    if (!merging) {
      setPull(null)
      return
    }
    const bounds = row.current?.getBoundingClientRect()
    if (!bounds) return
    const middle = bounds.left + bounds.width / 2
    setPull(
      cases.current.map((node) => {
        if (!node) return 0
        const box = node.getBoundingClientRect()
        return middle - (box.left + box.width / 2)
      }),
    )
  }, [merging])

  useEffect(() => {
    if (autoFocus) boxes.current[0]?.focus()
  }, [autoFocus])

  function put(index: number, raw: string) {
    const typed = raw.replace(/\D/g, '')
    if (!typed) return

    // A paste, or a fast typist, fills from here onward rather than dropping
    // everything but the first character.
    const next = value.padEnd(LENGTH).split('')
    for (let offset = 0; offset < typed.length && index + offset < LENGTH; offset++) {
      next[index + offset] = typed[offset]!
    }
    const joined = next.join('').trimEnd()
    onChange(joined)

    const landed = Math.min(index + typed.length, LENGTH - 1)
    boxes.current[landed]?.focus()
    if (joined.replace(/\s/g, '').length === LENGTH) onComplete?.(joined)
  }

  function onKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace') {
      event.preventDefault()
      const next = value.padEnd(LENGTH).split('')
      if (next[index]?.trim()) {
        next[index] = ' '
      } else if (index > 0) {
        next[index - 1] = ' '
        boxes.current[index - 1]?.focus()
      }
      onChange(next.join('').trimEnd())
    } else if (event.key === 'ArrowLeft' && index > 0) {
      boxes.current[index - 1]?.focus()
    } else if (event.key === 'ArrowRight' && index < LENGTH - 1) {
      boxes.current[index + 1]?.focus()
    }
  }

  return (
    <div
      ref={row}
      className={`code-input${error ? ' code-input--error' : ''}`}
      role="group"
      aria-label={label}
    >
      {digits.map((digit, index) => (
        <motion.label
          key={index}
          ref={(node) => {
            cases.current[index] = node
          }}
          className={`case${digit.trim() ? ' case--packed' : ''}`}
          // Each one settles as its digit lands, like a case being set down —
          // until the code goes off, and they all close into one pile.
          animate={
            merging && pull
              ? { x: pull[index] ?? 0, y: 0, rotate: 0, scale: 0.34, opacity: 0 }
              : digit.trim()
                ? { x: 0, y: [-6, 0], rotate: [-3, 0], scale: 1, opacity: 1 }
                : { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }
          }
          transition={
            merging
              ? { duration: 0.4, ease: [0.4, 0, 0.2, 1] }
              : { type: 'spring', stiffness: 520, damping: 18 }
          }
        >
          <span className="case__handle" aria-hidden="true" />
          <span className="case__body" aria-hidden="true">
            <span className="case__strap" />
            <span className="case__strap" />
          </span>
          <input
            ref={(node) => {
              boxes.current[index] = node
            }}
            value={digit.trim()}
            onChange={(event) => put(index, event.target.value)}
            onKeyDown={(event) => onKeyDown(index, event)}
            onFocus={(event) => event.target.select()}
            inputMode="numeric"
            // One-time-code autofill needs the hint on the field the browser
            // is filling, which with a segmented input is all of them.
            autoComplete="one-time-code"
            maxLength={LENGTH}
            disabled={disabled}
            aria-label={`Digit ${index + 1} of ${LENGTH}`}
          />
        </motion.label>
      ))}
    </div>
  )
}
