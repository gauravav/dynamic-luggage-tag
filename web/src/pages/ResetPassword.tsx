import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { MailSent } from '../components/illustrations'
import { BusyLabel, Reveal } from '../components/motion'
import { PasswordField } from '../components/PasswordStrength'
import { Field, Notice } from '../components/ui'
import { useTurnstile } from '../lib/turnstile'

export function ResetRequest() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const turnstile = useTurnstile('password_reset')

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      await api.post('/auth/password/reset-request', { email }, { turnstileToken: turnstile.token })
      setSent(true)
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === 'verification_failed' || error.code === 'verification_unavailable')
      ) {
        // The request never reached the account lookup, so saying so reveals
        // nothing about the address — and claiming a link was sent would be
        // untrue.
        setMessage(error.message)
      } else {
        // Anything else is swallowed on purpose. The endpoint answers
        // identically for known and unknown addresses; surfacing an error here
        // would hand back exactly the signal that design removes.
        setSent(true)
      }
    } finally {
      setBusy(false)
      turnstile.reset()
    }
  }

  if (sent) {
    return (
      <div className="page wrap wrap--narrow">
        <div style={{ marginBottom: 12 }}>
          <MailSent />
        </div>
        <Reveal delay={0.35}>
          <p className="kicker">check your inbox</p>
          <h1 style={{ fontSize: 26 }}>If that address has an account&#8230;</h1>
          <p className="muted">
            &#8230;a reset link is on its way. It is valid for 30 minutes and can be used once.
          </p>
          <Link to="/login" className="btn btn--ghost">
            Back to sign in
          </Link>
        </Reveal>
      </div>
    )
  }

  return (
    <div className="page wrap wrap--narrow">
      <p className="kicker">reset your password</p>
      <h1 style={{ fontSize: 26, marginBottom: 18 }}>We will email you a link.</h1>
      <form onSubmit={handleSubmit} noValidate>
        <Field
          label="Email address"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        {message && <Notice>{message}</Notice>}
        {turnstile.widget}
        {turnstile.loadError && <Notice>{turnstile.loadError}</Notice>}
        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={busy || !turnstile.ready}
        >
          <BusyLabel busy={busy} idle="Send reset link" working="Sending…" />
        </button>
      </form>
    </div>
  )
}

export function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!token) return <ResetRequest />

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    setMessage(null)
    try {
      await api.post('/auth/password/reset', { token, new_password: password })
      navigate('/login', { replace: true })
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields)
        setMessage(error.message)
      } else {
        setMessage('Something went wrong.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page wrap wrap--narrow">
      <p className="kicker">choose a new password</p>
      <h1 style={{ fontSize: 26, marginBottom: 18 }}>Set a new password</h1>
      {message && <Notice>{message}</Notice>}
      <Notice kind="info">
        Every device signed in to this account will be signed out once you finish.
      </Notice>
      <form onSubmit={handleSubmit} noValidate>
        <PasswordField
          label="New password"
          name="new_password"
          value={password}
          onChange={setPassword}
          error={errors.new_password}
          required
        />
        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          <BusyLabel busy={busy} idle="Save new password" working="Saving…" />
        </button>
      </form>
    </div>
  )
}
