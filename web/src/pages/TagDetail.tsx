import { AnimatePresence, motion, useAnimate } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api, parseLocation, type ScanRecord, type Tag } from '../api/client'
import { NfcCard } from '../components/NfcCard'
import { TagArt } from '../components/TagArt'
import { BusyLabel, Skeleton, Stagger, StaggerItem, SuccessTick } from '../components/motion'
import { Empty, Field, Notice, StatusPill, Toggle } from '../components/ui'
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
  const [rotating, setRotating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [savedLabel, setSavedLabel] = useState(false)

  // Tag artwork appears twice (above the form on phones, in the sidebar on
  // desktop), and both react to the status changing.
  const [artScope, animateArt] = useAnimate<HTMLDivElement>()
  const [mobileArtScope, animateMobileArt] = useAnimate<HTMLDivElement>()
  const previousStatus = useRef<string | null>(null)

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

  // Reporting a bag lost is the most consequential action here, so the tag
  // itself reacts: marked lost, it shakes like an alarm; marked safe, it
  // settles back with a small bounce.
  useEffect(() => {
    if (!tag) return
    const previous = previousStatus.current
    previousStatus.current = tag.status
    if (previous === null || previous === tag.status) return
    const keyframes =
      tag.status === 'lost'
        ? { rotate: [0, -7, 6, -5, 4, -2, 0], scale: [1, 1.04, 1] }
        : { y: [0, -10, 0], scale: [1, 1.02, 1] }
    for (const [scope, run] of [[artScope, animateArt], [mobileArtScope, animateMobileArt]] as const) {
      if (scope.current) void run(scope.current, keyframes, { duration: 0.7, ease: 'easeInOut' })
    }
  }, [tag, artScope, animateArt, mobileArtScope, animateMobileArt])

  async function patch(changes: Record<string, unknown>, note?: string) {
    if (!tagId) return
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const body = await api.patch<{ tag: Tag }>(`/tags/${tagId}`, changes)
      setTag(body.tag)
      if ('label' in changes) {
        setSavedLabel(true)
        window.setTimeout(() => setSavedLabel(false), 2200)
      }
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
    setRotating(true)
    try {
      const body = await api.post<{ tag: Tag; threads_closed: number }>(`/tags/${tagId}/rotate`)
      setTag(body.tag)
      setInfo(
        body.tag.nfc_linked
          ? 'A new code was issued. Print the tag again, and rewrite the NFC sticker from a phone.'
          : 'A new code was issued. Print the tag again before using it.',
      )
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not rotate the code.')
    } finally {
      setBusy(false)
      setRotating(false)
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
      // Let the page fold away before leaving, so the deletion is felt.
      setDeleting(true)
      window.setTimeout(() => navigate('/app', { replace: true }), 420)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not delete this tag.')
    }
  }

  if (!tag) {
    return (
      <div className="page wrap">
        {error ? (
          <Notice>{error}</Notice>
        ) : (
          <div className="grid grid--split" style={{ alignItems: 'start' }} aria-busy="true" aria-label="Loading tag">
            <div className="stack">
              <Skeleton height={34} width="55%" />
              <Skeleton height={120} radius={12} />
              <Skeleton height={220} radius={12} />
            </div>
            <Skeleton height={0} style={{ paddingBottom: '146%' }} radius={12} />
          </div>
        )}
      </div>
    )
  }

  const isLost = tag.status === 'lost'

  return (
    <motion.div
      className="page wrap"
      animate={deleting ? { opacity: 0, scale: 0.96, y: 20 } : { opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.38, ease: 'easeIn' }}
    >
      <p className="kicker">
        <Link to="/app" style={{ color: 'inherit' }}>
          &larr; all tags
        </Link>
      </p>
      <div className="page__head row row--between">
        <h1>{tag.label ?? 'Untitled tag'}</h1>
        <StatusPill status={tag.status} />
      </div>

      <AnimatePresence mode="popLayout">
        {error && <Notice key={`e-${error}`}>{error}</Notice>}
        {info && (
          <Notice kind="info" key={`i-${info}`}>
            {info}
          </Notice>
        )}
      </AnimatePresence>

      {/* On phones the tag leads the page; on desktop it lives in the sidebar. */}
      <div className="mobile-only tag-detail__mobile-art">
        <div ref={mobileArtScope} style={{ transformOrigin: '50% 0%' }}>
          <TagArt design={tag.design} name={user?.name ?? null} subtitle={tag.label} />
        </div>
      </div>

      <div className="grid grid--split" style={{ alignItems: 'start' }}>
        <Stagger className="stack">
          <StaggerItem>
          <motion.section
            className="card status-card"
            animate={{ backgroundColor: isLost ? '#FBEFEB' : '#FFFFFF', borderColor: isLost ? '#E9C7BC' : '#DCD0AF' }}
            transition={{ duration: 0.4 }}
          >
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
          </motion.section>
          </StaggerItem>

          <StaggerItem>
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

          </StaggerItem>
          <StaggerItem>
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
            <div className="row">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={busy || label === (tag.label ?? '')}
                onClick={() => patch({ label: label || null })}
              >
                Save label
              </button>
              <AnimatePresence>
                {savedLabel && (
                  <motion.span
                    className="row"
                    style={{ gap: 6, color: 'var(--forest)', fontSize: 14, fontWeight: 600 }}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0 }}
                  >
                    <SuccessTick /> Saved
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </section>
          </StaggerItem>

          <StaggerItem>
          <section className="card">
            <h3 style={{ marginBottom: 6 }}>Scan activity</h3>
            <p className="faint" style={{ marginBottom: 14 }}>
              Deleted automatically after {retentionDays} days. The scanner&#8217;s address is never
              stored.
            </p>
            {scans === null ? (
              <div className="stack stack--tight">
                <Skeleton height={42} />
                <Skeleton height={42} />
              </div>
            ) : scans.length === 0 ? (
              <Empty title="No scans yet">
                <p className="muted">Nobody has opened this tag&#8217;s page.</p>
              </Empty>
            ) : (
              <ul className="list">
                {scans.map((scan, index) => (
                  <motion.li
                    key={scan.id}
                    className="list__item"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + Math.min(index, 10) * 0.05, type: 'spring', stiffness: 260, damping: 26 }}
                  >
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
                  </motion.li>
                ))}
              </ul>
            )}
          </section>
          </StaggerItem>
        </Stagger>

        <aside className="stack">
          <div className="desktop-only">
            <div ref={artScope} style={{ transformOrigin: '50% 0%' }}>
              <motion.div
                initial={{ opacity: 0, rotate: -6, y: -16 }}
                animate={{ opacity: 1, rotate: 0, y: 0 }}
                transition={{ type: 'spring', stiffness: 120, damping: 10 }}
                style={{ transformOrigin: '50% 0%' }}
              >
                <TagArt design={tag.design} name={user?.name ?? null} subtitle={tag.label} />
              </motion.div>
            </div>
          </div>
          <p className="faint center desktop-only" style={{ margin: 0 }}>
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

          <NfcCard tag={tag} onChange={setTag} />

          <div className="card">
            <h3 style={{ marginBottom: 10 }}>Scan link</h3>
            <div className="code-block" style={{ overflow: 'hidden' }}>
              {/* A rotated code flips over, so it is obvious the link changed. */}
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={tag.scan_url}
                  style={{ display: 'block' }}
                  initial={{ opacity: 0, rotateX: -90, y: 10 }}
                  animate={{ opacity: 1, rotateX: 0, y: 0 }}
                  exit={{ opacity: 0, rotateX: 90, y: -10 }}
                  transition={{ duration: 0.35 }}
                >
                  {tag.scan_url}
                </motion.span>
              </AnimatePresence>
            </div>
            <p className="faint">
              A random 256-bit token. It identifies a row and nothing else.
            </p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={rotate} disabled={busy}>
              <motion.svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                aria-hidden="true"
                animate={{ rotate: rotating ? 360 : 0 }}
                transition={rotating ? { duration: 0.7, repeat: Infinity, ease: 'linear' } : { duration: 0 }}
              >
                <path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </motion.svg>
              Issue a new code
            </button>
          </div>

          <div className="card">
            <h3 style={{ marginBottom: 10 }}>Delete</h3>
            <p className="faint">This tag and its scan history are removed permanently.</p>
            <button type="button" className="btn btn--danger btn--sm" onClick={remove} disabled={deleting}>
              <BusyLabel busy={deleting} idle="Delete this tag" working="Deleting…" />
            </button>
          </div>
        </aside>
      </div>
    </motion.div>
  )
}
