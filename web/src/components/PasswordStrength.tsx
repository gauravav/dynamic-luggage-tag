/**
 * Password field with an animated strength meter.
 *
 *   weak    a paperclip barely holding a sheet of paper, fluttering loose
 *   medium  a small padlock whose shackle drops shut
 *   strong  a vault door: bolts slide home and the wheel spins locked
 *
 * The grade comes from `lib/passwordStrength.ts`, whose policy check is a
 * tested port of the server's — so the illustration can never reach the lock,
 * let alone the vault, for a password the server will refuse.
 */

import { AnimatePresence, motion, type Transition } from 'motion/react'
import { useId, useState } from 'react'
import { strength, type Level } from '../lib/passwordStrength'

const COLORS: Record<Level, string> = {
  empty: '#C9BFA6',
  weak: '#9C3B2A',
  medium: '#8C6221',
  strong: '#1F4034',
}

const LABELS: Record<Level, string> = {
  empty: '',
  weak: 'Weak',
  medium: 'Medium',
  strong: 'Strong',
}

const settle: Transition = { type: 'spring', stiffness: 260, damping: 22 }

interface Props {
  label?: string
  name: string
  value: string
  onChange: (value: string) => void
  /** Email address and name: a password containing them is rejected. */
  context?: string[]
  /** A server-side error for this field, shown instead of the live hint. */
  error?: string
  autoComplete?: string
  required?: boolean
}

export function PasswordField({
  label = 'Password',
  name,
  value,
  onChange,
  context = [],
  error,
  autoComplete = 'new-password',
  required,
}: Props) {
  const [visible, setVisible] = useState(false)
  const result = strength(value, context.filter(Boolean))
  const hintId = useId()

  const hint =
    error ??
    result.problem ??
    {
      empty: 'At least 12 characters. A few unrelated words beats a short, clever one.',
      weak: '',
      medium: 'Good enough to use. A few more characters would make it much harder to guess.',
      strong: 'This is a password worth keeping.',
    }[result.level]

  return (
    <div className={`field password-field${error ? ' field--invalid' : ''}`}>
      <label htmlFor={name}>{label}</label>

      <div className="password-field__row">
        <div className="password-field__input">
          <input
            id={name}
            name={name}
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            autoComplete={autoComplete}
            aria-describedby={hintId}
            aria-invalid={error ? true : undefined}
            required={required}
          />
          <button
            type="button"
            className="password-field__toggle"
            onClick={() => setVisible((previous) => !previous)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
          >
            {visible ? 'Hide' : 'Show'}
          </button>
        </div>
        <StrengthIllustration level={result.level} />
      </div>

      <div className="strength-bar" aria-hidden="true">
        <motion.div
          className="strength-bar__fill"
          initial={false}
          animate={{ width: `${Math.round(result.score * 100)}%`, backgroundColor: COLORS[result.level] }}
          transition={{ type: 'spring', stiffness: 170, damping: 26 }}
        />
      </div>

      <div className="strength-meta">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={result.level}
            className="strength-meta__label"
            style={{ color: COLORS[result.level] }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
          >
            {LABELS[result.level]}
          </motion.span>
        </AnimatePresence>
        <span
          id={hintId}
          className={error || result.problem ? 'field__error' : 'field__hint'}
          // Polite: announced when the grade changes, without interrupting typing.
          aria-live="polite"
        >
          {hint}
        </span>
      </div>
    </div>
  )
}

/**
 * The three scenes share one SVG and cross-fade with a spring, so moving
 * between grades never cuts — the outgoing scene shrinks away as the incoming
 * one settles in, and each plays its own short "securing" motion on arrival.
 */
export function StrengthIllustration({ level }: { level: Level }) {
  const scene = level === 'strong' ? 'vault' : level === 'medium' ? 'lock' : 'clip'
  return (
    <div className="strength-art" role="img" aria-label={LABELS[level] ? `${LABELS[level]} password` : 'Password strength'}>
      <svg viewBox="0 0 120 100" width="100%" height="100%">
        <AnimatePresence initial={false}>
          <motion.g
            key={scene}
            style={{ transformBox: 'view-box', transformOrigin: '60px 55px' }}
            initial={{ opacity: 0, scale: 0.6, rotate: -10 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.7, rotate: 8 }}
            transition={settle}
          >
            {scene === 'clip' && <PaperclipScene muted={level === 'empty'} />}
            {scene === 'lock' && <LockScene />}
            {scene === 'vault' && <VaultScene />}
          </motion.g>
        </AnimatePresence>
      </svg>
    </div>
  )
}

function PaperclipScene({ muted }: { muted: boolean }) {
  const clip = muted ? COLORS.empty : COLORS.weak
  return (
    <motion.g
      style={{ transformBox: 'view-box', transformOrigin: '46px 20px' }}
      // A loosely held sheet: it keeps swinging, because nothing holds it firmly.
      animate={muted ? { rotate: 0 } : { rotate: [0, -7, 5, -4, 0] }}
      transition={muted ? { duration: 0.3 } : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
    >
      <rect x="30" y="24" width="56" height="68" rx="3" fill="#FFFFFF" stroke="#DCD0AF" strokeWidth="1.5" />
      <path d="M38 42 H78 M38 50 H74 M38 58 H78 M38 66 H66" stroke="#E6DCC3" strokeWidth="2.5" strokeLinecap="round" />
      <motion.path
        d="M42 38 V16 a6 6 0 0 1 12 0 V40 a4 4 0 0 1 -8 0 V22"
        fill="none"
        stroke={clip}
        strokeWidth="3.2"
        strokeLinecap="round"
        style={{ transformBox: 'view-box', transformOrigin: '48px 12px' }}
        animate={muted ? { rotate: 0 } : { rotate: [0, 6, -3, 0] }}
        transition={muted ? { duration: 0.3 } : { duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
      />
    </motion.g>
  )
}

function LockScene() {
  const color = COLORS.medium
  return (
    <g>
      {/* Shackle starts raised and drops shut with a small bounce: the click. */}
      <motion.path
        d="M46 50 V38 a14 14 0 0 1 28 0 V50"
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        initial={{ y: -10 }}
        animate={{ y: 0 }}
        transition={{ type: 'spring', stiffness: 520, damping: 14, delay: 0.12 }}
      />
      <rect x="36" y="48" width="48" height="38" rx="7" fill={color} />
      <circle cx="60" cy="63" r="4.5" fill="#FAF6EC" />
      <rect x="58" y="65" width="4" height="10" rx="2" fill="#FAF6EC" />
      <motion.circle
        cx="60"
        cy="67"
        r="30"
        fill="none"
        stroke={color}
        strokeWidth="2"
        initial={{ opacity: 0.5, scale: 0.6 }}
        animate={{ opacity: 0, scale: 1.15 }}
        transition={{ duration: 0.7, delay: 0.3, ease: 'easeOut' }}
        style={{ transformBox: 'view-box', transformOrigin: '60px 67px' }}
      />
    </g>
  )
}

function VaultScene() {
  const door = '#2F5D4E'
  const frame = COLORS.strong
  const bolts = [
    { x: 55, y: 14, w: 10, h: 8, from: { y: -8 } },
    { x: 55, y: 82, w: 10, h: 8, from: { y: 8 } },
    { x: 22, y: 47, w: 8, h: 10, from: { x: -8 } },
    { x: 90, y: 47, w: 8, h: 10, from: { x: 8 } },
  ]
  return (
    <g>
      <rect x="14" y="8" width="92" height="88" rx="10" fill={frame} />
      <rect x="10" y="26" width="6" height="12" rx="2" fill="#8C6221" />
      <rect x="10" y="66" width="6" height="12" rx="2" fill="#8C6221" />
      <circle cx="60" cy="52" r="32" fill={door} stroke="#E4EFEA" strokeWidth="2" />
      <circle cx="60" cy="52" r="25" fill="none" stroke="#E4EFEA" strokeOpacity="0.35" strokeWidth="1.5" />

      {/* Bolts slide home one after another. */}
      {bolts.map((bolt, index) => (
        <motion.rect
          key={index}
          x={bolt.x}
          y={bolt.y}
          width={bolt.w}
          height={bolt.h}
          rx="1.5"
          fill="#E4EFEA"
          initial={{ ...bolt.from, opacity: 0 }}
          animate={{ x: 0, y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 20, delay: 0.1 + index * 0.07 }}
        />
      ))}

      {/* Then the wheel spins the door locked. */}
      <motion.g
        style={{ transformBox: 'view-box', transformOrigin: '60px 52px' }}
        initial={{ rotate: -240 }}
        animate={{ rotate: 0 }}
        transition={{ type: 'spring', stiffness: 60, damping: 12, delay: 0.3 }}
      >
        {[0, 60, 120].map((angle) => (
          <g key={angle} transform={`rotate(${angle} 60 52)`}>
            <line x1="60" y1="36" x2="60" y2="68" stroke="#E4EFEA" strokeWidth="3.5" strokeLinecap="round" />
            <circle cx="60" cy="36" r="3" fill="#E4EFEA" />
            <circle cx="60" cy="68" r="3" fill="#E4EFEA" />
          </g>
        ))}
        <circle cx="60" cy="52" r="7" fill="#E4EFEA" />
        <circle cx="60" cy="52" r="3" fill={door} />
      </motion.g>

      <motion.circle
        cx="60"
        cy="52"
        r="34"
        fill="none"
        stroke="#9FD3BC"
        strokeWidth="3"
        style={{ transformBox: 'view-box', transformOrigin: '60px 52px' }}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: [0, 0.8, 0], scale: [0.9, 1.08, 1.18] }}
        transition={{ duration: 0.9, delay: 0.85, ease: 'easeOut' }}
      />
    </g>
  )
}
