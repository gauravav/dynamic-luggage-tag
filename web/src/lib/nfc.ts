/**
 * Web NFC, as far as this app needs it.
 *
 * Only Chrome on Android implements it. Everywhere else `nfcSupported()` is
 * false and the UI explains that instead. Reading a written tag needs none of
 * this: every NFC phone, iPhone included, opens a URL record on its own.
 */

interface NdefRecord {
  recordType: string
  data?: DataView
}

interface NdefReadingEvent extends Event {
  serialNumber: string
  message: { records: NdefRecord[] }
}

interface NdefReader extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>
  write(
    message: { records: { recordType: string; data: string }[] },
    options?: { overwrite?: boolean; signal?: AbortSignal },
  ): Promise<void>
}

declare global {
  interface Window {
    NDEFReader?: new () => NdefReader
  }
}

const TIMEOUT_MS = 60_000

export interface ChipReading {
  /** Factory serial of the chip, e.g. "04:a2:3b:1c:5d:80:00". */
  serial: string
  /** The first URL record on the chip, if any. */
  url: string | null
}

export class NfcError extends Error {}

export function nfcSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.NDEFReader === 'function'
}

function reader(): NdefReader {
  if (!window.NDEFReader) throw new NfcError('This browser cannot use NFC. Use Chrome on Android.')
  return new window.NDEFReader()
}

function explain(cause: unknown): Error {
  if (cause instanceof NfcError) return cause
  const name = (cause as DOMException | undefined)?.name
  switch (name) {
    case 'NotAllowedError':
      return new NfcError('NFC permission was denied. Allow it in the site settings and try again.')
    case 'NotSupportedError':
      return new NfcError('NFC is unavailable. Check that NFC is turned on in your phone settings.')
    case 'AbortError':
      return new NfcError('No tag was detected. Try again and hold the tag still against the phone.')
    case 'NetworkError':
    case 'NotReadableError':
      return new NfcError('The tag moved away too soon. Hold it still against the phone and try again.')
    default:
      return new NfcError('Could not talk to the NFC tag. Try again.')
  }
}

function withTimeout(): AbortController {
  const controller = new AbortController()
  window.setTimeout(() => controller.abort(), TIMEOUT_MS)
  return controller
}

/** Waits for one tag tap and reports its serial and URL. */
export async function readChip(): Promise<ChipReading> {
  const ndef = reader()
  const controller = withTimeout()
  try {
    return await new Promise<ChipReading>((resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason))
      ndef.addEventListener('readingerror', () => reject(new DOMException('', 'NotReadableError')))
      ndef.addEventListener('reading', (event) => {
        const { serialNumber, message } = event as NdefReadingEvent
        if (!serialNumber) {
          reject(new NfcError('This tag does not report a serial number, so it cannot be linked.'))
          return
        }
        const record = message.records.find(
          (r) => r.recordType === 'url' || r.recordType === 'absolute-url',
        )
        const url = record?.data ? new TextDecoder().decode(record.data) : null
        resolve({ serial: serialNumber, url })
      })
      ndef.scan({ signal: controller.signal }).catch(reject)
    })
  } catch (cause) {
    throw explain(cause)
  } finally {
    // Stop scanning, or Android keeps the tag for this page and a later
    // write would race with the reading listener.
    controller.abort()
  }
}

/** Writes a single URL record to the tag currently held against the phone. */
export async function writeUrl(url: string): Promise<void> {
  const controller = withTimeout()
  try {
    await reader().write(
      { records: [{ recordType: 'url', data: url }] },
      { overwrite: true, signal: controller.signal },
    )
  } catch (cause) {
    throw explain(cause)
  } finally {
    controller.abort()
  }
}
