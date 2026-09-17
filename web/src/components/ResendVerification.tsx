/**
 * "Resend the confirmation link", with its cooldown shown.
 *
 * The countdown is a courtesy, not a control: the API throttles per account,
 * so reloading the page or opening a new tab gains nothing. What this avoids
 * is someone clicking four times and wondering why only one email arrived.
 *
 * The deadline is kept in localStorage so a reload does not present a button
 * that looks ready when the server will decline. It is a bare timestamp — no
 * address, nothing identifying — and every access is guarded, because storage
 * throws in private windows and with site data blocked.
 */

import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from '../api/client'
import { useTurnstile } from '../lib/turnstile'

const STORAGE_KEY = 'dlt.verification_resend_after'

function readDeadline(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const value = raw ? Number.parseInt(raw, 10) : 0
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

function writeDeadline(at: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(at))
  } catch {
    // A missing cooldown only means the button looks ready sooner than it is;
    // the server still declines. Not worth surfacing.
  }
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function ResendVerification({ email }: { email: string }) {
  const [deadline, setDeadline] = useState<number>(() => readDeadline())
  const [now, setNow] = useState(() => Date.now())
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const turnstile = useTurnstile('resend_verification')

  const remaining = deadline - now

  useEffect(() => {
    if (remaining <= 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [remaining])

  const resend = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const body = await api.post<{ retry_after_seconds?: number }>(
        '/auth/verify-email/resend',
        { email },
        { turnstileToken: turnstile.token },
      )
      const wait = (body.retry_after_seconds ?? 600) * 1000
      const until = Date.now() + wait
      writeDeadline(until)
      setDeadline(until)
      setNow(Date.now())
      setSent(true)
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : 'Could not request a new link. Try again shortly.',
      )
    } finally {
      setBusy(false)
      turnstile.reset()
    }
  }, [email, turnstile])

  return (
    <div style={{ marginTop: 4 }}>
      {sent && (
        <p className="faint" style={{ marginBottom: 6 }}>
          A new link is on its way. It can take a minute to arrive — check your spam folder too.
        </p>
      )}
      {error && (
        <p className="field__error" style={{ marginBottom: 6 }}>
          {error}
        </p>
      )}

      {remaining > 0 ? (
        <p className="faint" style={{ margin: 0 }}>
          You can request another link in {formatRemaining(remaining)}.
        </p>
      ) : (
        <>
          {turnstile.widget}
          {turnstile.loadError && (
            <p className="field__error" style={{ marginBottom: 6 }}>
              {turnstile.loadError}
            </p>
          )}
        <button
          type="button"
          className="btn btn--quiet btn--sm"
          style={{ padding: 0 }}
          onClick={resend}
          disabled={busy || !email || !turnstile.ready}
        >
          {busy ? 'Sending…' : 'Resend the confirmation link'}
        </button>
        </>
      )}
    </div>
  )
}
