import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api, type Tag } from '../api/client'
import { TagArt } from '../components/TagArt'
import { Empty, Notice, Spinner, StatusPill } from '../components/ui'
import { describe, formatDate, relativeTime } from '../lib/design'
import { useSession } from '../state/session'

export function Dashboard() {
  const { user } = useSession()
  const [tags, setTags] = useState<Tag[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

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
      await api.post<{ tag: Tag }>('/tags', { label: null })
      await load()
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
          {creating ? 'Adding…' : 'Add a tag'}
        </button>
      </div>

      {error && <Notice>{error}</Notice>}

      {!user?.email_verified && (
        <Notice kind="warn">
          Confirm your email address to mark a bag lost. That is the only action that shows your
          name to a stranger, so it needs a confirmed address behind it.
        </Notice>
      )}

      {lostCount > 0 && (
        <Notice kind="warn">
          {lostCount === 1 ? 'One bag is' : `${lostCount} bags are`} marked lost. Your name and a
          message link are visible to anyone who scans{' '}
          {lostCount === 1 ? 'it' : 'them'}.
        </Notice>
      )}

      {tags === null ? (
        <Spinner label="Loading your tags" />
      ) : tags.length === 0 ? (
        <div className="card">
          <Empty title="No tags yet">
            <p className="muted">
              Add your first tag to get a design and a printable PDF at the exact size your
              supplier asks for.
            </p>
            <button type="button" className="btn btn--primary" onClick={createTag}>
              Add a tag
            </button>
          </Empty>
        </div>
      ) : (
        <div className="grid grid--3">
          {tags.map((tag) => (
            <article key={tag.id} className="tag-card">
              <Link to={`/app/tags/${tag.id}`} style={{ display: 'block' }}>
                <TagArt
                  design={tag.design}
                  name={user?.name ?? null}
                  subtitle={tag.label}
                  title={`${tag.label ?? 'Tag'} — ${describe(tag.design)}`}
                />
              </Link>
              <div className="row row--between">
                <Link
                  to={`/app/tags/${tag.id}`}
                  style={{ fontWeight: 600, textDecoration: 'none' }}
                >
                  {tag.label ?? 'Untitled tag'}
                </Link>
                <StatusPill status={tag.status} />
              </div>
              <p className="faint" style={{ margin: 0 }}>
                {tag.last_scan_at
                  ? `Last scanned ${relativeTime(tag.last_scan_at)} · ${tag.scan_count} total`
                  : `Never scanned · added ${formatDate(tag.created_at)}`}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
