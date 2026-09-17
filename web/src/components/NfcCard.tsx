import { useState } from 'react'
import { ApiError, api, type Tag } from '../api/client'
import { formatDateTime } from '../lib/design'
import { NfcError, nfcSupported, readChip, writeUrl } from '../lib/nfc'
import { Field, Notice } from './ui'

type Phase = 'idle' | 'waiting' | 'working'

interface Result {
  kind: 'info' | 'warn' | 'error'
  text: string
}

type Lookup =
  | { registered: 'none' }
  | { registered: 'other' }
  | { registered: 'mine'; tag: Tag }

/** Errors where the server asks the owner to confirm before it rebinds. */
const CONFIRMABLE = new Set(['nfc_chip_on_other_tag', 'nfc_tag_has_other_chip'])

function message(cause: unknown, fallback: string): string {
  return cause instanceof ApiError || cause instanceof NfcError ? cause.message : fallback
}

export function NfcCard({ tag, onChange }: { tag: Tag; onChange: (tag: Tag) => void }) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<Result | null>(null)
  const supported = nfcSupported()
  const busy = phase !== 'idle'

  async function write() {
    if (!tag.scan_url) return
    setResult(null)
    setPhase('waiting')
    try {
      const chip = await readChip()
      setPhase('working')

      // Link the chip to this tag first. The server refuses a chip that is
      // registered to another account, so nothing is written to it.
      const bound = await link(chip.serial)
      if (!bound) return
      onChange(bound)

      if (chip.url !== tag.scan_url) {
        setPhase('waiting')
        await writeUrl(tag.scan_url)
      }
      setResult({
        kind: 'info',
        text: 'Done. The NFC tag now opens this tag’s page on any phone that taps it.',
      })
    } catch (cause) {
      setResult({ kind: 'error', text: message(cause, 'Could not write the NFC tag.') })
    } finally {
      setPhase('idle')
    }
  }

  /**
   * Claims a chip serial for this tag, asking first where the server wants it.
   *
   * Returns null when the owner declined, so the caller stops rather than
   * writing to a sticker it has not been allowed to take.
   */
  async function link(serial: string): Promise<Tag | null> {
    try {
      return (await api.post<{ tag: Tag }>(`/tags/${tag.id}/nfc`, { serial })).tag
    } catch (cause) {
      if (!(cause instanceof ApiError && CONFIRMABLE.has(cause.code))) throw cause
      if (!window.confirm(cause.message)) {
        setResult({ kind: 'info', text: 'Nothing was changed.' })
        return null
      }
      return (await api.post<{ tag: Tag }>(`/tags/${tag.id}/nfc`, { serial, replace: true })).tag
    }
  }

  async function verify() {
    setResult(null)
    setPhase('waiting')
    try {
      const chip = await readChip()
      setPhase('working')
      const found = await api.post<Lookup>('/tags/nfc/lookup', { serial: chip.serial })

      if (found.registered === 'none') {
        setResult({ kind: 'warn', text: 'This NFC tag is not linked to any account.' })
      } else if (found.registered === 'other') {
        setResult({ kind: 'error', text: 'This NFC tag is registered to another account.' })
      } else if (chip.url !== found.tag.scan_url) {
        setResult({
          kind: 'warn',
          text: `This is your NFC tag for “${found.tag.label ?? 'Untitled tag'}”, but it no longer points to the right link. It may have been overwritten. Write it again from that tag’s page.`,
        })
      } else if (found.tag.id !== tag.id) {
        setResult({
          kind: 'info',
          text: `This NFC tag belongs to your other tag, “${found.tag.label ?? 'Untitled tag'}”, and is working.`,
        })
      } else {
        setResult({ kind: 'info', text: 'This NFC tag is linked to this tag and is working.' })
      }
    } catch (cause) {
      setResult({ kind: 'error', text: message(cause, 'Could not check the NFC tag.') })
    } finally {
      setPhase('idle')
    }
  }

  async function unlink() {
    const confirmed = window.confirm(
      'Unlink the NFC sticker? It keeps working until it is overwritten, but anyone could then link and write it through this site.',
    )
    if (!confirmed) return
    setResult(null)
    setPhase('working')
    try {
      onChange((await api.delete<{ tag: Tag }>(`/tags/${tag.id}/nfc`)).tag)
      setResult({ kind: 'info', text: 'NFC sticker unlinked.' })
    } catch (cause) {
      setResult({ kind: 'error', text: message(cause, 'Could not unlink the NFC sticker.') })
    } finally {
      setPhase('idle')
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: 10 }}>NFC sticker</h3>
      <p className="faint">
        {tag.nfc_linked && tag.nfc_linked_at
          ? `A sticker has been linked to your account since ${formatDateTime(tag.nfc_linked_at)}. Only you can rewrite it here, from any phone you sign in on.`
          : 'Write this tag’s link to an NFC sticker (NTAG213/215/216) and stick it on the circle marked on the back of the tag. Any phone can then open it with a tap.'}
      </p>

      {phase === 'waiting' && (
        <Notice kind="info">Hold the NFC tag against the back of your phone…</Notice>
      )}
      {result && <Notice kind={result.kind}>{result.text}</Notice>}

      {supported ? (
        <div className="stack stack--tight">
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={write}
            disabled={busy || !tag.scan_url}
          >
            {tag.nfc_linked ? 'Rewrite NFC tag' : 'Write to NFC tag'}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--block btn--sm"
            onClick={verify}
            disabled={busy}
          >
            Check an NFC tag
          </button>
        </div>
      ) : (
        <WriteElsewhere
          tag={tag}
          busy={busy}
          onLink={async (serial) => {
            setResult(null)
            setPhase('working')
            try {
              const bound = await link(serial)
              if (bound) {
                onChange(bound)
                setResult({ kind: 'info', text: 'Sticker linked to this tag.' })
              }
            } catch (cause) {
              setResult({ kind: 'error', text: message(cause, 'Could not link that sticker.') })
            } finally {
              setPhase('idle')
            }
          }}
        />
      )}
      {tag.nfc_linked && (
        <button
          type="button"
          className="btn btn--ghost btn--block btn--sm"
          style={{ marginTop: 8 }}
          onClick={unlink}
          disabled={busy}
        >
          Unlink sticker
        </button>
      )}
    </div>
  )
}

/**
 * Writing the sticker from somewhere other than this browser.
 *
 * Only Chrome on Android implements Web NFC. iPhones can write NFC tags — the
 * hardware has been able to since the iPhone 7, and iOS has exposed it to apps
 * since iOS 13 — but Safari has no API for it, so it has to be done from an
 * app. Two are worth naming: they are the long-standing ones, they write a
 * plain URL record, and neither needs an account.
 *
 * Nothing about that is less safe than writing from here: the record is a URL,
 * and it is the same URL either way. What the app cannot do is tell this site
 * which chip it wrote, which is the check that stops someone else claiming the
 * sticker later — so the serial can be entered by hand afterwards.
 */
function WriteElsewhere({
  tag,
  busy,
  onLink,
}: {
  tag: Tag
  busy: boolean
  onLink: (serial: string) => Promise<void>
}) {
  const [copied, setCopied] = useState(false)
  const [serial, setSerial] = useState('')
  const [showSerial, setShowSerial] = useState(false)

  async function copy() {
    if (!tag.scan_url) return
    try {
      await navigator.clipboard.writeText(tag.scan_url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2400)
    } catch {
      // Clipboard access can be refused; the link is on screen to select.
      setCopied(false)
    }
  }

  return (
    <div className="stack stack--tight">
      <p className="faint" style={{ marginBottom: 0 }}>
        This browser cannot write NFC tags — only Chrome on Android can. On an iPhone, use{' '}
        <strong>NFC Tools</strong> (wakdev) or <strong>NFC TagWriter by NXP</strong>: choose Write,
        then Add a record, then Link or URL, and paste the link below.
      </p>

      <div className="code-block" style={{ overflowWrap: 'anywhere' }}>
        {tag.scan_url ?? '—'}
      </div>
      <button
        type="button"
        className="btn btn--primary btn--block btn--sm"
        onClick={copy}
        disabled={!tag.scan_url}
      >
        {copied ? 'Link copied' : 'Copy the link'}
      </button>

      {showSerial ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void onLink(serial.trim()).then(() => setSerial(''))
          }}
        >
          <Field
            label="Chip serial number"
            name="serial"
            value={serial}
            onChange={setSerial}
            placeholder="04:A2:3B:1C:5D:80:00"
            maxLength={64}
            hint="Both apps show it after reading the sticker — NFC Tools lists it as Serial number. Linking it is what stops anyone else claiming this sticker through this site."
          />
          <button
            type="submit"
            className="btn btn--ghost btn--block btn--sm"
            disabled={busy || serial.trim().length < 8}
          >
            Link this sticker
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="btn btn--quiet btn--block btn--sm"
          onClick={() => setShowSerial(true)}
        >
          I wrote it from an app — link it to this tag
        </button>
      )}
    </div>
  )
}
