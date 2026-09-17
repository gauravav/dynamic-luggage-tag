import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, type RelayThread, type ThreadSummary } from '../api/client'
import { SendLabel } from '../components/motion'
import { PageLoader } from '../components/PageLoader'
import { Empty, Field, Notice } from '../components/ui'
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

      <AnimatePresence>{error && <Notice key={error}>{error}</Notice>}</AnimatePresence>

      {threads === null ? (
        <PageLoader
          label="Loading your inbox"
          captions={['Opening your inbox…', 'Decrypting your messages…']}
        />
      ) : threads.length === 0 ? (
        <div className="card">
          <Empty title="No messages">
            <p className="muted">
              When someone scans a bag you have marked lost, their message arrives here.
            </p>
          </Empty>
        </div>
      ) : (
        <div
          className={`grid grid--split inbox${openThread ? ' inbox--reading' : ''}`}
          style={{ alignItems: 'start' }}
        >
          <ul className="list card inbox__list">
            {threads.map((thread, index) => (
              <motion.li
                key={thread.id}
                className="list__item"
                initial={{ opacity: 0, x: -14 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(index, 10) * 0.05, type: 'spring', stiffness: 260, damping: 26 }}
              >
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
              </motion.li>
            ))}
          </ul>

          <section className="card inbox__thread">
            {openThread ? (
              <>
                {/* On a phone the conversation takes over the screen, so it
                    needs its own way back to the list. */}
                <button
                  type="button"
                  className="btn btn--quiet btn--sm mobile-only inbox__back"
                  onClick={() => setOpenThread(null)}
                >
                  ← All messages
                </button>
                <div className="row row--between" style={{ marginBottom: 14 }}>
                  <h3 style={{ margin: 0 }}>Conversation</h3>
                  <span className="faint">expires {relativeTime(openThread.expires_at)}</span>
                </div>
                {openThread.finder_contact && (
                  <Notice kind="info">
                    They left a way to reach them: {openThread.finder_contact}
                  </Notice>
                )}
                {openThread.email_updates && !openThread.closed && (
                  <p className="faint">
                    They get an email when you reply. Their address stays hidden from you.
                  </p>
                )}
                <div className="thread" style={{ marginBottom: 16 }}>
                  <AnimatePresence initial={false}>
                    {openThread.messages.map((message, index) => (
                      <motion.div
                        key={message.id}
                        layout
                        className={`msg ${message.mine ? 'msg--mine' : 'msg--theirs'}`}
                        // Each bubble arrives from its own side of the thread.
                        initial={{ opacity: 0, x: message.mine ? 28 : -28, scale: 0.94 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 26, delay: Math.min(index, 8) * 0.04 }}
                      >
                        {message.body}
                        <div className="msg__meta">
                          {message.from === 'owner' ? 'You' : 'Finder'} ·{' '}
                          {formatDateTime(message.at)}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
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
                      <SendLabel busy={busy} idle="Send reply" working="Sending…" />
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
