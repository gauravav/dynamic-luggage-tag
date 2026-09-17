/**
 * Typed API client.
 *
 * Three things it takes care of so no call site has to remember them:
 *
 *  - credentials: 'include' on every request, since authentication is a
 *    server-side session in an HttpOnly cookie rather than a token in
 *    JavaScript-reachable storage.
 *  - The CSRF token, read from the readable companion cookie and echoed in a
 *    header on every state-changing request.
 *  - Errors arrive as a typed ApiError carrying the server's stable `code` and
 *    per-field messages, so forms can show them next to the right input.
 */

// import.meta.env.BASE_URL is Vite's configured `base` (e.g. '/' in dev, or
// '/dynamic-luggage-tag/' when built for a path-mounted deployment), so the
// API is always reached under whatever path the app itself is served from.
export const API_BASE = `${import.meta.env.BASE_URL}api/v1`.replace(/\/{2,}/g, '/')

// Over HTTPS the API issues this cookie with the __Host- prefix (see
// cookie_name() in api/app/security/sessions.py), which pins it to this exact
// origin. Plain-HTTP development drops the prefix, because browsers refuse
// __Host- cookies without Secure. Both names must be read: matching only the
// bare name finds nothing in production, so every state-changing request goes
// out without a token and the API rejects it as "CSRF token is missing".
const CSRF_COOKIE_NAMES = ['__Host-dlt_csrf', 'dlt_csrf']
const CSRF_HEADER = 'X-CSRF-Token'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly fields: Record<string, string>

  constructor(code: string, message: string, status: number, fields: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.fields = fields
  }

  get isUnauthenticated(): boolean {
    return this.status === 401
  }
}

/**
 * The CSRF token is deliberately in a readable cookie: only same-origin script
 * can read it, which is exactly the property the double-submit check relies
 * on. The session cookie itself stays HttpOnly and is never touched here.
 */
export function csrfToken(cookies: string = document.cookie): string | null {
  for (const name of CSRF_COOKIE_NAMES) {
    for (const pair of cookies.split(';')) {
      const separator = pair.indexOf('=')
      if (separator === -1) continue
      if (pair.slice(0, separator).trim() === name) {
        const value = pair.slice(separator + 1).trim()
        if (value) return decodeURIComponent(value)
      }
    }
  }
  return null
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  /** A Cloudflare Turnstile token, for the endpoints that require one. */
  turnstileToken?: string | null
}

export interface SendOptions {
  turnstileToken?: string | null
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (!SAFE_METHODS.has(method)) {
    const token = csrfToken()
    if (token) headers[CSRF_HEADER] = token
  }
  if (options.turnstileToken) {
    headers['X-Turnstile-Token'] = options.turnstileToken
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (cause) {
    if ((cause as Error)?.name === 'AbortError') throw cause
    throw new ApiError('network_error', 'Could not reach the server. Check your connection.', 0)
  }

  if (response.status === 204) return undefined as T

  const isJson = response.headers.get('Content-Type')?.includes('application/json')
  const payload = isJson ? await response.json().catch(() => null) : null

  if (!response.ok) {
    const error = payload?.error
    throw new ApiError(
      error?.code ?? 'http_error',
      error?.message ?? 'Something went wrong.',
      response.status,
      error?.fields ?? {},
    )
  }

  return payload as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { signal }),
  post: <T>(path: string, body?: unknown, options: SendOptions = {}) =>
    request<T>(path, { method: 'POST', body, ...options }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
}

/* ---------------------------------------------------------------- types -- */

export interface DesignSpec {
  version: number
  palette: string
  field: string
  ink: string
  accent: string
  motif: string
  density: number
  weight: number
  angle: number
  offset: number
  accent_band: boolean
}

export interface User {
  id: string
  email: string | null
  email_masked: string | null
  name: string | null
  email_verified: boolean
  totp_enabled: boolean
  notify_on_scan: boolean
  created_at: string
}

export interface Tag {
  id: string
  label: string | null
  status: 'safe' | 'lost'
  lost_at: string | null
  design: DesignSpec
  reveal_name: boolean
  reveal_message_relay: boolean
  notify_on_scan: boolean
  scan_count: number
  last_scan_at: string | null
  created_at: string
  nfc_linked: boolean
  nfc_linked_at: string | null
  scan_url?: string
}

export interface ScanRecord {
  id: string
  occurred_at: string
  location: string | null
  shared_location: boolean
  client: string | null
  contact_revealed: boolean
  expires_at: string
}

export interface RelayMessage {
  id: string
  from: 'finder' | 'owner'
  at: string
  body: string
  mine: boolean
}

export interface RelayThread {
  id: string
  opened_at: string
  expires_at: string
  closed: boolean
  /** Whether the finder is emailed when the owner replies. Never the address itself. */
  email_updates: boolean
  messages: RelayMessage[]
  finder_contact?: string | null
  tag_id?: string
}

export interface ThreadSummary {
  id: string
  tag_id: string
  tag_label: string | null
  opened_at: string
  last_message_at: string
  expires_at: string
  closed: boolean
  unread: boolean
  message_count: number
  preview: string | null
}

export interface ScanPage {
  status: 'safe' | 'lost'
  design: DesignSpec
  owner: { name: string | null } | null
  relay_available: boolean
  retention_days: number
}

export interface AccountDetail {
  id: string
  email: string | null
  name: string | null
  phone: string | null
  address: string | null
  email_verified: boolean
  totp_enabled: boolean
  notify_on_scan: boolean
  created_at: string
}

export interface SessionRecord {
  id: string
  client: string
  created_at: string
  last_seen_at: string
  current: boolean
}

/** A parsed location, as stored for a scan. */
export function parseLocation(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { city?: string; region?: string; country?: string }
    const parts = [parsed.city, parsed.region ?? parsed.country].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : null
  } catch {
    return raw
  }
}
