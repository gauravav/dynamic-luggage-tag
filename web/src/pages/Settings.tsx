import { useCallback, useEffect, useState } from 'react'
import { API_BASE, ApiError, api, type AccountDetail, type SessionRecord } from '../api/client'
import { Field, Notice, Spinner, Toggle } from '../components/ui'
import { formatDateTime } from '../lib/design'
import { useSession } from '../state/session'

export function Settings() {
  const { refresh, signOut } = useSession()
  const [account, setAccount] = useState<AccountDetail | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', address: '' })
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const body = await api.get<{ account: AccountDetail }>('/account')
      setAccount(body.account)
      setForm({
        name: body.account.name ?? '',
        phone: body.account.phone ?? '',
        address: body.account.address ?? '',
      })
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load your account.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    setFieldErrors({})
    try {
      await api.patch('/account', {
        name: form.name || null,
        phone: form.phone || null,
        address: form.address || null,
      })
      await Promise.all([load(), refresh()])
      setInfo('Saved.')
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFieldErrors(cause.fields)
        setError(cause.message)
      } else {
        setError('Could not save your details.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!account) {
    return (
      <div className="page wrap">
        {error ? <Notice>{error}</Notice> : <Spinner label="Loading account" />}
      </div>
    )
  }

  return (
    <div className="page wrap wrap--mid">
      <div className="page__head">
        <p className="kicker">settings</p>
        <h1>Your account</h1>
      </div>

      {error && <Notice>{error}</Notice>}
      {info && <Notice kind="info">{info}</Notice>}

      <div className="stack" style={{ gap: 24 }}>
        <section className="card">
          <h3 style={{ marginBottom: 6 }}>Your details</h3>
          <p className="faint" style={{ marginBottom: 18 }}>
            Encrypted with a key that belongs to this account alone. Only your name can ever appear
            on a scan page, and only when you mark a bag lost.
          </p>
          <form onSubmit={saveProfile} noValidate>
            <Field
              label="Email address"
              name="email"
              value={account.email ?? ''}
              onChange={() => undefined}
              disabled
              hint={
                account.email_verified
                  ? 'Confirmed.'
                  : 'Not confirmed yet — check your inbox for the link.'
              }
            />
            <Field
              label="Name"
              name="name"
              value={form.name}
              onChange={(value) => setForm((f) => ({ ...f, name: value }))}
              error={fieldErrors.name}
              hint="Shown to a finder only when a bag is marked lost."
            />
            <Field
              label="Phone"
              name="phone"
              value={form.phone}
              onChange={(value) => setForm((f) => ({ ...f, phone: value }))}
              error={fieldErrors.phone}
              hint="Never shown to anyone. Kept so a future SMS relay can reach you."
            />
            <Field
              label="Address"
              name="address"
              value={form.address}
              onChange={(value) => setForm((f) => ({ ...f, address: value }))}
              error={fieldErrors.address}
              hint="Only used for shipping physical tags. Never shown on a scan page, at any setting."
              multiline
            />
            <button type="submit" className="btn btn--primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save details'}
            </button>
          </form>
        </section>

        <NotificationSection account={account} onChanged={load} />
        <TwoFactorSection account={account} onChanged={load} />
        <SessionsSection />
        <PasswordSection />
        <DataSection onDeleted={signOut} />
      </div>
    </div>
  )
}

function NotificationSection({
  account,
  onChanged,
}: {
  account: AccountDetail
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <section className="card">
      <h3 style={{ marginBottom: 14 }}>Notifications</h3>
      <Toggle
        label="Email me when a tag is scanned"
        hint="Rate limited, so a bag drawing a few looks on a carousel is one email, not ten."
        checked={account.notify_on_scan}
        disabled={busy}
        onChange={async (next) => {
          setBusy(true)
          try {
            await api.patch('/account', { notify_on_scan: next })
            await onChanged()
          } finally {
            setBusy(false)
          }
        }}
      />
    </section>
  )
}

function TwoFactorSection({
  account,
  onChanged,
}: {
  account: AccountDetail
  onChanged: () => Promise<void>
}) {
  const [secret, setSecret] = useState<string | null>(null)
  const [uri, setUri] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function startSetup() {
    setBusy(true)
    setError(null)
    try {
      const body = await api.post<{ secret: string; otpauth_uri: string }>('/auth/totp/setup')
      setSecret(body.secret)
      setUri(body.otpauth_uri)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not start setup.')
    } finally {
      setBusy(false)
    }
  }

  async function enable(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = await api.post<{ recovery_codes: string[] }>('/auth/totp/enable', { code })
      setCodes(body.recovery_codes)
      setSecret(null)
      setUri(null)
      setCode('')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That code is not valid.')
    } finally {
      setBusy(false)
    }
  }

  async function disable(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/auth/totp/disable', { password })
      setPassword('')
      await onChanged()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not turn it off.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h3 style={{ marginBottom: 6 }}>Two-factor authentication</h3>
      <p className="faint" style={{ marginBottom: 16 }}>
        {account.totp_enabled
          ? 'On. A code from your authenticator is required to sign in.'
          : 'Off. Your password alone is enough to sign in.'}
      </p>

      {error && <Notice>{error}</Notice>}

      {codes && (
        <Notice kind="warn">
          <strong>Save these recovery codes now.</strong> Each works once, and this is the only time
          they are shown.
          <p className="code-block" style={{ marginTop: 10 }}>
            {codes.join('\n')}
          </p>
        </Notice>
      )}

      {account.totp_enabled ? (
        <form onSubmit={disable}>
          <Field
            label="Confirm your password to turn it off"
            name="totp_password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          <button type="submit" className="btn btn--ghost btn--sm" disabled={busy || !password}>
            Turn off two-factor
          </button>
        </form>
      ) : secret ? (
        <form onSubmit={enable}>
          <p className="faint">
            Add this secret to your authenticator app, then enter the code it shows.
          </p>
          <p className="code-block">{secret}</p>
          {uri && (
            <p className="faint" style={{ overflowWrap: 'anywhere' }}>
              Or use this setup link: {uri}
            </p>
          )}
          <Field
            label="Code from your app"
            name="totp_code"
            value={code}
            onChange={setCode}
            placeholder="123456"
            maxLength={8}
            autoComplete="one-time-code"
          />
          <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !code}>
            Turn on two-factor
          </button>
        </form>
      ) : (
        <button type="button" className="btn btn--ghost btn--sm" onClick={startSetup} disabled={busy}>
          Set up two-factor
        </button>
      )}
    </section>
  )
}

function SessionsSection() {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const body = await api.get<{ sessions: SessionRecord[] }>('/auth/sessions')
      setSessions(body.sessions)
    } catch {
      setSessions([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="card">
      <h3 style={{ marginBottom: 6 }}>Signed-in devices</h3>
      <p className="faint" style={{ marginBottom: 14 }}>
        Recorded as a device family and a hashed network, never a full user agent or an IP address.
      </p>
      {sessions === null ? (
        <Spinner />
      ) : (
        <ul className="list">
          {sessions.map((session) => (
            <li key={session.id} className="list__item">
              <span>
                {session.client}
                {session.current && <span className="faint"> · this device</span>}
              </span>
              <span className="faint">last active {formatDateTime(session.last_seen_at)}</span>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        style={{ marginTop: 14 }}
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await api.post('/auth/sessions/revoke-others')
            await load()
          } finally {
            setBusy(false)
          }
        }}
      >
        Sign out everywhere else
      </button>
    </section>
  )
}

function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const body = await api.post<{ sessions_revoked: number }>('/auth/password', {
        current_password: current,
        new_password: next,
      })
      setCurrent('')
      setNext('')
      setInfo(
        body.sessions_revoked > 0
          ? `Password changed. ${body.sessions_revoked} other device(s) were signed out.`
          : 'Password changed.',
      )
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not change your password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h3 style={{ marginBottom: 14 }}>Password</h3>
      {error && <Notice>{error}</Notice>}
      {info && <Notice kind="info">{info}</Notice>}
      <form onSubmit={submit}>
        <Field
          label="Current password"
          name="current_password"
          type="password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
        />
        <Field
          label="New password"
          name="new_password"
          type="password"
          value={next}
          onChange={setNext}
          hint="At least 12 characters. Changing it signs out every other device."
          autoComplete="new-password"
        />
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !current || !next}>
          Change password
        </button>
      </form>
    </section>
  )
}

function DataSection({ onDeleted }: { onDeleted: () => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function remove(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.delete('/account', { password, confirm })
      await onDeleted()
      window.location.assign(import.meta.env.BASE_URL)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not delete your account.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h3 style={{ marginBottom: 6 }}>Your data</h3>
      <p className="faint" style={{ marginBottom: 14 }}>
        Export everything held about you, or delete it for good.
      </p>
      <a className="btn btn--ghost btn--sm" href={`${API_BASE}/account/export`} download>
        Download my data
      </a>

      <hr className="rule" />

      <h4 style={{ marginBottom: 6 }}>Delete this account</h4>
      <p className="faint" style={{ marginBottom: 14 }}>
        Your data key is destroyed, so anything left in a backup can never be read again. Printed
        tags will show &#8220;not registered&#8221; when scanned.
      </p>
      {error && <Notice>{error}</Notice>}
      <form onSubmit={remove}>
        <Field
          label="Your password"
          name="delete_password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <Field
          label="Type DELETE to confirm"
          name="delete_confirm"
          value={confirm}
          onChange={setConfirm}
          placeholder="DELETE"
        />
        <button
          type="submit"
          className="btn btn--danger btn--sm"
          disabled={busy || !password || confirm.trim().toUpperCase() !== 'DELETE'}
        >
          Delete my account
        </button>
      </form>
    </section>
  )
}
