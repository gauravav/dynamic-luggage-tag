/**
 * A TOTP generator for the browser tests.
 *
 * The suite has to behave like a real authenticator: read the secret out of
 * the QR the page shows, and produce the code that secret implies. Without
 * this the two-factor test could only check that a form exists, which is the
 * part least likely to be broken.
 *
 * RFC 6238 with the defaults every app uses — SHA-1, 6 digits, 30 seconds.
 */

import { createHmac } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** RFC 4648 base32, as authenticator secrets are written. */
export function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/[\s=]/g, '').toUpperCase()
  let bits = ''
  for (const character of clean) {
    const value = ALPHABET.indexOf(character)
    if (value === -1) throw new Error(`not base32: ${character}`)
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2))
  }
  return Buffer.from(bytes)
}

export function totp(secret: string, at: number = Date.now()): string {
  const counter = Math.floor(at / 1000 / 30)
  const message = Buffer.alloc(8)
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  message.writeUInt32BE(counter >>> 0, 4)

  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest()
  const offset = digest[digest.length - 1]! & 0x0f
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!
  return String(binary % 1_000_000).padStart(6, '0')
}

/** The secret an otpauth:// provisioning URI carries. */
export function secretFromUri(uri: string): string {
  const parameter = new URL(uri).searchParams.get('secret')
  if (!parameter) throw new Error(`no secret in ${uri}`)
  return parameter
}
