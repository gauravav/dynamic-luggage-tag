import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api, parseLocation, type ScanRecord, type Tag } from '../api/client'
import { TagArt } from '../components/TagArt'
import { Empty, Field, Notice, Spinner, StatusPill, Toggle } from '../components/ui'
import { describe, formatDateTime, relativeTime } from '../lib/design'
import { useSession } from '../state/session'

export function TagDetail() {
  const { tagId } = useParams<{ tagId: string }>()
  const { user } = useSession()
  const navigate = useNavigate()

  const [tag, setTag] = useState<Tag | null>(null)
  const [scans, setScans] = useState<ScanRecord[] | null>(null)
  const [retentionDays, setRetentionDays] = useState(90)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!tagId) return
    try {
      const [tagBody, scanBody] = await Promise.all([
        api.get<{ tag: Tag }>(`/tags/${tagId}`),
        api.get<{ scans: ScanRecord[]; retention_days: number }>(`/tags/${tagId}/scans`),
      ])
      setTag(tagBody.tag)
      setLabel(tagBody.tag.label ?? '')
      setScans(scanBody.scans)
      setRetentionDays(scanBody.retention_days)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load this tag.')
    }
  }, [tagId])

  useEffect(() => {
    void load()
  }, [load])

  async function patch(changes: Record<string, unknown>, note?: string) {
    if (!tagId) return
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const body = await api.patch<{ tag: Tag }>(`/tags/${tagId}`, changes)
      setTag(body.tag)
      if (note) setInfo(note)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not save that change.')
    } finally {
      setBusy(false)
    }
  }

  async function rotate() {
    if (!tagId) return
    const confirmed = window.confirm(
      'Issue a new code? Every printed copy of this tag stops working, and any open conversation with a finder is closed.',
    )
    if (!confirmed) return
    setBusy(true)
    try {
      const body = await api.post<{ tag: Tag; threads_closed: number }>(`/tags/${tagId}/rotate`)
      setTag(body.tag)
      setInfo('A new code was issued. Print the tag again before using it.')
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not rotate the code.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!tagId) return
    const confirmed = window.confirm(
      'Delete this tag? Its scan history is deleted with it and cannot be recovered.',
    )
    if (!confirmed) return
    try {
      await api.delete(`/tags/${tagId}`)
      navigate('/app', { replace: true })
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not delete this tag.')
    }
  }

  if (!tag) {
    return (
      <div className="page wrap">
        {error ? <Notice>{error}</Notice> : <Spinner label="Loading tag" />}
      </div>
    )
  }

  const isLost = tag.status === 'lost'

  return (
    <div className="page wrap">
      <p className="kicker">
        <Link to="/app" style={{ color: 'inherit' }}>
          &larr; all tags
        </Link>
      </p>
      <div className="page__head row row--between">
        <h1>{tag.label ?? 'Untitled tag'}</h1>
        <StatusPill status={tag.status} />
      </div>

      {error && <Notice>{error}</Notice>}
      {info && <Notice kind="info">{info}</Notice>}

      <div className="grid grid--split" style={{ alignItems: 'start' }}>
        <div className="stack">
          <section className="card">
            <h3 style={{ marginBottom: 14 }}>Status</h3>
            <Toggle
              label="Report this bag lost"
              hint={
                isLost
                  ? 'Your name and a message link are visible to anyone who scans this tag.'
                  : 'While safe, a scan shows nothing personal at all.'
              }
              checked={isLost}
              danger
              disabled={busy || (!isLost && !user?.email_verified)}
              onChange={(next) =>
                patch(
                  { status: next ? 'lost' : 'safe' },
                  next
                    ? 'Marked lost. A finder who scans this tag now sees your name.'
                    : 'Marked safe. Personal details are hidden again.',
                )
              }
            />
            {!user?.email_verified && !isLost && (
              <p className="faint" style={{ marginTop: 10 }}>
                Confirm your email address first — this is the one action that publishes your name.
              </p>
            )}
          </section>

          <section className="card">
            <h3 style={{ marginBottom: 14 }}>What a finder sees when it is lost</h3>
            <div className="stack stack--tight">
              <Toggle
                label="Show my name"
                checked={tag.reveal_name}
                disabled={busy}
                onChange={(next) => patch({ reveal_name: next })}
              />
              <Toggle
                label="Allow messages"
                hint="Relayed through the app. They never see your number or address."
                checked={tag.reveal_message_relay}
                disabled={busy}
                onChange={(next) => patch({ reveal_message_relay: next })}
              />
              <Toggle
                label="Email me when this tag is scanned"
                checked={tag.notify_on_scan}
                disabled={busy}
                onChange={(next) => patch({ notify_on_scan: next })}
              />
            </div>
            <p className="faint" style={{ marginTop: 14, marginBottom: 0 }}>
              Your address is never shown to a finder, at any setting.
            </p>
          </section>

          <section className="card">
            <h3 style={{ marginBottom: 14 }}>Details</h3>
            <Field
              label="Label"
              name="label"
              value={label}
              onChange={setLabel}
              hint="For your own reference, and printed small under your name."
              maxLength={80}
            />
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={busy || label === (tag.label ?? '')}
              onClick={() => patch({ label: label || null }, 'Label saved.')}
            >
              Save label
            </button>
          </section>

          <section className="card">
            <h3 style={{ marginBottom: 6 }}>Scan activity</h3>
            <p className="faint" style={{ marginBottom: 14 }}>
              Deleted automatically after {retentionDays} days. The scanner&#8217;s address is never
              stored.
            </p>
            {scans === null ? (
              <Spinner />
            ) : scans.length === 0 ? (
              <Empty title="No scans yet">
                <p className="muted">Nobody has opened this tag&#8217;s page.</p>
              </Empty>
            ) : (
              <ul className="list">
                {scans.map((scan) => (
                  <li key={scan.id} className="list__item">
                    <span>
                      {formatDateTime(scan.occurred_at)}
                      <br />
                      <span className="faint">
                        {scan.client ?? 'Unknown device'}
                        {scan.contact_revealed ? ' · contact shown' : ''}
                      </span>
                    </span>
                    <span className="muted" style={{ textAlign: 'right' }}>
                      {parseLocation(scan.location) ?? 'Location not shared'}
                      <br />
                      <span className="faint">expires {relativeTime(scan.expires_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="stack">
          <TagArt design={tag.design} name={user?.name ?? null} subtitle={tag.label} />
          <p className="faint center" style={{ margin: 0 }}>
            {describe(tag.design)}
          </p>

          <div className="card">
            <h3 style={{ marginBottom: 10 }}>Print</h3>
            <p className="faint" style={{ marginBottom: 14 }}>
              108.40 &times; 74.10 mm with bleed, trimming to 104.40 &times; 70.10 mm. Fonts are
              embedded and the artwork runs to the bleed edge.
            </p>
            <div className="stack stack--tight">
              <a
                className="btn btn--primary btn--block"
                href={`/api/v1/tags/${tag.id}/print.pdf`}
                download
              >
                Download print PDF
              </a>
              <a
                className="btn btn--ghost btn--block btn--sm"
                href={`/api/v1/tags/${tag.id}/print.pdf?guides=1`}
                target="_blank"
                rel="noreferrer"
              >
                Proof with trim guides
              </a>
              <a
                className="btn btn--ghost btn--block btn--sm"
                href={`/api/v1/tags/${tag.id}/qr.svg`}
                target="_blank"
                rel="noreferrer"
              >
                QR code only (SVG)
              </a>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 10 }}>Scan link</h3>
            <p className="code-block">{tag.scan_url}</p>
            <p className="faint">
              A random 256-bit token. It identifies a row and nothing else.
            </p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={rotate} disabled={busy}>
              Issue a new code
            </button>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 10 }}>Delete</h3>
            <p className="faint">This tag and its scan history are removed permanently.</p>
            <button type="button" className="btn btn--danger btn--sm" onClick={remove}>
              Delete this tag
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
