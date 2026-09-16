import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, type RelayThread, type ThreadSummary } from '../api/client'
import { Empty, Field, Notice, Spinner } from '../components/ui'
import { formatDateTime, relativeTime } from '../lib/design'

export function Inbox() {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null)
  const [openThread, setOpenThread] = useState<RelayThread | null>(null)
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadThreads = useCallback(async () => {
    try {
      const body = await api.get<{ threads: ThreadSummary[] }>('/threads')
      setThreads(body.threads)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load your inbox.')
      setThreads([])
    }
  }, [])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  async function open(threadId: string) {
    setError(null)
    try {
      const body = await api.get<{ thread: RelayThread }>(`/threads/${threadId}`)
      setOpenThread(body.thread)
      await loadThreads()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not open that conversation.')
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (!openThread || !reply.trim()) return
    setBusy(true)
    try {
      const body = await api.post<{ thread: RelayThread }>(`/threads/${openThread.id}/reply`, {
        body: reply.trim(),
      })
      setOpenThread(body.thread)
      setReply('')
      await loadThreads()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not send that message.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page wrap">
      <div className="page__head">
        <p className="kicker">inbox</p>
        <h1>Messages from finders</h1>
        <p className="lede">
          Replies are relayed. The person who found your bag never sees your email address or phone
          number, and you never see theirs unless they choose to include it.
        </p>
      </div>

      {error && <Notice>{error}</Notice>}

      {threads === null ? (
        <Spinner label="Loading messages" />
      ) : threads.length === 0 ? (
        <div className="card">
          <Empty title="No messages">
            <p className="muted">
              When someone scans a bag you have marked lost, their message arrives here.
            </p>
          </Empty>
        </div>
      ) : (
        <div className="grid grid--split" style={{ alignItems: 'start' }}>
          <ul className="list card">
            {threads.map((thread) => (
              <li key={thread.id} className="list__item">
                <button
                  type="button"
                  className="btn btn--quiet"
                  style={{ textAlign: 'left', flex: 1, display: 'block', fontWeight: 400 }}
                  onClick={() => open(thread.id)}
                >
                  <strong>
                    {thread.tag_label ?? 'A tag'}
                    {thread.unread && (
                      <span className="pill pill--lost" style={{ marginLeft: 8, fontSize: 11 }}>
                        new
                      </span>
                    )}
                  </strong>
                  <br />
                  <span className="faint">{thread.preview ?? 'No messages'}</span>
                  <br />
                  <span className="faint">
                    {formatDateTime(thread.last_message_at)} · expires{' '}
                    {relativeTime(thread.expires_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <section className="card">
            {openThread ? (
              <>
                <div className="row row--between" style={{ marginBottom: 14 }}>
                  <h3 style={{ margin: 0 }}>Conversation</h3>
                  <span className="faint">expires {relativeTime(openThread.expires_at)}</span>
                </div>
                {openThread.finder_contact && (
                  <Notice kind="info">
                    They left a way to reach them: {openThread.finder_contact}
                  </Notice>
                )}
                <div className="thread" style={{ marginBottom: 16 }}>
                  {openThread.messages.map((message) => (
                    <div
                      key={message.id}
                      className={`msg ${message.mine ? 'msg--mine' : 'msg--theirs'}`}
                    >
                      {message.body}
                      <div className="msg__meta">
                        {message.from === 'owner' ? 'You' : 'Finder'} ·{' '}
                        {formatDateTime(message.at)}
                      </div>
                    </div>
                  ))}
                </div>

                {openThread.closed ? (
                  <Notice kind="warn">
                    This conversation is closed. It was ended when the tag&#8217;s code was
                    rotated.
                  </Notice>
                ) : (
                  <form onSubmit={send}>
                    <Field
                      label="Reply"
                      name="reply"
                      value={reply}
                      onChange={setReply}
                      multiline
                      maxLength={2000}
                      placeholder="Thank you — where can I collect it?"
                    />
                    <button
                      type="submit"
                      className="btn btn--primary"
                      disabled={busy || !reply.trim()}
                    >
                      {busy ? 'Sending…' : 'Send reply'}
                    </button>
                  </form>
                )}
              </>
            ) : (
              <Empty title="Pick a conversation">
                <p className="muted">Choose a message on the left to read and reply.</p>
              </Empty>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
