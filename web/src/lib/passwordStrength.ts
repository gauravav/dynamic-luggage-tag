/**
 * Password strength, for the meter on the sign-up and change-password forms.
 *
 * Two layers:
 *
 * 1. `policyProblem()` is a line-for-line port of `check_password_policy()` in
 *    `api/app/security/passwords.py`. Anything it flags, the server rejects,
 *    so the meter can never show "strong" for a password that will bounce.
 *    `api/tests/test_password_meter_parity.py` runs both over the same
 *    candidates and fails if they disagree.
 *
 * 2. `strength()` grades what the policy accepts, by a conservative entropy
 *    estimate. That part is advisory only — the server has no opinion on it.
 *
 * Kept to syntax Node runs with type stripping alone, so the parity test can
 * execute this file directly.
 */

export const MIN_LENGTH = 12
const MAX_LENGTH = 1024

// api/app/security/passwords.py _OBVIOUS
const OBVIOUS = new Set([
  'password', 'passw0rd', 'letmein', 'welcome', 'iloveyou', 'admin', 'qwerty',
  'qwertyuiop', '123456', '1234567890', '111111', 'abc123', 'monkey', 'dragon',
  'sunshine', 'princess', 'football', 'baseball', 'trustno1', 'changeme', 'secret',
  'starwars', 'whatever', 'luggage', 'luggagetag', 'dynamicluggagetag',
])

export type Level = 'empty' | 'weak' | 'medium' | 'strong' | 'excellent'

export interface Strength {
  level: Level
  /** 0-1, for a progress bar. */
  score: number
  /** Why it is weak, in the server's own words; null once acceptable. */
  problem: string | null
}

/** Python's str.casefold(), close enough for the ASCII-heavy cases that matter. */
function casefold(value: string): string {
  return value.toLowerCase().replace(/ß/g, 'ss')
}

/** Python's len(): code points, not UTF-16 units. */
function codePoints(value: string): string[] {
  return Array.from(value)
}

/** Python's str.strip(chars) for a set of characters. */
function stripChars(value: string, chars: string): string {
  let start = 0
  let end = value.length
  while (start < end && chars.includes(value[start]!)) start++
  while (end > start && chars.includes(value[end - 1]!)) end--
  return value.slice(start, end)
}

function isObvious(stripped: string, lowered: string): boolean {
  if (OBVIOUS.has(stripped)) return true
  if (OBVIOUS.has(stripChars(stripped, '0123456789'))) return true
  const strippedLength = codePoints(stripped).length
  for (const word of OBVIOUS) {
    if (word.length >= 5 && lowered.includes(word) && word.length * 2 >= strippedLength) return true
  }
  return false
}

function isSequential(value: string): boolean {
  const points = codePoints(value)
  if (points.length < 6) return false
  const deltas = new Set<number>()
  for (let index = 1; index < points.length; index++) {
    deltas.add(points[index]!.codePointAt(0)! - points[index - 1]!.codePointAt(0)!)
  }
  return deltas.size === 1 && (deltas.has(1) || deltas.has(-1))
}

/** The server's rejection message for this password, or null if it passes. */
export function policyProblem(raw: string, context: string[] = []): string | null {
  const password = raw.normalize('NFKC')
  const length = codePoints(password).length

  if (length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`
  if (length > MAX_LENGTH) return 'Passwords are limited to 1024 characters.'

  const lowered = casefold(password)
  const stripped = codePoints(lowered)
    .filter((ch) => /[\p{L}\p{N}]/u.test(ch))
    .join('')

  if (isObvious(stripped, lowered)) return 'That password is among the most commonly used ones.'
  if (new Set(codePoints(password)).size < 5) return 'Use a wider mix of characters.'
  if (isSequential(lowered)) return "Avoid sequences like 'abcdefgh' or '12345678'."

  for (const raw_item of context) {
    const item = casefold(raw_item).trim()
    if (codePoints(item).length >= 4 && lowered.includes(item)) {
      return 'Your password cannot contain your email address or name.'
    }
    const local = item.split('@')[0] ?? ''
    if (codePoints(local).length >= 4 && lowered.includes(local)) {
      return 'Your password cannot contain your email address or name.'
    }
  }
  return null
}

/**
 * A conservative entropy estimate in bits.
 *
 * Pool size from the character classes present, multiplied over an effective
 * length that stops counting once characters start repeating heavily — so
 * `aaaaaaaaaaaaaaaaaaaaab` doesn't earn credit for its length.
 */
export function entropyBits(password: string): number {
  const points = codePoints(password)
  let pool = 0
  if (/[a-z]/.test(password)) pool += 26
  if (/[A-Z]/.test(password)) pool += 26
  if (/[0-9]/.test(password)) pool += 10
  if (/[^A-Za-z0-9\s]/.test(password)) pool += 33
  if (/\s/.test(password)) pool += 1
  if (pool === 0) return 0
  const effectiveLength = Math.min(points.length, new Set(points).size * 3)
  return effectiveLength * Math.log2(pool)
}

const STRONG_BITS = 70

/**
 * Where "strong" stops being the whole top of the scale.
 *
 * Without this, every password from a decent passphrase upward graded the
 * same, so the meter stopped responding exactly where people are deciding
 * whether to bother adding more. Above this the grade — and the illustration —
 * change again.
 */
const EXCELLENT_BITS = 100

export function strength(password: string, context: string[] = []): Strength {
  if (!password) return { level: 'empty', score: 0, problem: null }

  const problem = policyProblem(password, context)
  const bits = entropyBits(password)

  if (problem) {
    // Creep up with length so typing visibly makes progress, but never past
    // the first third while the server would still reject it.
    const progress = Math.min(1, codePoints(password).length / MIN_LENGTH)
    return { level: 'weak', score: 0.08 + progress * 0.25, problem }
  }
  if (bits < STRONG_BITS) {
    return { level: 'medium', score: 0.4 + Math.min(1, bits / STRONG_BITS) * 0.3, problem: null }
  }
  if (bits < EXCELLENT_BITS) {
    const through = (bits - STRONG_BITS) / (EXCELLENT_BITS - STRONG_BITS)
    return { level: 'strong', score: 0.72 + through * 0.16, problem: null }
  }
  return {
    level: 'excellent',
    score: Math.min(1, 0.9 + (bits - EXCELLENT_BITS) / 400),
    problem: null,
  }
}
