import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { ResendVerification } from '../components/ResendVerification'
import { AnimatePresence, motion } from 'motion/react'
import { CodeInput } from '../components/CodeInput'
import { CodeJourney, JOURNEY_MS, type JourneyPhase } from '../components/CodeJourney'
import { LuggageMole, type MoleState } from '../components/LuggageMole'
import { BusyLabel } from '../components/motion'
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
  // Issued by the password step so the code step is not asked to prove it is
  // human all over again.
  const [loginTicket, setLoginTicket] = useState<string | null>(null)
  const [journey, setJourney] = useState<JourneyPhase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [focused, setFocused] = useState<'email' | 'password' | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  // What the mole does about all this. Reading the address is the only thing
  // it is allowed to watch; a password it covers its eyes for, unless you have
  // said out loud that you want it shown.
  const mole: MoleState =
    focused === 'password'
      ? showPassword
        ? 'peeking'
        : 'hiding'
      : focused === 'email'
        ? 'watching'
        : 'idle'
  // Roughly how far along the address it has read. Character count rather than
  // the caret, so it still tracks when the field is filled by a password
  // manager rather than typed.
  const gaze = Math.min(1, email.length / 26)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    void attempt()
  }

  /**
   * One sign-in attempt.
   *
   * `code` is passed explicitly by the six-box input, which knows the finished
   * code a render before state does. Reading it from state here instead would
   * submit the previous value — five digits, or none at all on the first try.
   */
  async function attempt(code?: string) {
    if (busy) return
    const submittedCode = code ?? totpCode
    setBusy(true)
    setMessage(null)
    setErrorCode(null)

    // The cases only fly when there is a code to send them off with.
    const sendingCode = needsSecondFactor && !useRecovery && Boolean(submittedCode)
    if (sendingCode) setJourney('flying')

    try {
      const result = await signIn(
        email,
        password,
        {
          ...(submittedCode ? { totpCode: submittedCode } : {}),
          ...(recoveryCode ? { recoveryCode } : {}),
        },
        turnstile.token,
        loginTicket,
      )
      if (result.status === 'totp_required') {
        setNeedsSecondFactor(true)
        setLoginTicket(result.loginTicket)
        return
      }
      if (sendingCode) {
        // Let the bags come off the plane before the page changes under them.
        setJourney('collected')
        await new Promise((resolve) => setTimeout(resolve, JOURNEY_MS))
      }
      navigate(from, { replace: true })
    } catch (error) {
      if (sendingCode) setJourney('taken')
      setMessage(error instanceof ApiError ? error.message : 'Something went wrong.')
      setErrorCode(error instanceof ApiError ? error.code : null)
      // Clear only the codes: making someone retype a long password because a
      // six-digit code was mistyped is its own small hostility.
      setTotpCode('')
      setRecoveryCode('')
      // A spent ticket cannot be reused, so the next attempt falls back to the
      // ordinary check rather than silently failing on a stale one.
      setLoginTicket(null)
    } finally {
      setBusy(false)
      // Tokens are single-use. The password step spends one; the code step
      // rides on the ticket instead.
      turnstile.reset()
    }
  }

  return (
    <div className="page wrap wrap--narrow">
      <p className="kicker">sign in</p>
      <h1 style={{ fontSize: 28, marginBottom: 14 }}>Welcome back.</h1>

      <LuggageMole state={mole} gaze={gaze} className="mole mole--signin" />
      <p className="faint center" style={{ marginBottom: 20 }} aria-hidden="true">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={mole}
            style={{ display: 'inline-block' }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
          >
            {
              {
                idle: 'Ready when you are.',
                watching: 'Reading along…',
                hiding: 'Not looking.',
                peeking: 'Only because you asked.',
              }[mole]
            }
          </motion.span>
        </AnimatePresence>
      </p>

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
          onFocus={() => setFocused('email')}
          onBlur={() => setFocused(null)}
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
          onFocus={() => setFocused('password')}
          onBlur={() => setFocused(null)}
          revealed={showPassword}
          onRevealToggle={() => setShowPassword((previous) => !previous)}
          autoComplete="current-password"
          required
          disabled={needsSecondFactor}
        />

        <AnimatePresence initial={false}>
        {needsSecondFactor && (
          // The code step unfolds beneath the password rather than appearing
          // with a jump, so it reads as the next step of the same sign-in.
          <motion.div
            key="second-factor"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            style={{ overflow: 'hidden' }}
          >
            <Notice kind="info">
              Enter the six-digit code from your authenticator app.
            </Notice>
            <CodeJourney phase={journey} />
            <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={useRecovery ? 'recovery' : 'totp'}
              initial={{ opacity: 0, x: useRecovery ? 24 : -24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: useRecovery ? -24 : 24 }}
              transition={{ duration: 0.18 }}
            >
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
              <CodeInput
                label="Authentication code"
                value={totpCode}
                onChange={setTotpCode}
                onComplete={(value) => void attempt(value)}
                disabled={busy}
                autoFocus
                error={errorCode === 'invalid_code'}
              />
            )}
            </motion.div>
            </AnimatePresence>
            <button
              type="button"
              className="btn btn--quiet btn--sm"
              onClick={() => setUseRecovery((previous) => !previous)}
            >
              {useRecovery ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
            </button>
          </motion.div>
        )}
        </AnimatePresence>

        {turnstile.widget}
        {turnstile.loadError && <Notice>{turnstile.loadError}</Notice>}
        <button
          type="submit"
          className="btn btn--primary btn--block"
          disabled={busy || !turnstile.ready}
          style={{ marginTop: 12 }}
        >
          <BusyLabel busy={busy} idle="Sign in" working="Signing in…" />
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
