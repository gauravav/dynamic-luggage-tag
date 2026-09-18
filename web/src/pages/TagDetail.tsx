import { AnimatePresence, motion, useAnimate } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ApiError,
  api,
  downloadAsset,
  openAsset,
  parseLocation,
  type NameDisclosure,
  type ScanRecord,
  type Tag,
} from '../api/client'
import { IconPicker } from '../components/IconPicker'
import { WatchNotice } from '../components/WatchNotice'
import { NfcCard } from '../components/NfcCard'
import { PageLoader } from '../components/PageLoader'
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

  const [downloading, setDownloading] = useState<'pdf' | 'proof' | 'qr' | null>(null)

  // Set when the page was reached by scanning the tag itself, so the artwork
  // says "yes, this one" rather than looking like any other visit.
  const [search] = useSearchParams()
  const arrivedByScan = search.get('scanned') === '1'

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

  /**
   * Fetches a generated file and hands it to the browser.
   *
   * With a filename it downloads; without one it opens in a new tab, which is
   * what the guides proof and the bare symbol are for. Either way a failure
   * shows up as an error on this page rather than as a page of raw JSON.
   */
  async function fetchFile(kind: 'pdf' | 'proof' | 'qr', path: string, filename?: string) {
    setError(null)
    setDownloading(kind)
    try {
      await (filename ? downloadAsset(path, filename) : openAsset(path))
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not prepare that file.')
    } finally {
      setDownloading(null)
    }
  }

  async function rotate() {
    if (!tagId) return
    const confirmed = window.confirm(
      'Issue a new code?\n\nThe code printed on the tag keeps working — a finder can still reach you — but it can never publish your name again, and any open conversation is closed.\n\nReprint when convenient, not before. If you had switched old codes off, that is turned back on: the code on the bag is the one this replaces.',
    )
    if (!confirmed) return
    setBusy(true)
    setRotating(true)
    try {
      const body = await api.post<{ tag: Tag; threads_closed: number }>(`/tags/${tagId}/rotate`)
      setTag(body.tag)
      setInfo(
        'A new code was issued. The old one still gets a bag home but can no longer publish your name, so reprint whenever it suits you.',
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
        {error ? <Notice>{error}</Notice> : <PageLoader label="Loading this tag" />}
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

      {arrivedByScan && (
        <Notice kind="info">
          You scanned this tag just now — this is the bag it belongs to.
        </Notice>
      )}

      {/* On phones the tag leads the page; on desktop it lives in the sidebar. */}
      <div className="mobile-only tag-detail__mobile-art">
        <div ref={mobileArtScope} style={{ transformOrigin: '50% 0%' }}>
          <TagFaces tag={tag} name={user?.name ?? null} excited={arrivedByScan} />
        </div>
      </div>

      <div className="grid grid--split" style={{ alignItems: 'start' }}>
        <Stagger className="stack">
          {(tag.watched || tag.stale_scan_count > 0) && (
            <StaggerItem>
              <WatchNotice
                tag={tag}
                onBlockRetired={() => patch({ block_retired_tokens: true })}
                busy={busy}
              />
            </StaggerItem>
          )}
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
                  ? tag.name_disclosure === 'always'
                    ? 'Your name is visible to anyone who scans this tag.'
                    : 'A finder can message you. Your name stays unpublished.'
                  : 'While safe, a scan shows nothing personal at all.'
              }
              checked={isLost}
              danger
              disabled={busy || (!isLost && !user?.email_verified)}
              onChange={(next) =>
                patch(
                  { status: next ? 'lost' : 'safe' },
                  next
                    ? tag.name_disclosure === 'always'
                      ? 'Marked lost. Anyone who scans this tag now sees your name.'
                      : 'Marked lost. A finder can message you; your name is released when you reply.'
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
            <NameDisclosureChoice
              value={tag.name_disclosure}
              disabled={busy}
              onChange={(next) => patch({ name_disclosure: next })}
            />
            <div className="stack stack--tight" style={{ marginTop: 14 }}>
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

            <hr className="rule" style={{ margin: '20px 0' }} />

            <IconPicker
              icon={tag.icon}
              color={tag.icon_color}
              paper={tag.design.field}
              disabled={busy}
              onChange={(next) => patch({ icon: next.icon, icon_color: next.color })}
            />
            <p className="faint" style={{ marginTop: 12, marginBottom: 0 }}>
              Printed beside your name, and shown on the card in your list — so the right bag is
              the one you reach for.
            </p>
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
                <TagFaces tag={tag} name={user?.name ?? null} excited={arrivedByScan} />
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
              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={downloading !== null}
                onClick={() =>
                  fetchFile('pdf', `/tags/${tag.id}/print.pdf`, `luggage-tag-${tag.id}.pdf`)
                }
              >
                <BusyLabel
                  busy={downloading === 'pdf'}
                  idle="Download print PDF"
                  working="Preparing…"
                />
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block btn--sm"
                disabled={downloading !== null}
                onClick={() => fetchFile('proof', `/tags/${tag.id}/print.pdf?guides=1`)}
              >
                <BusyLabel
                  busy={downloading === 'proof'}
                  idle="Proof with trim guides"
                  working="Preparing…"
                />
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block btn--sm"
                disabled={downloading !== null}
                onClick={() => fetchFile('qr', `/tags/${tag.id}/qr.svg`)}
              >
                <BusyLabel busy={downloading === 'qr'} idle="QR code only (SVG)" working="Preparing…" />
              </button>
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

/**
 * The tag artwork, with a way to turn it over.
 *
 * The back is not decoration: it carries the circle the round NFC sticker goes
 * on, and someone about to stick one down needs to see where. It flips rather
 * than sitting side by side, because a tag has two faces and only ever shows
 * one of them at a time.
 */
function TagFaces({
  tag,
  name,
  excited,
}: {
  tag: Tag
  name: string | null
  /** Swings harder — used when this page was reached by scanning the tag. */
  excited?: boolean
}) {
  const [side, setSide] = useState<'front' | 'back'>('front')

  return (
    <div className="tag-faces">
      <motion.div
        className="tag-faces__stage"
        animate={excited ? { rotate: [-2.6, 2.6, -2.6] } : { rotate: 0 }}
        transition={
          excited
            ? { duration: 2, repeat: Infinity, ease: 'easeInOut' }
            : { type: 'spring', stiffness: 200, damping: 20 }
        }
        style={{ transformOrigin: '50% 0%' }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={side}
            initial={{ rotateY: side === 'back' ? -90 : 90, opacity: 0 }}
            animate={{ rotateY: 0, opacity: 1 }}
            exit={{ rotateY: side === 'back' ? 90 : -90, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            <TagArt
              design={tag.design}
              name={name}
              subtitle={tag.label}
              icon={tag.icon}
              iconColor={tag.icon_color}
              side={side}
              title={
                side === 'back'
                  ? 'The back of the tag, with the NFC sticker circle'
                  : `${tag.label ?? 'Tag'} — ${describe(tag.design)}`
              }
            />
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <div className="segmented" role="group" aria-label="Which face of the tag to show">
        {(['front', 'back'] as const).map((face) => (
          <button
            key={face}
            type="button"
            className={`segmented__option${side === face ? ' is-selected' : ''}`}
            aria-pressed={side === face}
            onClick={() => setSide(face)}
          >
            {side === face && (
              <motion.span
                layoutId={`face-${tag.id}`}
                className="segmented__active"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span className="segmented__text">{face === 'front' ? 'Front' : 'Back'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * How the owner's name reaches a finder.
 *
 * Three settings rather than a switch, because the useful one is in the
 * middle. A scan code is a bearer credential with no expiry: anyone who
 * scanned the bag while it was safe can keep the link and watch it. `always`
 * hands that person the name the moment the bag is reported lost. Releasing it
 * per conversation costs a genuine finder nothing — they never needed the name
 * to return a bag, only a way to say they have it.
 */
function NameDisclosureChoice({
  value,
  disabled,
  onChange,
}: {
  value: NameDisclosure
  disabled?: boolean
  onChange: (next: NameDisclosure) => void
}) {
  const options: { value: NameDisclosure; label: string; hint: string }[] = [
    {
      value: 'on_reply',
      label: 'When I reply to a finder',
      hint: 'They message you first; answering releases your name to that conversation only.',
    },
    {
      value: 'always',
      label: 'To anyone who scans it',
      hint: 'Fastest, and visible to anyone holding a copy of the link — including one saved before the bag was lost.',
    },
    { value: 'never', label: 'Never', hint: 'Messages only. Your name is not shown at any point.' },
  ]

  return (
    <fieldset className="choice" disabled={disabled}>
      <legend className="field__label-text">Show my name</legend>
      {options.map((option) => (
        <label key={option.value} className={`choice__option${value === option.value ? ' is-selected' : ''}`}>
          <input
            type="radio"
            name="name-disclosure"
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>
            <span className="choice__label">{option.label}</span>
            <span className="choice__hint">{option.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}
