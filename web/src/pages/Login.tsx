import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { ResendVerification } from '../components/ResendVerification'
import { Field, Notice } from '../components/ui'
import { useTurnstile } from '../lib/turnstile'
import { useSession } from '../state/session'

export function Login() {
  const { signIn } = useSession()
  const turnstile = useTurnstile('login')
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/app'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [needsSecondFactor, setNeedsSecondFactor] = useState(false)
  const [useRecovery, setUseRecovery] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    setErrorCode(null)
    try {
      const result = await signIn(
        email,
        password,
        {
          ...(totpCode ? { totpCode } : {}),
          ...(recoveryCode ? { recoveryCode } : {}),
        },
        turnstile.token,
      )
      if (result.status === 'totp_required') {
        setNeedsSecondFactor(true)
        return
      }
      navigate(from, { replace: true })
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Something went wrong.')
      setErrorCode(error instanceof ApiError ? error.code : null)
      // Clear only the codes: making someone retype a long password because a
      // six-digit code was mistyped is its own small hostility.
      setTotpCode('')
      setRecoveryCode('')
    } finally {
      setBusy(false)
      // Every attempt spends the token, including the password step before a
      // two-factor prompt, so the code step gets a fresh check.
      turnstile.reset()
    }
  }

  return (
    <div className="page wrap wrap--narrow">
      <p className="kicker">sign in</p>
      <h1 style={{ fontSize: 28, marginBottom: 20 }}>Welcome back.</h1>

      {message && (
        <Notice>
          {message}
          {/* An unconfirmed account cannot sign in and has no other way to ask
              for a new link, so the way out belongs right here. */}
          {errorCode === 'email_unverified' && <ResendVerification email={email} />}
        </Notice>
      )}

      <form onSubmit={handleSubmit} noValidate>
        <Field
          label="Email address"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
          disabled={needsSecondFactor}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
          disabled={needsSecondFactor}
        />

        {needsSecondFactor && (
          <>
            <Notice kind="info">
              Enter the six-digit code from your authenticator app.
            </Notice>
            {useRecovery ? (
              <Field
                label="Recovery code"
                name="recovery_code"
                value={recoveryCode}
                onChange={setRecoveryCode}
                hint="One of the codes you saved when you turned on two-factor. Each works once."
                autoComplete="one-time-code"
              />
            ) : (
              <Field
                label="Authentication code"
                name="totp_code"
                value={totpCode}
                onChange={setTotpCode}
                autoComplete="one-time-code"
                placeholder="123456"
                maxLength={8}
              />
            )}
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => setUseRecovery((previous) => !previous)}
            >
              {useRecovery ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
            </button>
          </>
        )}

        {turnstile.widget}
        {turnstile.loadError && <Notice>{turnstile.loadError}</Notice>}
        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={busy || !turnstile.ready}
          style={{ marginTop: 12 }}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="row row--between" style={{ marginTop: 20 }}>
        <Link className="faint" to="/forgot">
          Forgot your password?
        </Link>
        <Link className="faint" to="/register">
          Create an account
        </Link>
      </div>
    </div>
  )
}
