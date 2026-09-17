import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests, run against the real stack.
 *
 * They assume `make dev` is already up on the usual ports, with Turnstile
 * unset and DLT_MAIL_PROVIDER=console so the verification link goes to the
 * API's output. `make e2e` starts everything and runs them.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // One account for the whole run; see tests/e2e/global-setup.ts.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  // Motion settles in well under this; a generous ceiling keeps a slow
  // machine from failing a test that is only waiting on a spring.
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    storageState: './tests/e2e/.auth/owner.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
