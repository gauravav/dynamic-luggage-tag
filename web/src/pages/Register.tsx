import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { MailSent } from '../components/illustrations'
import { LuggageMole, type MoleState } from '../components/LuggageMole'
import { BusyLabel, Reveal } from '../components/motion'
import { PasswordField } from '../components/PasswordStrength'
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

  const [focused, setFocused] = useState<'email' | 'name' | 'password' | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  // The same manners as the sign-in page: it reads what you are happy to have
  // read, and covers its eyes for the one thing you are not.
  const mole: MoleState =
    focused === 'password'
      ? showPassword
        ? 'peeking'
        : 'hiding'
      : focused
        ? 'watching'
        : 'idle'
  const gaze = Math.min(1, (focused === 'name' ? name : email).length / 26)

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
        <div style={{ marginBottom: 12 }}>
          <MailSent />
        </div>
        <Reveal delay={0.35}>
          <p className="kicker">check your inbox</p>
          <h1 style={{ fontSize: 28 }}>Confirm your email address</h1>
          <p className="muted">
            If that address can receive mail, a confirmation link is on its way. It is valid for 24
            hours.
          </p>
        </Reveal>
        <Reveal delay={0.5}>
          <Notice kind="info">
            Your account is not active until you follow that link. Nothing is published anywhere in
            the meantime.
          </Notice>
          <Link to="/login" className="btn btn--ghost">
            Back to sign in
          </Link>
        </Reveal>
      </div>
    )
  }

  return (
    <div className="page wrap wrap--narrow">
      <p className="kicker">create an account</p>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>One design, every bag.</h1>
      <p className="muted" style={{ marginBottom: 14 }}>
        Your name and contact details are encrypted before they are stored, and stay hidden until
        you mark a bag lost.
      </p>

      <LuggageMole state={mole} gaze={gaze} className="mole mole--signin" />
      <p className="faint center" style={{ marginBottom: 20 }} aria-hidden="true">
        {
          {
            idle: 'Ready when you are.',
            watching: 'Reading along…',
            hiding: 'Not looking.',
            peeking: 'Only because you asked.',
          }[mole]
        }
      </p>

      {message && <Notice>{message}</Notice>}

      <form onSubmit={handleSubmit} noValidate>
        <Field
          label="Email address"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          onFocus={() => setFocused('email')}
          onBlur={() => setFocused(null)}
          error={errors.email}
          autoComplete="email"
          required
        />
        <Field
          label="Name"
          name="name"
          value={name}
          onChange={setName}
          onFocus={() => setFocused('name')}
          onBlur={() => setFocused(null)}
          error={errors.name}
          hint="Shown to a finder only when you report a bag lost. You can add it later."
          autoComplete="name"
        />
        <PasswordField
          name="password"
          value={password}
          onChange={setPassword}
          onFocus={() => setFocused('password')}
          onBlur={() => setFocused(null)}
          onRevealChange={setShowPassword}
          error={errors.password}
          context={[email, name]}
          required
        />
        {turnstile.widget}
        {turnstile.loadError && <Notice>{turnstile.loadError}</Notice>}
        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={busy || !turnstile.ready}
        >
          <BusyLabel busy={busy} idle="Create account" working="Creating…" />
        </button>
      </form>

      <p className="faint" style={{ marginTop: 20 }}>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </div>
  )
}
