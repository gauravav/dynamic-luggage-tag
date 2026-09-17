/**
 * Shared helpers for the browser tests.
 *
 * They run against the real stack — the API and the dev server as `make dev`
 * starts them, with Turnstile unset and the console mail provider. Nothing is
 * mocked by default: the point of these tests is the parts that only exist in
 * a browser, and a stubbed server would exercise none of them.
 */

import type { APIRequestContext, Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { ACCOUNT_FILE, API, APP } from './global-setup'

export { API, APP, PASSWORD } from './global-setup'

/** The account global setup registered, and its CSRF token. */
export async function owner(): Promise<{ email: string; csrf: string }> {
  return JSON.parse(await readFile(ACCOUNT_FILE, 'utf8'))
}

/**
 * Creates a tag as the signed-in owner.
 *
 * Through the API rather than the button, because no test here is about the
 * button — they are about what the page does once a tag exists.
 */
export async function createTag(
  page: Page,
  request: APIRequestContext,
  body: Record<string, unknown> = { label: 'Blue Samsonite spinner' },
) {
  const { csrf } = await owner()
  const cookies = await page.context().cookies()
  const response = await request.post(`${API}/tags`, {
    headers: {
      Origin: APP,
      'X-CSRF-Token': csrf,
      Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
    },
    data: body,
  })
  if (!response.ok()) throw new Error(`create tag failed: ${await response.text()}`)
  return (await response.json()).tag
}

/** A browser with no session at all, for the finder's side of things. */
export const SIGNED_OUT = { cookies: [], origins: [] }
