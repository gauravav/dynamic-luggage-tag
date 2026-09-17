/**
 * Registers one account for the whole run and saves its signed-in cookies.
 *
 * Registration is capped at five an hour and sign-in at ten a quarter of an
 * hour — deliberately, and the browser tests should not be the reason anyone
 * relaxes that. So the suite signs in once here and every signed-in test
 * reuses the resulting storage state. Tests that need a signed-out browser
 * clear it themselves.
 */

import { request } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

// localhost, not 127.0.0.1: DLT_FRONTEND_ORIGIN names this exact origin, and
// the API's CSRF check compares it literally. The API is reached through the
// dev server's /api proxy for the same reason — it is the route the browser
// takes, so it is the route the tests should take.
export const APP = 'http://localhost:5173'
export const API = `${APP}/api/v1`
export const PASSWORD = 'correct horse battery staple'

export const STATE_FILE = resolve('tests/e2e/.auth/owner.json')
export const ACCOUNT_FILE = resolve('tests/e2e/.auth/account.json')

/**
 * The newest verification token in the API's output.
 *
 * DLT_MAIL_PROVIDER=console prints the link rather than sending it, which is
 * how the project already expects local sign-ups to be completed.
 */
async function verificationToken(): Promise<string> {
  const log = process.env.DLT_API_LOG
  if (!log) throw new Error('set DLT_API_LOG to the API log the console mailer writes to')
  const matches = [...(await readFile(log, 'utf8')).matchAll(/token=([A-Za-z0-9_-]+)/g)]
  const last = matches.at(-1)
  if (!last) throw new Error(`no verification token in ${log}`)
  return last[1]!
}

/**
 * Reuses the account from a previous run if its session is still good.
 *
 * Registration is capped at five an hour, so a suite that registers on every
 * run stops being runnable after the fifth attempt of the afternoon. Probing
 * the saved cookies costs nothing and is the difference between a suite you
 * can iterate on and one you cannot.
 */
async function reusableSession(): Promise<boolean> {
  try {
    const state = JSON.parse(await readFile(STATE_FILE, 'utf8'))
    await readFile(ACCOUNT_FILE, 'utf8')
    const context = await request.newContext({ storageState: state })
    const probe = await context.get(`${API}/auth/session`)
    const live = probe.ok() && Boolean((await probe.json()).user)
    await context.dispose()
    return live
  } catch {
    return false
  }
}

/**
 * Puts the reused account back to a known state.
 *
 * Two things accumulate otherwise. Tags: each run makes a handful and an
 * account is capped at 25, so the suite would work for three or four runs and
 * then fail on a limit that has nothing to do with what it is testing. And
 * two-factor: the test that enables it turns it back off at the end, but a run
 * killed part-way leaves it on — and then every later run fails at a sign-in
 * it has no code for. Neither belongs in the test that tripped over it.
 */
async function resetAccount(): Promise<void> {
  const state = JSON.parse(await readFile(STATE_FILE, 'utf8'))
  const { csrf } = JSON.parse(await readFile(ACCOUNT_FILE, 'utf8'))
  const context = await request.newContext({
    storageState: state,
    extraHTTPHeaders: { Origin: APP, 'X-CSRF-Token': csrf },
  })

  const { tags } = await (await context.get(`${API}/tags`)).json()
  for (const tag of tags) await context.delete(`${API}/tags/${tag.id}`)

  const { user } = await (await context.get(`${API}/auth/session`)).json()
  if (user?.totp_enabled) {
    const off = await context.post(`${API}/auth/totp/disable`, { data: { password: PASSWORD } })
    if (!off.ok()) throw new Error(`could not clear two-factor: ${await off.text()}`)
  }

  await context.dispose()
}

export default async function globalSetup() {
  if (await reusableSession()) {
    await resetAccount()
    return
  }

  // Absolute URLs, not a baseURL: a leading-slash path would replace the
  // /api/v1 prefix rather than extend it.
  const context = await request.newContext({ extraHTTPHeaders: { Origin: APP } })
  const email = `e2e-${Date.now()}@example.com`

  const registered = await context.post(`${API}/auth/register`, {
    data: { email, password: PASSWORD, name: 'Gaurav Avula', accept_terms: true },
  })
  if (!registered.ok()) throw new Error(`register failed: ${await registered.text()}`)

  const verified = await context.post(`${API}/auth/verify-email`, {
    data: { token: await verificationToken() },
  })
  if (!verified.ok()) throw new Error(`verify failed: ${await verified.text()}`)

  // verify-email signs the new account in, so these cookies are already a
  // session; no separate login call, and no spending a login attempt.
  const csrf = (await verified.json()).csrf_token as string

  await mkdir(dirname(STATE_FILE), { recursive: true })
  // Cookies are scoped by host, not by port, and the API and the dev server
  // share 127.0.0.1 — so the session saved here is the same session the app
  // will present when the browser loads it on :5173.
  await writeFile(STATE_FILE, JSON.stringify(await context.storageState()))
  await writeFile(ACCOUNT_FILE, JSON.stringify({ email, csrf }))
  await context.dispose()
}
