import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../api/client'
import { MailSent } from '../components/illustrations'
import { LuggageMole, type MoleState } from '../components/LuggageMole'
import { BusyLabel, Reveal } from '../components/motion'
import { PasswordField } from '../components/PasswordStrength'
import { Field, Notice } from '../components/ui'
import { useTurnstile } from '../lib/turnstile'

export function Register() {
  const [params] = useSearchParams()
  // An invitation from a tag that has already been printed and posted.
  const invite = params.get('invite')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const turnstile = useTurnstile('register')

  // Whether the two fields the invitation settles are still ours to fill in.
  // They are locked once it resolves, and freed again if it does not: a link
  // that has expired should leave someone able to sign up, not stranded.
  const [invited, setInvited] = useState<boolean>(false)
  const [checking, setChecking] = useState<boolean>(Boolean(invite))

  useEffect(() => {
    if (!invite) return
    let cancelled = false
    void api
      .get<{ invitation: { email: string; name: string | null } }>(`/auth/invite/${invite}`)
      .then(({ invitation }) => {
        if (cancelled) return
        setEmail(invitation.email)
        setName(invitation.name ?? '')
        setInvited(true)
      })
      .catch(() => {
        if (cancelled) return
        setMessage(
          'That invitation link is no longer valid. You can still create your account here — ' +
            'use the address the tag was ordered for and it will be waiting inside.',
        )
      })
      .finally(() => {
        if (!cancelled) setChecking(false)
      })
    return () => {
      cancelled = true
    }
  }, [invite])

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
        {
          email,
          password,
          name: name || null,
          // Present only when it resolved. The server reads the address and
          // the name off the invitation and ignores the two sent here, which
          // is what makes them unchangeable rather than merely uneditable.
          ...(invited && invite ? { invite_token: invite } : {}),
        },
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
      <p className="kicker">{invited ? 'your tag is on its way' : 'create an account'}</p>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>
        {invited ? 'Set up your tag.' : 'One design, every bag.'}
      </h1>
      <p className="muted" style={{ marginBottom: 14 }}>
        {invited
          ? 'Your tag is already printed, so the address and the name on it are set. Choose a password and it will be waiting in your account.'
          : 'Your name and contact details are encrypted before they are stored, and stay hidden until you mark a bag lost.'}
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
          disabled={invited || checking}
          hint={invited ? 'The address your tag was ordered for.' : undefined}
        />
        <Field
          label="Name"
          name="name"
          value={name}
          onChange={setName}
          onFocus={() => setFocused('name')}
          onBlur={() => setFocused(null)}
          error={errors.name}
          hint={
            invited
              ? 'The name printed on your tag. It is shown to a finder only when you report a bag lost.'
              : 'Shown to a finder only when you report a bag lost. You can add it later.'
          }
          autoComplete="name"
          disabled={invited || checking}
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
          disabled={busy || checking || !turnstile.ready}
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
