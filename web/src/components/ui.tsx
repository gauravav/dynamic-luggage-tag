/** Small shared building blocks. */

import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'

/**
 * Safe / lost status. Changing status cross-fades the label and, for "lost",
 * sends a ring rippling out of the dot a few times — the alarm going off.
 */
export function StatusPill({ status }: { status: 'safe' | 'lost' }) {
  return (
    <motion.span
      layout
      className={`pill pill--${status}`}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <span className="pill__dot-wrap">
        <span className="pill__dot" />
        {status === 'lost' && (
          <motion.span
            key="ring"
            className="pill__ring"
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 3.2, opacity: 0 }}
            transition={{ duration: 1.1, repeat: 3, ease: 'easeOut' }}
          />
        )}
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={status}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.15 }}
        >
          {status === 'lost' ? 'Reported lost' : 'Marked safe'}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  )
}

export function Notice({
  kind = 'error',
  children,
}: {
  kind?: 'error' | 'info' | 'warn'
  children: ReactNode
}) {
  return (
    <motion.div
      className={`notice notice--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={
        kind === 'error'
          ? // Errors give a small shake so they are noticed, not just shown.
            { opacity: 1, y: 0, scale: 1, x: [0, -6, 5, -3, 2, 0] }
          : { opacity: 1, y: 0, scale: 1 }
      }
      transition={{ type: 'spring', stiffness: 360, damping: 26, x: { duration: 0.4 } }}
    >
      {children}
    </motion.div>
  )
}

interface FieldProps {
  label: string
  name: string
  type?: string
  value: string
  onChange: (value: string) => void
  error?: string
  hint?: string
  autoComplete?: string
  required?: boolean
  placeholder?: string
  multiline?: boolean
  maxLength?: number
  disabled?: boolean
}

export function Field({
  label,
  name,
  type = 'text',
  value,
  onChange,
  error,
  hint,
  autoComplete,
  required,
  placeholder,
  multiline,
  maxLength,
  disabled,
}: FieldProps) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined
  return (
    <div className={`field${error ? ' field--invalid' : ''}`}>
      <label htmlFor={name}>{label}</label>
      {multiline ? (
        <textarea
          id={name}
          name={name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          required={required}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
        />
      ) : (
        <input
          id={name}
          name={name}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          required={required}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
        />
      )}
      {error ? (
        <span className="field__error" id={`${name}-error`}>
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint" id={`${name}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  danger,
  disabled,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
  danger?: boolean
  disabled?: boolean
}) {
  const id = `toggle-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div className="toggle-row">
      <label htmlFor={id} className="toggle-row__text">
        {label}
        {hint && (
          <>
            <br />
            <span className="toggle-row__hint">{hint}</span>
          </>
        )}
      </label>
      <input
        id={id}
        type="checkbox"
        className={`switch${danger ? ' switch--danger' : ''}`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="row" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="faint">{label}…</span>
    </span>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  )
}
