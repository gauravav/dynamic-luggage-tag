/**
 * What a stranger sees after scanning a tag.
 *
 * Written for someone standing at a baggage carousel who has never heard of
 * this product: the one thing they came to find out is answered in the first
 * line, and nothing below it asks them for anything.
 *
 * The header is the exception, and it is there for the other person who scans
 * these tags constantly — the owner. Signed in on this browser, they are sent
 * straight to the tag's own page instead; signed out, the header is how they
 * get back to their account at all.
 *
 * Reading this page is a GET with no side effects. Recording the scan is a
 * separate POST fired once the page has actually rendered, so link-preview
 * bots and prefetches never reach the owner's history or inbox — and it is
 * skipped entirely when the scanner turns out to be the owner, who does not
 * need an email telling them they just tapped their own bag.
 */

import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api, type ScanPage as ScanPageData, type Tag } from '../api/client'
import { SiteHeader } from '../components/Layout'
import { TagArt } from '../components/TagArt'
import { MessageSent, PinDrop, SwingingTag } from '../components/illustrations'
import { BusyLabel, Reveal, SendLabel } from '../components/motion'
import { PageLoader } from '../components/PageLoader'
import { Field, Notice } from '../components/ui'
import { askOpenTabToShow } from '../lib/appTabs'
import { useTurnstile } from '../lib/turnstile'
import { useSession } from '../state/session'

/** Who is holding the phone, as far as we can tell. */
type Scanner = 'unknown' | 'owner' | 'finder'

export function ScanPage() {
  const { token } = useParams<{ token: string }>()
  const { user, loading: sessionLoading } = useSession()
  const navigate = useNavigate()

  const [data, setData] = useState<ScanPageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanner, setScanner] = useState<Scanner>('unknown')
  const [handedOffTo, setHandedOffTo] = useState<string | null>(null)
  const recorded = useRef(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false

    api
      .get<ScanPageData>(`/scan/${encodeURIComponent(token)}`)
      .then((body) => {
        if (!cancelled) setData(body)
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

  // Is this one of the signed-in owner's own tags? The lookup only ever
  // matches their own rows, so a 404 means "not mine" and nothing more.
  useEffect(() => {
    if (!token || sessionLoading) return
    if (!user) {
      setScanner('finder')
      return
    }
    let cancelled = false

    api
      .post<{ tag: Tag }>('/tags/lookup', { token })
      .then(async ({ tag }) => {
        if (cancelled) return
        setScanner('owner')
        if (await askOpenTabToShow(tag.id)) {
          if (!cancelled) setHandedOffTo(tag.id)
          return
        }
        if (!cancelled) navigate(`/app/tags/${tag.id}?scanned=1`, { replace: true })
      })
      .catch(() => {
        if (!cancelled) setScanner('finder')
      })

    return () => {
      cancelled = true
    }
  }, [token, user, sessionLoading, navigate])

  // Recorded once, and only for someone who is not the owner. StrictMode
  // double-mounts effects in development, and one visit is one scan.
  useEffect(() => {
    if (!token || !data || scanner !== 'finder' || recorded.current) return
    recorded.current = true
    void api.post(`/scan/${encodeURIComponent(token)}/view`).catch(() => undefined)
  }, [token, data, scanner])

  return (
    <div className="shell">
      <SiteHeader />
      <main id="main">{renderBody()}</main>
    </div>
  )

  function renderBody() {
    if (error) {
      return (
        <div className="page wrap wrap--narrow center">
          <Reveal>
            <h1 style={{ fontSize: 26, marginBottom: 10 }}>This tag is not registered</h1>
            <p className="muted">
              It may have been deleted, or its code may have been replaced by the owner.
            </p>
          </Reveal>
        </div>
      )
    }

    if (handedOffTo) {
      return <HandedOff tagId={handedOffTo} />
    }

    if (!data || !token || scanner === 'unknown' || scanner === 'owner') {
      return (
        <div className="page wrap wrap--narrow">
          <PageLoader
            label="Checking this tag"
            captions={['Reading the tag…', 'Looking it up…', 'Checking what may be shown…']}
          />
        </div>
      )
    }

    return (
      <div className="page wrap wrap--narrow">
        {/* The tag drops in and swings, as if just turned over in the hand. */}
        <div style={{ maxWidth: 210, margin: '0 auto 28px' }}>
          <SwingingTag>
            <TagArt design={data.design} crest title="The tag you scanned" />
          </SwingingTag>
        </div>

        {data.status === 'lost' ? (
          <LostState token={token} data={data} />
        ) : (
          <SafeState token={token} data={data} />
        )}

        <p className="faint center" style={{ marginTop: 32 }}>
          You do not need an account, and nothing about you is stored unless you choose to share
          it.
        </p>
      </div>
    )
  }
}

/**
 * Shown when an app tab was already open and took the tag.
 *
 * A browser will not raise a background tab on our say-so, so the only honest
 * thing to do is say where it went and offer to show it here instead.
 */
function HandedOff({ tagId }: { tagId: string }) {
  return (
    <div className="page wrap wrap--narrow center">
      <Reveal className="card">
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Opened in your other tab</h1>
        <p className="muted">
          This is your own tag, and you already had the app open — it has moved to this tag there,
          rather than leaving you with another tab.
        </p>
        <Link className="btn btn--ghost btn--sm" to={`/app/tags/${tagId}?scanned=1`}>
          Show it here instead
        </Link>
      </Reveal>
    </div>
  )
}

function SafeState({ token, data }: { token: string; data: ScanPageData }) {
  return (
    <Reveal className="card" delay={0.25}>
      <motion.span
        className="pill pill--safe"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 18, delay: 0.4 }}
      >
        <span className="pill__dot" />
        Marked safe
      </motion.span>
      <h1 style={{ fontSize: 24, margin: '14px 0 8px' }}>This bag has not been reported lost.</h1>
      <p className="muted">
        The owner knows where it is, so no personal details are shown. If the bag looks like it has
        gone astray, you can still let them know it passed through here.
      </p>
      <LocationShare token={token} retentionDays={data.retention_days} />
    </Reveal>
  )
}

function LostState({ token, data }: { token: string; data: ScanPageData }) {
  return (
    <>
      <Reveal className="card" style={{ marginBottom: 20 }} delay={0.25}>
        <motion.span
          className="pill pill--lost"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 18, delay: 0.4 }}
        >
          <span className="pill__dot-wrap">
            <span className="pill__dot" />
            {/* A slow pulse: this bag is actively being looked for. */}
            <motion.span
              className="pill__ring"
              initial={{ scale: 1, opacity: 0.6 }}
              animate={{ scale: 3.4, opacity: 0 }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut', delay: 0.8 }}
            />
          </span>
          Reported lost
        </motion.span>
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
        {data.retired_code && (
          <p className="faint" style={{ margin: '12px 0 0' }}>
            This tag&#8217;s code was replaced at some point, so the owner&#8217;s name is not shown
            here. Your message still reaches them.
          </p>
        )}
      </Reveal>

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
        <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          <PinDrop />
          <span>Thank you — the owner has been told the bag passed through {city || 'here'}.</span>
        </span>
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
    <Reveal className="panel" style={{ marginTop: 20 }} delay={0.45}>
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
            <BusyLabel busy={busy} idle="Share city" working="Sharing…" />
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
    </Reveal>
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
  // Called before the early return below: hooks must run in the same order on
  // every render. Only this form loads Turnstile — viewing the page, recording
  // the scan and sharing a city never touch Cloudflare.
  const turnstile = useTurnstile('finder_message')

  if (relayToken) {
    return (
      <motion.div
        className="card"
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      >
        <div style={{ margin: '-6px 0 2px' }}>
          <MessageSent />
        </div>
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
      </motion.div>
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
        { turnstileToken: turnstile.token },
      )
      setEmailed(response.email_updates)
      setRelayToken(response.relay_token)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not send that message.')
    } finally {
      setBusy(false)
      turnstile.reset()
    }
  }

  return (
    <Reveal className="card" delay={0.35}>
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
        {turnstile.widget}
        {turnstile.loadError && <Notice>{turnstile.loadError}</Notice>}
        <button
          type="submit"
          className="btn btn--danger"
          disabled={busy || !body.trim() || !turnstile.ready}
        >
          <SendLabel busy={busy} idle="Send message" working="Sending…" />
        </button>
      </form>
    </Reveal>
  )
}
