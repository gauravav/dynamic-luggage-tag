/**
 * Pre-issuing tags, for the operator.
 *
 * The workflow this exists for: somebody orders a tag, the operator issues a
 * code addressed to them, prints it, and posts it. The buyer signs up
 * afterwards and the tag is already in their account, carrying the artwork
 * that was printed on it.
 *
 * Everything on this page is about codes. There is no user list, no way into
 * anyone's tags, and addresses are shown masked — the operator typed them, so
 * this is not about keeping them secret, it is about not turning a page left
 * open on a desk into a customer list. The server enforces all of that; this
 * component only declines to ask for what it is not allowed.
 */

import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, api, downloadAsset, type DesignSpec } from '../api/client'
import { PageLoader } from '../components/PageLoader'
import { TagArt } from '../components/TagArt'
import { BusyLabel, Stagger, StaggerItem } from '../components/motion'
import { Empty, Field, Notice } from '../components/ui'
import { formatDateTime } from '../lib/design'

interface Claim {
  id: string
  email: string | null
  icon: string | null
  icon_color: string | null
  created_at: string
  invite_sent_at: string | null
  claimed: boolean
  claimed_at: string | null
  design: DesignSpec
  /** Returned once, on creation, so the tag can be printed. */
  scan_url?: string
}

interface Summary {
  outstanding: number
  claimed: number
}

export function Admin() {
  const [claims, setClaims] = useState<Claim[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The label rides along: the server seals it and never returns it, and the
  // form that held it is cleared the moment the code is issued.
  const [issued, setIssued] = useState<
    (Claim & { label: string | null; name: string }) | null
  >(null)
  const [busy, setBusy] = useState(false)

  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [sent, setSent] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, counts] = await Promise.all([
        api.get<{ claims: Claim[] }>('/admin/claims'),
        api.get<Summary>('/admin/summary'),
      ])
      setClaims(list.claims)
      setSummary(counts)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not load issued codes.')
      setClaims([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function issue(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = await api.post<{ claim: Claim }>('/admin/claims', {
        email: email.trim(),
        name: name.trim(),
        label: label.trim() || null,
      })
      // Held on screen rather than in the list: the scan URL comes back once,
      // and this is the only moment the operator can print from it.
      setIssued({ ...body.claim, label: label.trim() || null, name: name.trim() })
      // Not "on its way to <address>": this page masks addresses, and a
      // confirmation is no reason to put one back on screen.
      setSent(
        body.claim.invite_sent_at
          ? 'An invitation is on its way to that address.'
          : 'That address already has an account, so no invitation was sent — the tag appears the next time they open their tags.',
      )
      setEmail('')
      setName('')
      setLabel('')
      await load()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not issue that code.')
    } finally {
      setBusy(false)
    }
  }

  async function withdraw(claim: Claim) {
    if (!window.confirm('Withdraw this code? It stops working immediately.')) return
    setError(null)
    try {
      await api.delete(`/admin/claims/${claim.id}`)
      if (issued?.id === claim.id) setIssued(null)
      await load()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not withdraw that code.')
    }
  }

  /**
   * The printable tag, in one of its two forms.
   *
   * `trim` overlays the trim and safety rectangles. It is for checking what
   * the cut will take off before an order goes out — never the file that goes
   * to the press, which is why it downloads under its own name.
   */
  async function print(claim: Claim, trim = false) {
    setError(null)
    try {
      await downloadAsset(
        `/admin/claims/${claim.id}/print.pdf${trim ? '?guides=1' : ''}`,
        `tag-${claim.id}${trim ? '-trim' : ''}.pdf`,
      )
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not prepare that file.')
    }
  }

  async function invite(claim: Claim) {
    setError(null)
    setSent(null)
    try {
      await api.post(`/admin/claims/${claim.id}/invite`, {})
      setSent('The invitation has been sent again, on a new link. The old one no longer works.')
      await load()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not send that invitation.')
    }
  }

  return (
    <div className="page wrap">
      <div className="page__head row row--between">
        <div>
          <p className="kicker">operator</p>
          <h1>Issue a tag</h1>
        </div>
        {summary && (
          <p className="faint" style={{ margin: 0, textAlign: 'right' }}>
            {summary.outstanding} waiting to be claimed
            <br />
            {summary.claimed} claimed
          </p>
        )}
      </div>

      <AnimatePresence>{error && <Notice key={error}>{error}</Notice>}</AnimatePresence>

      <AnimatePresence>
        {sent && (
          <Notice key={sent} kind="info">
            {sent}
          </Notice>
        )}
      </AnimatePresence>

      <p className="muted" style={{ maxWidth: '62ch' }}>
        Create a code addressed to a buyer, print it, and post it. They are invited by email to
        create the account it belongs to, with their address and the name on the tag already
        filled in. If they already have an account, the tag appears the next time they open their
        tags.
      </p>

      <div className="grid grid--split" style={{ alignItems: 'start', marginTop: 24 }}>
        <section className="card">
          <h3 style={{ marginBottom: 14 }}>New code</h3>
          <form onSubmit={issue}>
            <Field
              label="Buyer’s email address"
              name="claim_email"
              type="email"
              value={email}
              onChange={setEmail}
              required
              hint="The invitation goes here, and it is the address they sign up with. Stored encrypted, and shown masked here afterwards."
            />
            <Field
              label="Buyer’s name"
              name="claim_name"
              value={name}
              onChange={setName}
              maxLength={120}
              required
              hint="Printed on the tag, so it is settled here rather than by them. Their account starts out under this name."
            />
            <Field
              label="Label (optional)"
              name="claim_label"
              value={label}
              onChange={setLabel}
              maxLength={80}
              hint="Printed small on the tag. The owner can change it later."
            />
            {/* No bag icon here. It is the owner's to choose once they have an
                account, and a guess made for them would be on a printed tag
                they cannot change. */}
            <button
              type="submit"
              className="btn btn--primary"
              style={{ marginTop: 16 }}
              disabled={busy || !email.trim() || !name.trim()}
            >
              <BusyLabel busy={busy} idle="Issue and invite" working="Issuing…" />
            </button>
          </form>
        </section>

        <AnimatePresence mode="wait">
          {issued ? (
            <motion.section
              key={issued.id}
              className="card"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 240, damping: 26 }}
            >
              <h3 style={{ marginBottom: 6 }}>Ready to print</h3>
              <p className="faint">
                This is the only time the code is shown. Print it now — after this, only the owner
                can.
              </p>
              <div style={{ maxWidth: 180, margin: '0 auto 16px' }}>
                <TagArt
                  design={issued.design}
                  name={issued.name}
                  subtitle={issued.label}
                  icon={issued.icon}
                  iconColor={issued.icon_color}
                  title="The tag as it will print"
                />
              </div>
              <div className="code-block" style={{ overflowWrap: 'anywhere' }}>
                {issued.scan_url}
              </div>
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => print(issued)}
              >
                Download print PDF
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                style={{ marginTop: 8 }}
                onClick={() => print(issued, true)}
              >
                Download with trim marks
              </button>
              <p className="faint" style={{ marginTop: 8, marginBottom: 0 }}>
                The trim version draws the cut line and the safe area over the artwork, for
                checking before an order. Send the plain one to the press.
              </p>
            </motion.section>
          ) : (
            <motion.section
              key="empty"
              className="card"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Empty title="Nothing issued yet in this session">
                <p className="muted">
                  A code you issue here appears with its printable tag, once. Anything already
                  issued is listed below.
                </p>
              </Empty>
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      <h2 style={{ fontSize: 22, margin: '44px 0 14px' }}>Issued codes</h2>
      {claims === null ? (
        <PageLoader label="Loading issued codes" captions={['Reading issued codes…']} />
      ) : claims.length === 0 ? (
        <div className="card">
          <Empty title="None yet">
            <p className="muted">Codes you issue will be listed here.</p>
          </Empty>
        </div>
      ) : (
        <Stagger className="stack stack--tight">
          {claims.map((claim) => (
            <StaggerItem key={claim.id}>
              <div className="card row row--between claim-row">
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {claim.email ?? 'Claimed — belongs to its owner'}
                  </p>
                  <p className="faint" style={{ margin: 0 }}>
                    Issued {formatDateTime(claim.created_at)}
                    {claim.claimed_at
                      ? ` · claimed ${formatDateTime(claim.claimed_at)}`
                      : claim.invite_sent_at
                        ? ` · invited ${formatDateTime(claim.invite_sent_at)}`
                        : ''}
                  </p>
                </div>
                <div className="row">
                  <span className={`pill ${claim.claimed ? 'pill--safe' : 'pill--neutral'}`}>
                    <span className="pill__dot" />
                    {claim.claimed ? 'Claimed' : 'Waiting'}
                  </span>
                  {!claim.claimed && (
                    <>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => print(claim)}
                      >
                        Print PDF
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => print(claim, true)}
                      >
                        With trim
                      </button>
                      {/* Nothing to re-invite someone to when the address
                          already had an account: that code was issued without
                          an invitation, and the server refuses to mint one. */}
                      {claim.invite_sent_at && (
                        <button
                          type="button"
                          className="btn btn--quiet btn--sm"
                          onClick={() => invite(claim)}
                        >
                          Invite again
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--quiet btn--sm"
                        onClick={() => withdraw(claim)}
                      >
                        Withdraw
                      </button>
                    </>
                  )}
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  )
}
