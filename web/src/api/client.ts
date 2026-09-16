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

export const API_BASE = '/api/v1'

const CSRF_COOKIE = 'dlt_csrf'
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
function csrfToken(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`))
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
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
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
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
