import { useState } from 'react'
import { ApiError, api, type Tag } from '../api/client'
import { formatDateTime } from '../lib/design'
import { NfcError, nfcSupported, readChip, writeUrl } from '../lib/nfc'
import { Notice } from './ui'

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
      let bound: Tag
      try {
        bound = (await api.post<{ tag: Tag }>(`/tags/${tag.id}/nfc`, { serial: chip.serial })).tag
      } catch (cause) {
        if (!(cause instanceof ApiError && CONFIRMABLE.has(cause.code))) throw cause
        if (!window.confirm(cause.message)) {
          setResult({ kind: 'info', text: 'Nothing was written.' })
          return
        }
        bound = (
          await api.post<{ tag: Tag }>(`/tags/${tag.id}/nfc`, {
            serial: chip.serial,
            replace: true,
          })
        ).tag
      }
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
      <h3 style={{ marginBottom: 10 }}>NFC tag</h3>
      <p className="faint">
        {tag.nfc_linked && tag.nfc_linked_at
          ? `A sticker has been linked to your account since ${formatDateTime(tag.nfc_linked_at)}. Only you can rewrite it here, from any phone you sign in on.`
          : 'Write this tag’s link to an NFC sticker (NTAG213/215/216). Any phone can then open it with a tap.'}
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
        <p className="faint">
          Writing NFC tags needs Chrome on an Android phone. Open this page there to write or check
          a tag.
        </p>
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
