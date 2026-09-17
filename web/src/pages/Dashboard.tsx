import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api, type Tag } from '../api/client'
import { SwingingTag } from '../components/illustrations'
import { Skeleton } from '../components/motion'
import { TagArt } from '../components/TagArt'
import { Empty, Notice, StatusPill } from '../components/ui'
import { FALLBACK_DESIGN, describe, formatDate, relativeTime } from '../lib/design'
import { useSession } from '../state/session'

export function Dashboard() {
  const { user } = useSession()
  const [tags, setTags] = useState<Tag[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // The tag just created, so only it plays the "printing" entrance.
  const [newTagId, setNewTagId] = useState<string | null>(null)

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

  const lostCount = tags?.filter((tag) => tag.status === 'lost').length ?? 0

  return (
    <div className="page wrap">
      <div className="page__head row row--between">
        <div>
          <p className="kicker">your tags</p>
          <h1>{user?.name ? `Hello, ${user.name.split(' ')[0]}.` : 'Your luggage'}</h1>
        </div>
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

      <AnimatePresence>{error && <Notice key="error">{error}</Notice>}</AnimatePresence>

      {!user?.email_verified && (
        <Notice kind="warn">
          Confirm your email address to mark a bag lost. That is the only action that shows your
          name to a stranger, so it needs a confirmed address behind it.
        </Notice>
      )}

      <AnimatePresence>
        {lostCount > 0 && (
          <Notice kind="warn" key="lost">
            {lostCount === 1 ? 'One bag is' : `${lostCount} bags are`} marked lost. Your name and a
            message link are visible to anyone who scans {lostCount === 1 ? 'it' : 'them'}.
          </Notice>
        )}
      </AnimatePresence>

      {tags === null ? (
        <div className="grid grid--3" aria-busy="true" aria-label="Loading your tags">
          {[0, 1, 2].map((index) => (
            <div key={index} className="tag-card">
              <Skeleton height={0} style={{ paddingBottom: '146%' }} radius={10} />
              <Skeleton height={18} width="60%" />
              <Skeleton height={13} width="80%" />
            </div>
          ))}
        </div>
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
        <motion.div className="grid grid--3" layout>
          <AnimatePresence initial={true}>
            {tags.map((tag, index) => {
              const isNew = tag.id === newTagId
              return (
                <motion.article
                  key={tag.id}
                  className="tag-card"
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
                    <SwingingTag sway={isNew} delay={isNew ? 0.55 : 0}>
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
