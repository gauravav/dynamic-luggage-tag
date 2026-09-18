import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api, type Tag } from '../api/client'
import { SwingingTag } from '../components/illustrations'
import { BusyLabel } from '../components/motion'
import { PageLoader } from '../components/PageLoader'
import { TagArt } from '../components/TagArt'
import { Empty, Notice, StatusPill } from '../components/ui'
import { FALLBACK_DESIGN, describe, formatDate, relativeTime } from '../lib/design'
import { NfcError, nfcSupported, readChip } from '../lib/nfc'
import { useSession } from '../state/session'

/** How long an identified tag keeps swinging before it settles back. */
const IDENTIFIED_MS = 9000

type Lookup = { registered: 'none' } | { registered: 'other' } | { registered: 'mine'; tag: Tag }

export function Dashboard() {
  const { user } = useSession()
  const [tags, setTags] = useState<Tag[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // The tag just created, so only it plays the "printing" entrance.
  const [newTagId, setNewTagId] = useState<string | null>(null)
  // The tag an NFC sticker was just held against, so it can say which bag it is.
  const [identified, setIdentified] = useState<string | null>(null)
  const [identifying, setIdentifying] = useState(false)
  const [identifyNote, setIdentifyNote] = useState<{ kind: 'info' | 'warn' | 'error'; text: string } | null>(null)
  const cards = useRef(new Map<string, HTMLElement>())

  const load = useCallback(async () => {
    try {
      const body = await api.get<{ tags: Tag[] }>('/tags')
      setTags(body.tags)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load your tags.')
      setTags([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createTag() {
    setCreating(true)
    setError(null)
    try {
      const created = await api.post<{ tag: Tag }>('/tags', { label: null })
      setNewTagId(created.tag.id)
      await load()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not create a tag.')
    } finally {
      setCreating(false)
    }
  }

  /**
   * Answers "which of these is the bag in my hand?".
   *
   * Reading the chip gives a serial; the server maps it to a tag of the
   * owner's, and the matching card scrolls into view and swings. A chip that
   * belongs to nobody, or to somebody else, is reported as such and nothing
   * is highlighted.
   */
  async function identify() {
    setIdentifyNote(null)
    setIdentified(null)
    setIdentifying(true)
    try {
      const chip = await readChip()
      const found = await api.post<Lookup>('/tags/nfc/lookup', { serial: chip.serial })
      if (found.registered === 'none') {
        setIdentifyNote({ kind: 'warn', text: 'That NFC sticker is not linked to any tag yet.' })
        return
      }
      if (found.registered === 'other') {
        setIdentifyNote({ kind: 'error', text: 'That NFC sticker is registered to another account.' })
        return
      }
      setIdentified(found.tag.id)
      setIdentifyNote({
        kind: 'info',
        text: `That is “${found.tag.label ?? 'Untitled tag'}”.`,
      })
      // Wait a frame so a card that has only just been highlighted exists.
      window.requestAnimationFrame(() => {
        cards.current.get(found.tag.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
      window.setTimeout(() => setIdentified(null), IDENTIFIED_MS)
    } catch (cause) {
      setIdentifyNote({
        kind: 'error',
        text:
          cause instanceof NfcError || cause instanceof ApiError
            ? cause.message
            : 'Could not read that NFC sticker.',
      })
    } finally {
      setIdentifying(false)
    }
  }

  const lostCount = tags?.filter((tag) => tag.status === 'lost').length ?? 0
  // Only tags set to publish the name expose it to whoever holds a code. The
  // rest release it into a conversation, so the warning must not say otherwise.
  const broadcasting =
    tags?.filter((tag) => tag.status === 'lost' && tag.name_disclosure === 'always').length ?? 0

  return (
    <div className="page wrap">
      <div className="page__head row row--between">
        <div>
          <p className="kicker">your tags</p>
          <h1>{user?.name ? `Hello, ${user.name.split(' ')[0]}.` : 'Your luggage'}</h1>
        </div>
        <div className="row">
          {nfcSupported() && (tags?.length ?? 0) > 0 && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={identify}
              disabled={identifying}
            >
              <NfcWaves active={identifying} />
              <BusyLabel busy={identifying} idle="Identify a tag" working="Hold it against the phone…" />
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={createTag} disabled={creating}>
            <motion.svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              aria-hidden="true"
              // The plus turns while the tag is being made, and settles back after.
              animate={{ rotate: creating ? 180 : 0, scale: creating ? 0.85 : 1 }}
              transition={creating ? { duration: 0.6, repeat: Infinity, ease: 'linear' } : { type: 'spring', stiffness: 300, damping: 18 }}
            >
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </motion.svg>
            {creating ? 'Adding…' : 'Add a tag'}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {error && <Notice key="error">{error}</Notice>}
        {identifyNote && (
          <Notice key={`identify-${identifyNote.text}`} kind={identifyNote.kind}>
            {identifyNote.text}
          </Notice>
        )}
      </AnimatePresence>

      {!user?.email_verified && (
        <Notice kind="warn">
          Confirm your email address to mark a bag lost. That is the only action that shows your
          name to a stranger, so it needs a confirmed address behind it.
        </Notice>
      )}

      <AnimatePresence>
        {lostCount > 0 && (
          <Notice kind="warn" key="lost">
            {lostCount === 1 ? 'One bag is' : `${lostCount} bags are`} marked lost.{' '}
            {broadcasting > 0
              ? `Your name is visible to anyone who scans ${
                  broadcasting === 1 ? 'it' : 'them'
                }.`
              : 'A finder can message you; your name is released when you reply.'}
          </Notice>
        )}
      </AnimatePresence>

      {tags === null ? (
        <PageLoader
          label="Loading your tags"
          captions={['Reading your tags…', 'Matching the pattern…', 'Almost there…']}
        />
      ) : tags.length === 0 ? (
        <motion.div
          className="card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 24 }}
        >
          <Empty title="No tags yet">
            <div style={{ width: 110, margin: '4px auto 16px' }}>
              <SwingingTag>
                <TagArt design={FALLBACK_DESIGN} crest title="An empty tag, waiting for a design" />
              </SwingingTag>
            </div>
            <p className="muted">
              Add your first tag to get a design and a printable PDF at the exact size your
              supplier asks for.
            </p>
            <button type="button" className="btn btn--primary" onClick={createTag} disabled={creating}>
              {creating ? 'Adding…' : 'Add a tag'}
            </button>
          </Empty>
        </motion.div>
      ) : (
        <motion.div className="grid grid--3 grid--tags" layout>
          <AnimatePresence initial={true}>
            {tags.map((tag, index) => {
              const isNew = tag.id === newTagId
              const isIdentified = tag.id === identified
              return (
                <motion.article
                  key={tag.id}
                  ref={(node: HTMLElement | null) => {
                    if (node) cards.current.set(tag.id, node)
                    else cards.current.delete(tag.id)
                  }}
                  className={`tag-card${isIdentified ? ' tag-card--identified' : ''}`}
                  layout
                  // A new tag "prints": it feeds down out of a slot from the
                  // top, then swings on its strap. The rest cascade in on load
                  // and slide aside when one is added.
                  initial={
                    isNew
                      ? { opacity: 0, y: -40, clipPath: 'inset(0% 0% 100% 0%)' }
                      : { opacity: 0, y: 18 }
                  }
                  animate={{ opacity: 1, y: 0, clipPath: 'inset(0% 0% 0% 0%)' }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={
                    isNew
                      ? { duration: 0.9, ease: [0.22, 1, 0.36, 1] }
                      : { type: 'spring', stiffness: 240, damping: 26, delay: Math.min(index, 8) * 0.06 }
                  }
                  onAnimationComplete={() => {
                    if (isNew) setNewTagId(null)
                  }}
                >
                  <Link to={`/app/tags/${tag.id}`} className="tag-card__art" style={{ display: 'block' }}>
                    <SwingingTag sway={isNew} delay={isNew ? 0.55 : 0} excited={isIdentified}>
                      <motion.div
                        className="lift"
                        whileHover={{ rotate: -1.5 }}
                        whileTap={{ scale: 0.97 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                      >
                        <TagArt
                          design={tag.design}
                          name={user?.name ?? null}
                          subtitle={tag.label}
                          icon={tag.icon}
                          iconColor={tag.icon_color}
                          title={`${tag.label ?? 'Tag'} — ${describe(tag.design)}`}
                        />
                      </motion.div>
                    </SwingingTag>
                  </Link>
                  <div className="row row--between">
                    <Link to={`/app/tags/${tag.id}`} style={{ fontWeight: 600, textDecoration: 'none' }}>
                      {tag.label ?? 'Untitled tag'}
                    </Link>
                    <StatusPill status={tag.status} />
                  </div>
                  <p className="faint" style={{ margin: 0 }}>
                    {tag.last_scan_at
                      ? `Last scanned ${relativeTime(tag.last_scan_at)} · ${tag.scan_count} total`
                      : `Never scanned · added ${formatDate(tag.created_at)}`}
                  </p>
                </motion.article>
              )
            })}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  )
}

/** Three arcs radiating from a phone: the NFC field, pulsing while it reads. */
function NfcWaves({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="btn__icon">
      {[0, 1, 2].map((index) => (
        <motion.path
          key={index}
          d={['M9 8a6 6 0 0 1 0 8', 'M13 5a11 11 0 0 1 0 14', 'M17 2a16 16 0 0 1 0 20'][index]}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          animate={active ? { opacity: [0.25, 1, 0.25] } : { opacity: 1 }}
          transition={
            active
              ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: index * 0.18 }
              : { duration: 0.2 }
          }
        />
      ))}
      <circle cx="5.5" cy="12" r="1.7" fill="currentColor" />
    </svg>
  )
}
