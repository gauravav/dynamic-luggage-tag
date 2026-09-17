/**
 * The finder's side of a relayed conversation.
 *
 * Reachable with the relay token alone — no account, no sign-in. The token is
 * the entire credential, which is why it is 256 bits of randomness and why the
 * thread expires on its own.
 */

import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ApiError, api, type RelayThread } from '../api/client'
import { SendLabel, Skeleton } from '../components/motion'
import { Field, Notice } from '../components/ui'
import { formatDateTime, relativeTime } from '../lib/design'

export function RelayPage() {
  const { token } = useParams<{ token: string }>()
  const [thread, setThread] = useState<RelayThread | null>(null)
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const body = await api.get<{ thread: RelayThread }>(`/relay/${encodeURIComponent(token)}`)
      setThread(body.thread)
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 404
          ? 'This conversation is no longer available.'
          : 'Could not open this conversation.',
      )
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (!token || !reply.trim()) return
    setBusy(true)
    setError(null)
    try {
      const body = await api.post<{ thread: RelayThread }>(
        `/relay/${encodeURIComponent(token)}/reply`,
        { body: reply.trim() },
      )
      setThread(body.thread)
      setReply('')
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not send that message.')
    } finally {
      setBusy(false)
    }
  }

  async function stopEmails() {
    if (!token) return
    setBusy(true)
    setError(null)
    try {
      const body = await api.delete<{ thread: RelayThread }>(
        `/relay/${encodeURIComponent(token)}/email`,
      )
      setThread(body.thread)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not turn off email updates.')
    } finally {
      setBusy(false)
    }
  }

  if (error && !thread) {
    return (
      <div className="page wrap wrap--narrow center">
        <h1 style={{ fontSize: 24, marginBottom: 10 }}>This conversation has ended</h1>
        <p className="muted">
          Conversations expire on their own, and the owner can close one at any time.
        </p>
      </div>
    )
  }

  if (!thread) {
    return (
      <div className="page wrap wrap--narrow" aria-busy="true" aria-label="Opening the conversation">
        <Skeleton height={26} width="60%" />
        <Skeleton height={200} radius={12} style={{ marginTop: 18 }} />
      </div>
    )
  }

  return (
    <div className="page wrap wrap--narrow">
      <p className="kicker">relayed conversation</p>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>You and the owner</h1>
      <p className="faint" style={{ marginBottom: 24 }}>
        Neither side sees the other&#8217;s phone number or email address. This conversation is
        deleted {relativeTime(thread.expires_at)}.
      </p>

      {error && <Notice>{error}</Notice>}

      {thread.email_updates && (
        <div className="row row--between panel" style={{ marginBottom: 16 }}>
          <span className="faint">We email you when the owner replies.</span>
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            onClick={stopEmails}
            disabled={busy}
          >
            Stop email updates
          </button>
        </div>
      )}

      <div className="card">
        <div className="thread" style={{ marginBottom: thread.closed ? 0 : 18 }}>
          <AnimatePresence initial={false}>
            {thread.messages.map((message, index) => (
              <motion.div
                key={message.id}
                layout
                className={`msg ${message.mine ? 'msg--mine' : 'msg--theirs'}`}
                initial={{ opacity: 0, x: message.mine ? 28 : -28, scale: 0.94 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 26, delay: Math.min(index, 8) * 0.05 }}
              >
                {message.body}
                <div className="msg__meta">
                  {message.from === 'finder' ? 'You' : 'The owner'} · {formatDateTime(message.at)}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {thread.closed ? (
          <Notice kind="warn">
            The owner has closed this conversation. Thank you for helping.
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
            />
            <button type="submit" className="btn btn--primary" disabled={busy || !reply.trim()}>
              <SendLabel busy={busy} />
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
