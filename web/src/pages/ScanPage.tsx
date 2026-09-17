/**
 * What a stranger sees after scanning a tag.
 *
 * Written for someone standing at a baggage carousel who has never heard of
 * this product: no sign-up prompt, no navigation, no cookie banner, and the
 * one thing they came to find out answered in the first line.
 *
 * Reading this page is a GET with no side effects. Recording the scan is a
 * separate POST fired once the page has actually rendered, so link-preview
 * bots and prefetches never reach the owner's history or inbox.
 */

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ApiError, api, type ScanPage as ScanPageData } from '../api/client'
import { TagArt } from '../components/TagArt'
import { Field, Notice, Spinner } from '../components/ui'

export function ScanPage() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<ScanPageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recorded = useRef(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false

    api
      .get<ScanPageData>(`/scan/${encodeURIComponent(token)}`)
      .then((body) => {
        if (cancelled) return
        setData(body)
        // Fire-and-forget, and only once: StrictMode double-mounts effects in
        // development, and the owner should not see two scans for one visit.
        if (!recorded.current) {
          recorded.current = true
          void api.post(`/scan/${encodeURIComponent(token)}/view`).catch(() => undefined)
        }
      })
      .catch((cause) => {
        if (cancelled) return
        setError(
          cause instanceof ApiError && cause.status === 404
            ? 'This tag is not registered.'
            : 'Could not load this tag.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [token])

  if (error) {
    return (
      <div className="page wrap wrap--narrow center">
        <h1 style={{ fontSize: 26, marginBottom: 10 }}>This tag is not registered</h1>
        <p className="muted">
          It may have been deleted, or its code may have been replaced by the owner.
        </p>
      </div>
    )
  }

  if (!data || !token) {
    return (
      <div className="page wrap wrap--narrow">
        <Spinner label="Checking this tag" />
      </div>
    )
  }

  return (
    <div className="page wrap wrap--narrow">
      <div style={{ maxWidth: 210, margin: '0 auto 28px' }}>
        <TagArt design={data.design} crest title="The tag you scanned" />
      </div>

      {data.status === 'lost' ? (
        <LostState token={token} data={data} />
      ) : (
        <SafeState token={token} data={data} />
      )}

      <p className="faint center" style={{ marginTop: 32 }}>
        You do not need an account, and nothing about you is stored unless you choose to share it.
      </p>
    </div>
  )
}

function SafeState({ token, data }: { token: string; data: ScanPageData }) {
  return (
    <div className="card">
      <span className="pill pill--safe">
        <span className="pill__dot" />
        Marked safe
      </span>
      <h1 style={{ fontSize: 24, margin: '14px 0 8px' }}>This bag has not been reported lost.</h1>
      <p className="muted">
        The owner knows where it is, so no personal details are shown. If the bag looks like it has
        gone astray, you can still let them know it passed through here.
      </p>
      <LocationShare token={token} retentionDays={data.retention_days} />
    </div>
  )
}

function LostState({ token, data }: { token: string; data: ScanPageData }) {
  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <span className="pill pill--lost">
          <span className="pill__dot" />
          Reported lost
        </span>
        <h1 style={{ fontSize: 24, margin: '14px 0 8px' }}>
          {data.owner?.name ? 'This bag belongs to' : 'The owner is looking for this bag'}
        </h1>
        {data.owner?.name && (
          <p
            style={{
              fontFamily: 'var(--serif)',
              fontSize: 24,
              fontWeight: 600,
              margin: '0 0 10px',
            }}
          >
            {data.owner.name}
          </p>
        )}
        <p className="muted" style={{ marginBottom: 0 }}>
          Thank you for scanning. Telling them where you found it is the fastest way to get it
          home.
        </p>
      </div>

      {data.relay_available && <MessageForm token={token} />}
      <LocationShare token={token} retentionDays={data.retention_days} />
    </>
  )
}

function LocationShare({ token, retentionDays }: { token: string; retentionDays: number }) {
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')
  const [state, setState] = useState<'idle' | 'sent' | 'declined'>('idle')
  const [busy, setBusy] = useState(false)

  if (state === 'sent') {
    return (
      <Notice kind="info">
        Thank you — the owner has been told the bag passed through {city || 'here'}.
      </Notice>
    )
  }
  if (state === 'declined') {
    return <p className="faint">No location was shared.</p>
  }

  async function share(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await api.post(`/scan/${encodeURIComponent(token)}/location`, {
        share: true,
        city: city || null,
        country: country.toUpperCase() || null,
      })
      setState('sent')
    } catch {
      setState('declined')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <h3 style={{ fontSize: 16, marginBottom: 6 }}>Tell the owner roughly where you are?</h3>
      <p className="faint" style={{ marginBottom: 14 }}>
        City level only, once, and entirely up to you. Your exact location and network address are
        never recorded. What you share is deleted after {retentionDays} days.
      </p>
      <form onSubmit={share}>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '2 1 160px' }}>
            <Field label="City" name="city" value={city} onChange={setCity} placeholder="Dallas" />
          </div>
          <div style={{ flex: '1 1 90px' }}>
            <Field
              label="Country"
              name="country"
              value={country}
              onChange={setCountry}
              placeholder="US"
              maxLength={2}
            />
          </div>
        </div>
        <div className="row">
          <button type="submit" className="btn btn--primary btn--sm" disabled={busy || !city}>
            {busy ? 'Sharing…' : 'Share city'}
          </button>
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            onClick={() => setState('declined')}
          >
            No thanks
          </button>
        </div>
      </form>
    </div>
  )
}

function MessageForm({ token }: { token: string }) {
  const [body, setBody] = useState('')
  const [contact, setContact] = useState('')
  const [email, setEmail] = useState('')
  const [relayToken, setRelayToken] = useState<string | null>(null)
  const [emailed, setEmailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (relayToken) {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Message sent</h3>
        <p className="muted">
          The owner has been notified.{' '}
          {emailed
            ? 'We emailed you this link, and will email you again when they reply.'
            : 'Keep this link to see their reply — it is the only way back to this conversation, and it needs no account.'}
        </p>
        <p className="code-block">{`${window.location.origin}/r/${relayToken}`}</p>
        <a className="btn btn--ghost btn--sm" href={`/r/${relayToken}`}>
          Open the conversation
        </a>
      </div>
    )
  }

  async function send(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await api.post<{ relay_token: string; email_updates: boolean }>(
        `/scan/${encodeURIComponent(token)}/message`,
        { body: body.trim(), contact: contact.trim() || null, email: email.trim() || null },
      )
      setEmailed(response.email_updates)
      setRelayToken(response.relay_token)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not send that message.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: 6 }}>Message the owner</h3>
      <p className="faint" style={{ marginBottom: 16 }}>
        Sent through this app. They will not see your phone number or email address, and you will
        not see theirs.
      </p>
      {error && <Notice>{error}</Notice>}
      <form onSubmit={send}>
        <Field
          label="Your message"
          name="body"
          value={body}
          onChange={setBody}
          multiline
          maxLength={2000}
          placeholder="I found this at DFW, baggage claim 3. I have handed it to the desk."
          required
        />
        <Field
          label="Your email, for replies (optional)"
          name="email"
          type="email"
          value={email}
          onChange={setEmail}
          maxLength={254}
          autoComplete="email"
          hint="We email you the conversation link and let you know when the owner replies. The owner never sees this address."
        />
        <Field
          label="How they could reach you (optional)"
          name="contact"
          value={contact}
          onChange={setContact}
          maxLength={120}
          hint="Shown to the owner. Only if you want to. Leave it blank and the conversation stays entirely inside this app."
        />
        <button type="submit" className="btn btn--danger" disabled={busy || !body.trim()}>
          {busy ? 'Sending…' : 'Send message'}
        </button>
      </form>
    </div>
  )
}
