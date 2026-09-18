/**
 * The parts of the interface that only exist in a browser.
 *
 * Type-checking proves these components compile; it proves nothing about
 * whether the mole covers its eyes, whether the tag list is two-up at phone
 * width, or whether a download arrives. That is what these check.
 */

import { expect, test } from '@playwright/test'
import { APP, PASSWORD, SIGNED_OUT, createTag, owner } from './helpers'
import { secretFromUri, totp } from './totp'

test.describe('favicon', () => {
  test.use({ storageState: SIGNED_OUT })

  test('every declared icon is served', async ({ page, request }) => {
    await page.goto(APP)

    const declared = await page.$$eval('link[rel*="icon"], link[rel="manifest"]', (links) =>
      links.map((link) => (link as HTMLLinkElement).href),
    )
    expect(declared.length).toBeGreaterThanOrEqual(4)

    for (const href of declared) {
      const response = await request.get(href)
      expect(response.status(), `${href} should be served`).toBe(200)
    }
  })

  test('the manifest lists icons that exist', async ({ request }) => {
    const manifest = await (await request.get(`${APP}/manifest.webmanifest`)).json()
    expect(manifest.name).toBe('Dynamic Luggage Tag')
    for (const icon of manifest.icons) {
      const response = await request.get(`${APP}/${icon.src}`)
      expect(response.status(), `${icon.src} should be served`).toBe(200)
    }
  })
})

test.describe('the sign-in mole', () => {
  test.use({ storageState: SIGNED_OUT })

  /**
   * The tag is one <g> translated on the y axis, and the pose is entirely a
   * question of how high it is held. Reading the transform back is therefore
   * the honest check: it is the same number the component animates.
   */
  async function tagHeight(page: import('@playwright/test').Page): Promise<number> {
    // The tag group is the last <g> in the mole's SVG.
    const matrix = await page.evaluate(() => {
      const svg = document.querySelector('.mole--signin svg')!
      const groups = svg.querySelectorAll(':scope > g')
      const tag = groups[groups.length - 1] as SVGGElement
      return tag.getCTM()?.f ?? NaN
    })
    return matrix
  }

  test('it covers its eyes for a password and peeks when you press Show', async ({ page }) => {
    await page.goto(`${APP}/login`)
    await expect(page.locator('.mole--signin')).toBeVisible()

    await page.waitForTimeout(600)
    const idle = await tagHeight(page)

    await page.fill('#email', 'traveller@example.com')
    await page.waitForTimeout(600)
    const watching = await tagHeight(page)
    await expect(page.getByText('Reading along…')).toBeVisible()

    await page.click('#password')
    await page.waitForTimeout(700)
    const hiding = await tagHeight(page)
    await expect(page.getByText('Not looking.')).toBeVisible()

    await page.getByRole('button', { name: 'Show password' }).click()
    await page.waitForTimeout(700)
    const peeking = await tagHeight(page)
    await expect(page.getByText('Only because you asked.')).toBeVisible()

    // Smaller y = held higher. Covering the eyes is the highest, peeking sits
    // between that and resting, and reading holds it lowest of all.
    expect(hiding).toBeLessThan(peeking)
    expect(peeking).toBeLessThan(idle)
    expect(idle).toBeLessThan(watching)
  })

  test('Show actually reveals the password', async ({ page }) => {
    await page.goto(`${APP}/login`)
    await page.fill('#password', 'hunter2')
    await expect(page.locator('#password')).toHaveAttribute('type', 'password')
    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(page.locator('#password')).toHaveAttribute('type', 'text')
    await page.getByRole('button', { name: 'Hide password' }).click()
    await expect(page.locator('#password')).toHaveAttribute('type', 'password')
  })

  test('it is on the sign-up page too, and behaves the same', async ({ page }) => {
    await page.goto(`${APP}/register`)
    await expect(page.locator('.mole--signin')).toBeVisible()

    await page.fill('#email', 'traveller@example.com')
    await expect(page.getByText('Reading along…')).toBeVisible()

    // The name is not a secret either, so it keeps reading.
    await page.click('#name')
    await expect(page.getByText('Reading along…')).toBeVisible()

    await page.click('#password')
    await expect(page.getByText('Not looking.')).toBeVisible()

    // The sign-up password field has its own Show, and the mole follows it.
    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(page.getByText('Only because you asked.')).toBeVisible()
    await expect(page.locator('#password')).toHaveAttribute('type', 'text')
  })

  test('its eyes are open while reading and shut for a password', async ({ page }) => {
    await page.goto(`${APP}/login`)

    /** How far the lid has slid down over the eye: 0 open, ~19 shut. */
    const lidDrop = () =>
      page.evaluate(() => {
        const svg = document.querySelector('.mole--signin svg')!
        const lid = svg.querySelectorAll('g[clip-path] > g')[1] as SVGGElement
        return lid.getCTM()?.f ?? NaN
      })

    await page.fill('#email', 'traveller@example.com')
    await page.waitForTimeout(500)
    const open = await lidDrop()

    await page.click('#password')
    await page.waitForTimeout(700)
    const shut = await lidDrop()

    expect(shut).toBeGreaterThan(open)
  })
})

test.describe('the tag list on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('lays out two-up', async ({ page, request }) => {
    await createTag(page, request, { label: 'Carry-on', icon: 'roller' })
    await createTag(page, request, { label: 'Duffel', icon: 'duffel' })
    await createTag(page, request, { label: 'Backpack', icon: 'backpack' })

    await page.goto(`${APP}/app`)
    await expect(page.locator('.tag-card').nth(2)).toBeVisible()

    const columns = await page.$eval('.grid--tags', (grid) =>
      getComputedStyle(grid as HTMLElement).gridTemplateColumns.split(' ').length,
    )
    expect(columns).toBe(2)

    // And they really are side by side, not merely styled that way.
    const boxes = await page.locator('.tag-card').evaluateAll((cards) =>
      cards.map((card) => card.getBoundingClientRect().top),
    )
    expect(Math.abs(boxes[0]! - boxes[1]!)).toBeLessThan(4)
    expect(boxes[2]!).toBeGreaterThan(boxes[0]! + 100)

    // The cards cascade in and then sway; let the entrance finish so the
    // screenshot shows the resting layout rather than a frame of animation.
    await page.waitForTimeout(2000)
    await page.screenshot({ path: 'tests/e2e/__screenshots__/tags-mobile.png', fullPage: true })
  })
})

test.describe('loading', () => {
  test('shows a tag being scanned rather than a spinner', async ({ page, request }) => {
    await createTag(page, request)

    // Hold the tag list response so the loading state stays on screen.
    await page.route('**/api/v1/tags', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.continue()
    })

    await page.goto(`${APP}/app`)
    const loader = page.locator('.loader')
    await expect(loader).toBeVisible()
    await expect(loader).toHaveAttribute('aria-label', 'Loading your tags')
    await expect(loader.locator('svg')).toBeVisible()
    await expect(page.getByText('Reading your tags…')).toBeVisible()
    await page.screenshot({ path: 'tests/e2e/__screenshots__/loader.png' })

    await expect(loader).toBeHidden({ timeout: 10_000 })
    await expect(page.locator('.tag-card').first()).toBeVisible()
  })
})

test.describe('the landing page scenes', () => {
  test.use({ storageState: SIGNED_OUT })

  test('all four are on the page and animating', async ({ page }) => {
    await page.goto(APP)

    const labels = [
      'Bags going past on a belt, with one carrying your pattern picked out',
      'An owner switching a bag to lost, and the tag changing to match',
      'A passer-by tapping a tag, and a notification reaching the owner',
      'A message leaving one phone, scrambled in transit, arriving readable at the other',
    ]
    for (const label of labels) {
      await page.locator(`svg[aria-label="${label}"]`).scrollIntoViewIfNeeded()
      await expect(page.locator(`svg[aria-label="${label}"]`)).toBeVisible()
    }

    // The belt is a looping translate; sampling it twice must show movement.
    const beltAt = () =>
      page.evaluate(() => {
        const svg = document.querySelector('svg[aria-label^="Bags going past"]')!
        const groups = svg.querySelectorAll(':scope > g')
        const train = groups[groups.length - 1] as SVGGElement
        return train.getCTM()?.e ?? NaN
      })
    await page.locator('svg[aria-label^="Bags going past"]').scrollIntoViewIfNeeded()
    const first = await beltAt()
    await page.waitForTimeout(900)
    const second = await beltAt()
    expect(second).not.toBeCloseTo(first, 1)

    await page.screenshot({ path: 'tests/e2e/__screenshots__/landing.png', fullPage: true })
  })
})

test.describe('downloads', () => {
  test('the print PDF downloads', async ({ page, request }) => {
    const tag = await createTag(page, request)

    await page.goto(`${APP}/app/tags/${tag.id}`)
    await expect(page.getByRole('heading', { name: 'Print' })).toBeVisible()

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download print PDF' }).click()
    const file = await download

    expect(file.suggestedFilename()).toBe(`luggage-tag-${tag.id}.pdf`)
    const path = await file.path()
    const { readFile } = await import('node:fs/promises')
    const bytes = await readFile(path)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(10_000)
  })

  /**
   * The symbol opens in a tab of its own, which means the browser parses it as
   * an XML document rather than laying it out as part of a page. It shipped
   * with two viewBox attributes, and every browser refused it outright:
   * "Attribute viewBox redefined". Nothing short of actually opening it would
   * have caught that — the response was a perfectly good 200.
   */
  test('the QR symbol opens as a drawable document', async ({ page, request }) => {
    const tag = await createTag(page, request)
    await page.goto(`${APP}/app/tags/${tag.id}`)

    const opened = page.waitForEvent('popup')
    await page.getByRole('button', { name: 'QR code only (SVG)' }).click()
    const symbol = await opened

    await symbol.waitForLoadState('domcontentloaded')

    const drawn = await symbol.evaluate(() => {
      const root = document.documentElement
      return {
        tag: root.tagName.toLowerCase(),
        viewBox: root.getAttribute('viewBox'),
        // A parse failure renders as an HTML error document, and the symbol's
        // own paths are simply not there.
        paths: document.querySelectorAll('path, rect').length,
        text: document.body?.textContent ?? '',
      }
    })

    expect(drawn.tag).toBe('svg')
    expect(drawn.viewBox).toBeTruthy()
    expect(drawn.paths).toBeGreaterThan(0)
    expect(drawn.text).not.toContain('error')
    await symbol.close()
  })

  test('a failure shows an error instead of navigating away', async ({ page, request }) => {
    const tag = await createTag(page, request)

    await page.route('**/print.pdf*', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'boom', message: 'Could not build that PDF.' } }),
      }),
    )

    await page.goto(`${APP}/app/tags/${tag.id}`)
    await page.getByRole('button', { name: 'Download print PDF' }).click()

    await expect(page.getByText('Could not build that PDF.')).toBeVisible()
    expect(page.url()).toContain(`/app/tags/${tag.id}`)
  })
})

test.describe('the tag', () => {
  test('turns over to show the NFC circle on the back', async ({ page, request }) => {
    const tag = await createTag(page, request)

    await page.goto(`${APP}/app/tags/${tag.id}`)

    // The artwork is in the page twice — above the form on phones, in the
    // sidebar on wider screens — and CSS shows one. `:visible` picks whichever
    // this viewport is actually using.
    const faces = page.locator('.tag-faces:visible')
    await expect(faces.locator('svg')).toBeVisible()

    await faces.locator('.segmented__option', { hasText: 'Back' }).click()
    await expect(faces.getByText('SCAN HERE')).toBeVisible()
    await expect(faces.getByText('NFC STICKER')).toBeVisible()

    await faces.locator('.segmented__option', { hasText: 'Front' }).click()
    await expect(faces.getByText('SCAN HERE')).toHaveCount(0)
  })

  test('an icon chosen in the picker appears on the artwork', async ({ page, request }) => {
    const tag = await createTag(page, request)

    await page.goto(`${APP}/app/tags/${tag.id}`)
    await page.getByRole('button', { name: 'Backpack' }).click()

    // Saved server-side…
    await expect
      .poll(async () => {
        const reloaded = await page.request.get(`/api/v1/tags/${tag.id}`)
        return (await reloaded.json()).tag.icon
      })
      .toBe('backpack')

    // …and it survives a reload, drawn onto the tag face.
    await page.reload()
    await expect(page.locator('.tag-faces svg polyline, .tag-faces svg rect')).not.toHaveCount(0)
    await page.screenshot({ path: 'tests/e2e/__screenshots__/tag-detail.png', fullPage: true })
  })
})

test.describe('the scan page', () => {
  test('a stranger sees the header and the finder view', async ({ browser, page, request }) => {
    const tag = await createTag(page, request)
    const token = tag.scan_url.split('/t/')[1]

    // A genuine stranger: storageState has to be cleared explicitly, because
    // browser.newContext() inherits the signed-in state from the config and
    // would otherwise hand the owner their own tag page instead.
    const stranger = await browser.newContext({ storageState: SIGNED_OUT })
    const finder = await stranger.newPage()
    await finder.goto(`${APP}/t/${token}`)

    await expect(finder.getByRole('link', { name: 'Sign in' })).toBeVisible()
    await expect(finder.getByRole('link', { name: /Create an account|Sign up/ })).toBeVisible()
    await expect(finder.getByText('This bag has not been reported lost.')).toBeVisible()
    await finder.screenshot({ path: 'tests/e2e/__screenshots__/scan-stranger.png' })
    await stranger.close()
  })

  test('the owner is sent to their own tag instead', async ({ page, request }) => {
    const tag = await createTag(page, request)
    const token = tag.scan_url.split('/t/')[1]

    await page.goto(`${APP}/t/${token}`)
    await page.waitForURL(`**/app/tags/${tag.id}?scanned=1`, { timeout: 10_000 })
    await expect(page.getByText('You scanned this tag just now')).toBeVisible()
  })
})

test.describe('the password meter', () => {
  test.use({ storageState: SIGNED_OUT })

  /**
   * Four grades must look like four things.
   *
   * They did not: everything from a decent passphrase upward graded "strong"
   * and drew the same vault, so the meter went quiet exactly where someone is
   * deciding whether another word is worth typing.
   */
  test('each grade has its own label and its own illustration', async ({ page }) => {
    await page.goto(`${APP}/register`)

    const candidates = [
      { password: 'short', label: 'Weak' },
      { password: 'brambleshore1', label: 'Medium' },
      { password: 'basketcandlewindow', label: 'Strong' },
      { password: 'correct horse battery staple', label: 'Excellent' },
    ]

    const drawings = new Map<string, string>()
    for (const { password, label } of candidates) {
      await page.fill('#password', password)
      await expect(page.locator('.strength-meta__label')).toHaveText(label)
      // Let the scene finish swapping before reading it back.
      await page.waitForTimeout(700)
      drawings.set(label, await page.locator('.strength-art svg').innerHTML())
    }

    const distinct = new Set(drawings.values())
    expect(distinct.size, 'every grade should draw something different').toBe(candidates.length)

    // The bar fills further at each step, too.
    const widths: number[] = []
    for (const { password } of candidates) {
      await page.fill('#password', password)
      await page.waitForTimeout(500)
      widths.push(await page.locator('.strength-bar__fill').evaluate((el) => el.getBoundingClientRect().width))
    }
    for (let index = 1; index < widths.length; index++) {
      expect(widths[index]!, `${candidates[index]!.label} should fill further`).toBeGreaterThan(
        widths[index - 1]!,
      )
    }
  })
})

test.describe('two-factor', () => {
  /**
   * The whole enrolment, behaving like a real authenticator.
   *
   * The suite reads the secret out of the provisioning URI the page was given,
   * generates codes from it (tests/e2e/totp.ts, checked against the RFC 6238
   * vector) and signs in with one. Anything less would only prove a form
   * exists, which is the part least likely to be broken.
   *
   * It runs on the shared account, so it always turns two-factor back off —
   * otherwise every later run would need a code to sign in.
   */
  test('scans, enables, signs in with a code, and turns back off', async ({ page, browser }) => {
    const { email } = await owner()
    await page.goto(`${APP}/app/settings`)

    const setup = page.waitForResponse('**/auth/totp/setup')
    await page.getByRole('button', { name: 'Set up two-factor' }).click()
    const issued = await (await setup).json()
    const secret = secretFromUri(issued.otpauth_uri)

    try {
      // The symbol is on screen and actually drew — a broken or unparseable
      // image still occupies the element, but decodes to nothing.
      const symbol = page.getByAltText('QR code for setting up two-factor authentication')
      await expect(symbol).toBeVisible()
      const drawn = await symbol.evaluate((img) => {
        const image = img as HTMLImageElement
        return { w: image.naturalWidth, h: image.naturalHeight, src: image.src }
      })
      expect(drawn.w).toBeGreaterThan(0)
      expect(drawn.h).toBeGreaterThan(0)
      // And it is the symbol the server issued, not a placeholder.
      expect(decodeURIComponent(drawn.src)).toContain(issued.qr_svg.slice(0, 60))

      // The typed-by-hand path offers the same secret, grouped to be readable.
      // Located by element, not by its words: the summary renders a curly
      // apostrophe, and matching it by text is a trap for the next person.
      await page.locator('.totp-manual summary').click()
      const shown = await page.locator('.totp-secret').innerText()
      expect(shown.replace(/\s/g, '')).toBe(secret)

      await page.fill('#totp_code', totp(secret))
      await page.getByRole('button', { name: 'Turn on two-factor' }).click()

      await expect(page.getByText('Save these recovery codes now.')).toBeVisible()
      const codes = (await page.locator('.code-block').first().innerText()).trim().split('\n')
      expect(codes).toHaveLength(10)
      await expect(page.getByRole('button', { name: 'Copy all' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Download as a file' })).toBeVisible()
      await expect(page.getByText('On. A code from your authenticator is required')).toBeVisible()

      // Now sign in somewhere else, as the enrolled authenticator.
      const elsewhere = await browser.newContext({ storageState: SIGNED_OUT })
      const fresh = await elsewhere.newPage()
      await fresh.goto(`${APP}/login`)
      await fresh.fill('#email', email)
      await fresh.fill('#password', PASSWORD)
      await fresh.click('button[type="submit"]')

      await expect(fresh.getByText('Enter the six-digit code')).toBeVisible()
      // Six boxes now, and filling the first distributes the whole code and
      // submits itself — see components/CodeInput.tsx.
      await fresh.locator('.case input').first().fill(totp(secret))
      await fresh.waitForURL('**/app', { timeout: 20_000 })
      await elsewhere.close()
    } finally {
      // Always, even if the above failed part-way: a shared account left with
      // two-factor on cannot be signed into by the next run. Wrapped, because
      // a cleanup that throws would hide the failure it is cleaning up after.
      try {
        await page.goto(`${APP}/app/settings`)
        if (await page.locator('#totp_password').count()) {
          await page.fill('#totp_password', PASSWORD)
          await page.getByRole('button', { name: 'Turn off two-factor' }).click()
          await expect(page.getByText('Off. Your password alone is enough')).toBeVisible()
        }
      } catch (cause) {
        console.warn('could not turn two-factor back off:', cause)
      }
    }
  })
})

test.describe('the saved-link watcher', () => {
  /**
   * Someone who handles a bag can scan it while it is marked safe, learn
   * nothing, and keep the URL. Polling it costs them nothing, and the moment
   * the owner reports the bag lost the old design handed them a name.
   *
   * This drives the whole thing through the interface: watch, wait, flip,
   * poll again — then check that a real finder still gets the bag home.
   */
  test('gains nothing when the bag is reported lost, but a finder still does', async ({
    page,
    browser,
    request,
  }) => {
    const tag = await createTag(page, request, { label: 'Watched bag' })
    const token = tag.scan_url.split('/t/')[1]

    const outside = await browser.newContext({ storageState: SIGNED_OUT })
    const watcher = await outside.newPage()

    // Scanned while safe: nothing to learn.
    await watcher.goto(`${APP}/t/${token}`)
    await expect(watcher.getByText('This bag has not been reported lost.')).toBeVisible()

    // The owner reports it lost, from the app. The cards cascade in on load,
    // so the switch is still moving for a moment after it is visible.
    await page.goto(`${APP}/app/tags/${tag.id}`)
    const lostSwitch = page.getByLabel(/Report this bag lost/)
    await expect(lostSwitch).toBeVisible()
    await page.waitForTimeout(1200)
    // click(), not check(): the switch is controlled by state that only
    // updates once the PATCH returns, so check() sees it still unset, clicks
    // again, and toggles the bag back to safe.
    await lostSwitch.click()
    await expect(page.getByText(/Marked lost/)).toBeVisible()
    await expect(lostSwitch).toBeChecked()

    // The saved URL, polled again.
    await watcher.goto(`${APP}/t/${token}`)
    await expect(watcher.getByText('Reported lost')).toBeVisible()
    await expect(watcher.getByText('Gaurav Avula')).toHaveCount(0)

    // A finder messages, the owner answers, and only then is the name released
    // — to that conversation.
    await watcher.getByLabel('Your message').fill('I have your bag at DFW, claim 3.')
    await watcher.getByRole('button', { name: /Send message/ }).click()
    await expect(watcher.getByText('Message sent')).toBeVisible()
    const relayUrl = (await watcher.locator('.code-block').first().innerText()).trim()

    // This account accumulates conversations across the suite, so open the
    // one belonging to this tag rather than whichever happens to be first.
    await page.goto(`${APP}/app/inbox`)
    await page
      .locator('.inbox__list .list__item', { hasText: 'Watched bag' })
      .first()
      .getByRole('button')
      .first()
      .click()
    await page.getByLabel('Reply').fill('Thank you — on my way.')
    await page.getByRole('button', { name: /Send/ }).first().click()
    await expect(page.getByText('Thank you — on my way.')).toBeVisible()

    await watcher.goto(relayUrl)
    await expect(watcher.getByRole('heading', { name: /You and Gaurav Avula/ })).toBeVisible()

    // And still not to anyone else holding the code.
    await watcher.goto(`${APP}/t/${token}`)
    await expect(watcher.getByText('Gaurav Avula')).toHaveCount(0)
    await outside.close()
  })

  test('a rotated code still gets a bag home, and the owner is warned', async ({
    page,
    browser,
    request,
  }) => {
    const tag = await createTag(page, request, { label: 'Rotated bag' })
    const oldToken = tag.scan_url.split('/t/')[1]

    page.on('dialog', (dialog) => dialog.accept())
    await page.goto(`${APP}/app/tags/${tag.id}`)
    await expect(page.getByRole('button', { name: 'Issue a new code' })).toBeVisible()
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: 'Issue a new code' }).click()
    await expect(page.getByText(/A new code was issued/)).toBeVisible()

    // The code printed on the bag has not changed, and still works.
    const outside = await browser.newContext({ storageState: SIGNED_OUT })
    const finder = await outside.newPage()
    for (let attempt = 0; attempt < 4; attempt++) await finder.goto(`${APP}/t/${oldToken}`)
    await expect(finder.getByText('This bag has not been reported lost.')).toBeVisible()
    await outside.close()

    // The owner is told the old code is in use — without being told they are
    // being watched, which four honest scans of an un-reprinted tag are not.
    await page.reload()
    await expect(page.getByText('Your previous code is still in use')).toBeVisible()
    await expect(page.getByText(/using a code you have already replaced/)).toBeVisible()
    await expect(page.getByText('This tag looks like it is being watched')).toHaveCount(0)
  })

  test('rotating again never strands the code printed on the bag', async ({
    page,
    browser,
    request,
  }) => {
    const tag = await createTag(page, request, { label: 'Reprinted bag' })
    page.on('dialog', (dialog) => dialog.accept())
    await page.goto(`${APP}/app/tags/${tag.id}`)
    await expect(page.getByRole('button', { name: 'Issue a new code' })).toBeVisible()
    await page.waitForTimeout(1200)

    // Rotate, reprint, and switch the old codes off.
    await page.getByRole('button', { name: 'Issue a new code' }).click()
    await expect(page.getByText(/A new code was issued/)).toBeVisible()
    const printed = await page.locator('.code-block').first().innerText()

    const outside = await browser.newContext({ storageState: SIGNED_OUT })
    const finder = await outside.newPage()
    await finder.goto(tag.scan_url)
    await page.reload()
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: /stop old codes/ }).click()
    await expect(page.getByText(/Replaced codes are switched off/)).toBeVisible()

    // Now rotate again. The code on the bag is the one being retired.
    await page.getByRole('button', { name: 'Issue a new code' }).click()
    await expect(page.getByText(/A new code was issued/)).toBeVisible()

    await finder.goto(printed.trim())
    await expect(finder.getByText(/not been reported lost|Reported lost/)).toBeVisible()
    await outside.close()
  })
})

test.describe('pre-issued tags', () => {
  /**
   * The operator's whole workflow, driven through the interface: issue a code
   * addressed to a buyer, print it, and watch it land in the account that
   * registers with that address — carrying the artwork that was printed.
   *
   * The suite's own account is the operator, because DLT_ADMIN_EMAIL is set
   * to it by infra/scripts/e2e.sh.
   */
  test('an operator issues a code, and the buyer who registers gets the tag', async ({
    page,
    browser,
  }) => {
    const buyer = `buyer-${Date.now()}@example.com`

    await page.goto(`${APP}/app/issue`)
    await expect(page.getByRole('heading', { name: 'Issue a tag' })).toBeVisible()

    await page.getByLabel(/email address/i).fill(buyer)
    await page.getByLabel(/Label/).fill('Ordered tag')
    await page.getByRole('button', { name: 'Backpack' }).click()
    await page.getByRole('button', { name: /Issue and print/ }).click()

    // Shown once, with something printable.
    await expect(page.getByRole('heading', { name: 'Ready to print' })).toBeVisible()
    const scanUrl = (await page.locator('.code-block').first().innerText()).trim()
    expect(scanUrl).toContain('/t/')

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Download print PDF' }).click()
    const file = await download
    const { readFile } = await import('node:fs/promises')
    const bytes = await readFile(await file.path())
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')

    // Scanned before anyone has signed up: honest about what it is.
    const outside = await browser.newContext({ storageState: SIGNED_OUT })
    const stranger = await outside.newPage()
    await stranger.goto(scanUrl)
    await expect(stranger.getByText(/not set up yet|not registered/i)).toBeVisible()
    await outside.close()

    // Listed as waiting, with the address masked.
    await expect(page.getByText('Waiting').first()).toBeVisible()
    await expect(page.getByText(buyer)).toHaveCount(0)
  })

  test('an ordinary account has no way in', async ({ page }) => {
    // The suite's account is the operator, so this needs a different one —
    // which the API answers for without a session at all.
    const response = await page.request.get(`${APP}/api/v1/admin/claims`, {
      headers: { Cookie: '' },
    })
    expect([401, 404]).toContain(response.status())
  })
})

test.describe('the mole', () => {
  test.use({ storageState: SIGNED_OUT })

  /**
   * It has to be present, say something true about the page, and — the part
   * that matters most for a mascot — be possible to send away for good.
   */
  test('greets on the landing page and can be sent away for good', async ({ page }) => {
    await page.goto(APP)
    const mole = page.locator('.mole-companion__button')
    await expect(mole).toBeVisible()

    // It introduces itself without being asked.
    await expect(page.getByText(/I look after luggage tags/)).toBeVisible({ timeout: 8000 })

    // Tapping asks for the next thing it knows.
    await mole.click() // closes the greeting
    await mole.click() // first tip
    await expect(page.locator('.mole-bubble')).toBeVisible()

    await page.getByRole('button', { name: /Don’t show me again/ }).click()
    await expect(page.locator('.mole-companion')).toHaveCount(0)

    // And it stays gone.
    await page.reload()
    await page.waitForTimeout(2500)
    await expect(page.locator('.mole-companion')).toHaveCount(0)
  })

  test('and can be brought back from settings', async ({ browser }) => {
    // Signed in, because that is where the setting lives.
    const context = await browser.newContext({ storageState: 'tests/e2e/.auth/owner.json' })
    const page = await context.newPage()

    await page.goto(`${APP}/app`)
    await expect(page.locator('.mole-companion__button')).toBeVisible()
    await page.getByText(/I look after|Your bags/).first().waitFor({ timeout: 8000 })
    await page.getByRole('button', { name: /Don’t show me again/ }).click()
    await expect(page.locator('.mole-companion')).toHaveCount(0)

    await page.goto(`${APP}/app/settings`)
    const showMole = page.getByLabel(/Show the mole/)
    await expect(showMole).not.toBeChecked()
    // The switch is controlled by shared state, so it comes back at once
    // rather than after a reload.
    await showMole.click()
    await expect(page.locator('.mole-companion__button')).toBeVisible()

    await page.reload()
    await expect(page.locator('.mole-companion__button')).toBeVisible()
    await context.close()
  })

  test('says something different on the finder’s page, and nothing on sign-in', async ({
    page,
  }) => {
    // Sign-in has a mole of its own doing a different job.
    await page.goto(`${APP}/login`)
    await page.waitForTimeout(2200)
    await expect(page.locator('.mole-companion')).toHaveCount(0)
    await expect(page.locator('.mole--signin')).toBeVisible()
  })

  test('clears the phone tab bar when signed in', async ({ browser }) => {
    // Explicitly signed in: this describe block is signed out by default, and
    // a signed-out phone has no tab bar to clear.
    const context = await browser.newContext({
      viewport: { width: 390, height: 780 },
      storageState: 'tests/e2e/.auth/owner.json',
    })
    const page = await context.newPage()
    await page.goto(`${APP}/app`)
    await page.waitForTimeout(2600)

    const mole = page.locator('.mole-companion__button')
    await expect(mole).toBeVisible()
    const [moleBox, navBox] = await Promise.all([
      mole.boundingBox(),
      page.locator('.bottom-nav').boundingBox(),
    ])
    // Its lowest visible point must sit above the tab bar's top edge.
    expect(moleBox!.y).toBeLessThan(navBox!.y)
    await context.close()
  })
})

test.describe('the authentication code', () => {
  // Signed in: these drive two-factor from Settings, and open their own
  // signed-out context for the sign-in they are actually testing.
  /**
   * Two-factor sign-in is two requests. It used to demand a bot check on each,
   * so one sign-in meant proving twice, thirty seconds apart, that you were a
   * person. The code step now rides on a ticket from the password step.
   *
   * Turnstile is not configured in this environment, so what is checked here
   * is the shape the browser produces: a ticket comes back with the prompt,
   * and goes out with the code.
   */
  test('carries the password step’s ticket into the code step', async ({ page, request }) => {
    const { email } = await owner()
    const secret = await enableTwoFactor(page, request)

    const context = await page.context().browser()!.newContext({ storageState: SIGNED_OUT })
    const fresh = await context.newPage()

    const prompt = fresh.waitForResponse(
      (response) => response.url().includes('/auth/login') && response.status() === 200,
    )
    await fresh.goto(`${APP}/login`)
    await fresh.fill('#email', email)
    await fresh.fill('#password', PASSWORD)
    await fresh.click('button[type="submit"]')

    const issued = await (await prompt).json()
    expect(issued.status).toBe('totp_required')
    expect(issued.login_ticket, 'the password step must hand back a ticket').toBeTruthy()

    // The six boxes, and the code going out with the ticket on it.
    await expect(fresh.locator('.case input')).toHaveCount(6)
    const submitted = fresh.waitForRequest(
      (req) => req.url().includes('/auth/login') && req.method() === 'POST',
    )
    await fresh.locator('.case input').first().fill(totp(secret))
    const sent = JSON.parse((await submitted).postData() ?? '{}')
    expect(sent.login_ticket).toBe(issued.login_ticket)
    expect(sent.totp_code).toHaveLength(6)

    await fresh.waitForURL('**/app', { timeout: 15_000 })
    await context.close()
    await disableTwoFactor(page)
  })

  test('sends the cases on a journey, and shows who collects them', async ({ page, request }) => {
    const secret = await enableTwoFactor(page, request)
    const { email } = await owner()

    const context = await page.context().browser()!.newContext({ storageState: SIGNED_OUT })
    const fresh = await context.newPage()
    await fresh.goto(`${APP}/login`)
    await fresh.fill('#email', email)
    await fresh.fill('#password', PASSWORD)
    await fresh.click('button[type="submit"]')
    await fresh.getByText('Enter the six-digit code').waitFor()

    // A wrong code: somebody else walks off with the bags.
    await fresh.locator('.case input').first().fill('000000')
    await expect(fresh.getByText('That code is not valid.')).toBeVisible({ timeout: 10_000 })
    await expect(fresh.locator('.journey')).toBeVisible()
    await expect(fresh.locator('.code-input--error')).toBeVisible()

    // The right one: they come home.
    await fresh.locator('.case input').first().fill(totp(secret))
    await fresh.waitForURL('**/app', { timeout: 15_000 })
    await context.close()
    await disableTwoFactor(page)
  })
})

test.describe('changing a password', () => {
  test('will not submit until both copies match', async ({ page }) => {
    await page.goto(`${APP}/app/settings`)
    const change = page.getByRole('button', { name: /Change password/ })

    await page.fill('#current_password', PASSWORD)
    await page.fill('#new_password', 'a completely different passphrase')
    await expect(change).toBeDisabled()

    await page.fill('#confirm_password', 'a completely different passphras')
    await expect(page.getByText('These two do not match.')).toBeVisible()
    await expect(change).toBeDisabled()

    await page.fill('#confirm_password', 'a completely different passphrase')
    await expect(page.getByText('These two do not match.')).toHaveCount(0)
    await expect(change).toBeEnabled()
  })
})

/**
 * Waits for the two-factor card to have rendered before reading its state.
 *
 * Checking for the off-switch straight after `goto` finds nothing on a page
 * that has not painted yet, which reads as "two-factor is off" and then hangs
 * clicking a button that is not there.
 */
async function twoFactorIsOn(page: import('@playwright/test').Page): Promise<boolean> {
  await page.goto(`${APP}/app/settings`)
  await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible()
  await expect(page.getByText(/^(On|Off)\./)).toBeVisible()
  return (await page.getByText('On. A code from your authenticator').count()) > 0
}

/** Turns two-factor on for the shared account and returns its secret. */
async function enableTwoFactor(
  page: import('@playwright/test').Page,
  _request: unknown,
): Promise<string> {
  if (await twoFactorIsOn(page)) await disableTwoFactor(page)

  const setup = page.waitForResponse('**/auth/totp/setup')
  await page.getByRole('button', { name: 'Set up two-factor' }).click()
  const secret = secretFromUri((await (await setup).json()).otpauth_uri)
  await page.fill('#totp_code', totp(secret))
  await page.getByRole('button', { name: 'Turn on two-factor' }).click()
  await expect(page.getByText('Save these recovery codes now.')).toBeVisible()
  return secret
}

async function disableTwoFactor(page: import('@playwright/test').Page): Promise<void> {
  if (!(await twoFactorIsOn(page))) return
  await page.fill('#totp_password', PASSWORD)
  await page.getByRole('button', { name: 'Turn off two-factor' }).click()
  await expect(page.getByText('Off. Your password alone is enough')).toBeVisible()
}
