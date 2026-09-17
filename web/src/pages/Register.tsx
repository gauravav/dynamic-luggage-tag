import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { Field, Notice } from '../components/ui'
import { useTurnstile } from '../lib/turnstile'

export function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const turnstile = useTurnstile('register')

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setErrors({})
    setMessage(null)
    try {
      await api.post(
        '/auth/register',
        { email, password, name: name || null },
        { turnstileToken: turnstile.token },
      )
      // The same screen appears whether or not the address was already
      // registered — the API answers identically by design, so the UI must not
      // invent a distinction the server deliberately refuses to make.
      setDone(true)
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fields)
        setMessage(error.message)
      } else {
        setMessage('Something went wrong. Please try again.')
      }
    } finally {
      setBusy(false)
      // Tokens are single-use; a retry needs a fresh check.
      turnstile.reset()
    }
  }

  if (done) {
    return (
      <div className="page wrap wrap--narrow">
        <p className="kicker">check your inbox</p>
        <h1 style={{ fontSize: 28 }}>Confirm your email address</h1>
        <p className="muted">
          If that address can receive mail, a confirmation link is on its way. It is valid for 24
          hours.
        </p>
        <Notice kind="info">
          Your account is not active until you follow that link. Nothing is published anywhere in
          the meantime.
        </Notice>
        <Link to="/login" className="btn btn--ghost">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="page wrap wrap--narrow">
      <p className="kicker">create an account</p>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>One design, every bag.</h1>
      <p className="muted" style={{ marginBottom: 24 }}>
        Your name and contact details are encrypted before they are stored, and stay hidden until
        you mark a bag lost.
      </p>

      {message && <Notice>{message}</Notice>}

      <form onSubmit={handleSubmit} noValidate>
        <Field
          label="Email address"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          error={errors.email}
          autoComplete="email"
          required
        />
        <Field
          label="Name"
          name="name"
          value={name}
          onChange={setName}
          error={errors.name}
          hint="Shown to a finder only when you report a bag lost. You can add it later."
          autoComplete="name"
        />
        <Field
          label="Password"
          name="password"
          type="password"
          value={password}
          onChange={setPassword}
          error={errors.password}
          hint="At least 12 characters. A few unrelated words beats a short, clever one."
          autoComplete="new-password"
          required
        />
        {turnstile.widget}
        {turnstile.loadError && <Notice>{turnstile.loadError}</Notice>}
        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={busy || !turnstile.ready}
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <p className="faint" style={{ marginTop: 20 }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  )
}
