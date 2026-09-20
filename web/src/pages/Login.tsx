import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { ResendVerification } from '../components/ResendVerification'
import { AnimatePresence, motion } from 'motion/react'
import { CodeInput } from '../components/CodeInput'
import {
  CHECKIN_MS,
  CodeCheckIn,
  REJECT_MS,
  type CheckInPhase,
} from '../components/CodeCheckIn'
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
  const [checkIn, setCheckIn] = useState<CheckInPhase>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [focused, setFocused] = useState<'email' | 'password' | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  // A refused case is shown for a moment and then taken away, so the six
  // cases can come back apart for another try.
  useEffect(() => {
    if (checkIn !== 'rejected') return
    const timer = window.setTimeout(() => setCheckIn('idle'), REJECT_MS)
    return () => window.clearTimeout(timer)
  }, [checkIn])

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
  const moleLine = needsSecondFactor
    ? 'Just the code now.'
    : { idle: 'Ready when you are.', watching: 'Reading along…', hiding: 'Not looking.', peeking: 'Only because you asked.' }[mole]

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    void attempt()
  }

  /** Back to the password step, with nothing half-entered left behind. */
  function backToPassword() {
    setNeedsSecondFactor(false)
    setUseRecovery(false)
    setTotpCode('')
    setRecoveryCode('')
    // A ticket belongs to the attempt that asked for a code. Going back starts
    // a new attempt, which will be issued its own.
    setLoginTicket(null)
    setMessage(null)
    setErrorCode(null)
    setCheckIn('idle')
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

    // The cases only close up when there is a code to send.
    const sendingCode = needsSecondFactor && !useRecovery && Boolean(submittedCode)
    if (sendingCode) setCheckIn('merging')

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
        // The fields it was watching are gone; a blur is not guaranteed once
        // they unmount, so the mole is told to stand down here.
        setFocused(null)
        return
      }
      if (sendingCode) {
        // Let the tag go on before the page changes under it.
        setCheckIn('tagged')
        await new Promise((resolve) => setTimeout(resolve, CHECKIN_MS))
      }
      navigate(from, { replace: true })
    } catch (error) {
      if (sendingCode) setCheckIn('rejected')
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
      <p className="kicker">{needsSecondFactor ? 'two-factor' : 'sign in'}</p>
      <AnimatePresence mode="wait" initial={false}>
        <motion.h1
          key={needsSecondFactor ? 'code' : 'password'}
          style={{ fontSize: 28, marginBottom: 14 }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {needsSecondFactor ? 'One more thing.' : 'Welcome back.'}
        </motion.h1>
      </AnimatePresence>

      <LuggageMole state={mole} gaze={gaze} className="mole mole--signin" />
      <p className="faint center" style={{ marginBottom: 20 }} aria-hidden="true">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={moleLine}
            style={{ display: 'inline-block' }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
          >
            {moleLine}
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
        {/* One step at a time. The password step hands over to the code step
            and gets out of the way: two fields and a code box on screen at
            once read as one long form, not as two things asked in turn. */}
        <AnimatePresence mode="wait" initial={false}>
          {needsSecondFactor ? (
            <motion.div
              key="second-factor"
              initial={{ opacity: 0, x: 26 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -26 }}
              transition={{ duration: 0.2 }}
            >
              <button type="button" className="btn btn--quiet btn--sm" onClick={backToPassword}>
                ← Back
              </button>
              <Notice kind="info">
                {useRecovery
                  ? 'Enter one of your recovery codes.'
                  : 'Enter the six-digit code from your authenticator app.'}
                {email && <span className="faint"> Signing in as {email}.</span>}
              </Notice>

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
                    // The six cases and what becomes of them share one space,
                    // so the big case grows from where the small ones piled up.
                    <div className="checkin">
                      <CodeInput
                        label="Authentication code"
                        value={totpCode}
                        onChange={setTotpCode}
                        onComplete={(value) => void attempt(value)}
                        disabled={busy}
                        autoFocus
                        error={errorCode === 'invalid_code'}
                        merging={checkIn !== 'idle'}
                      />
                      <CodeCheckIn phase={checkIn} />
                    </div>
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
          ) : (
            <motion.div
              key="credentials"
              initial={{ opacity: 0, x: -26 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 26 }}
              transition={{ duration: 0.2 }}
            >
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
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Kept mounted through the code step, hidden rather than unmounted:
            the widget cannot be re-rendered into a container that comes back,
            and going back to the password step needs it there and working. */}
        <div style={needsSecondFactor ? { display: 'none' } : undefined}>
          {turnstile.widget}
        </div>
        {!needsSecondFactor && turnstile.loadError && <Notice>{turnstile.loadError}</Notice>}
        <button
          type="submit"
          className="btn btn--primary btn--block"
          // The code step carries a ticket from the password step, so it does
          // not wait on a fresh token.
          disabled={busy || (!needsSecondFactor && !turnstile.ready)}
          style={{ marginTop: 12 }}
        >
          <BusyLabel busy={busy} idle="Sign in" working="Signing in…" />
        </button>
      </form>

      {!needsSecondFactor && (
        <div className="row row--between" style={{ marginTop: 20 }}>
          <Link className="faint" to="/forgot">
            Forgot your password?
          </Link>
          <Link className="faint" to="/register">
            Create an account
          </Link>
        </div>
      )}
    </div>
  )
}
