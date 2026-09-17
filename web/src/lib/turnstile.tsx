/**
 * Cloudflare Turnstile, loaded only when the server has it configured.
 *
 * The site key comes from the API (`GET /api/v1/config`) rather than a build
 * variable, so the frontend and the API can never disagree about whether
 * verification is on — a mismatch would either show a widget the server
 * ignores, or have the server demand tokens no page can produce.
 *
 * Nothing loads from Cloudflare until a page that needs verification is open,
 * and never on the plain scan page a finder lands on.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string
      action: string
      theme?: 'light' | 'dark' | 'auto'
      size?: 'normal' | 'flexible' | 'compact'
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => boolean | void
    },
  ): string
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let siteKeyPromise: Promise<string | null> | null = null

/** The site key, or null when the server has Turnstile turned off. Fetched once. */
function siteKey(): Promise<string | null> {
  siteKeyPromise ??= api
    .get<{ turnstile_site_key: string | null }>('/config')
    .then((body) => body.turnstile_site_key)
    .catch(() => {
      // Let a later page try again rather than caching a transient failure.
      siteKeyPromise = null
      return null
    })
  return siteKeyPromise
}

let scriptPromise: Promise<TurnstileApi> | null = null

function loadScript(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile)
      return
    }
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load'))
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('Turnstile could not be loaded'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export interface TurnstileState {
  /** Render this where the check should appear. Empty when Turnstile is off. */
  widget: React.ReactElement | null
  /** The current token, or null if none has been issued yet. */
  token: string | null
  /** True once the form may submit: Turnstile is off, or a token is ready. */
  ready: boolean
  /** Set if the widget could not load, e.g. blocked by an extension or CSP. */
  loadError: string | null
  /**
   * Discards the used token and runs the check again. Tokens are single-use,
   * so call this after every submission, successful or not.
   */
  reset: () => void
}

/**
 * Renders a Turnstile widget for `action` and tracks its token.
 *
 * `action` must match the one the API endpoint checks, or the server refuses
 * the token even though the check passed.
 */
export function useTurnstile(action: string): TurnstileState {
  const [key, setKey] = useState<string | null | undefined>(undefined)
  const [token, setToken] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const widgetId = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void siteKey().then((value) => {
      if (!cancelled) setKey(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!key || !container.current) return
    let cancelled = false

    loadScript()
      .then((turnstile) => {
        if (cancelled || !container.current) return
        widgetId.current = turnstile.render(container.current, {
          sitekey: key,
          action,
          theme: 'light',
          size: 'flexible',
          callback: (value) => setToken(value),
          'expired-callback': () => setToken(null),
          'error-callback': () => {
            setToken(null)
            // Returning true tells Turnstile the error was handled, so it
            // retries on its own instead of throwing into the console.
            return true
          },
        })
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(
            'The verification check could not load. Disable any blocker for this site and reload.',
          )
        }
      })

    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current)
      }
      widgetId.current = null
    }
  }, [key, action])

  const reset = useCallback(() => {
    setToken(null)
    if (widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current)
    }
  }, [])

  const widget = key ? <div ref={container} className="turnstile" /> : null

  return {
    widget,
    token,
    // While the site key is still being fetched (undefined), hold submission:
    // letting it through would race a server that does require a token.
    ready: key === null || (key !== undefined && token !== null),
    loadError,
    reset,
  }
}
