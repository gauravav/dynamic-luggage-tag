/**
 * The parts of the interface that only exist in a browser.
 *
 * Type-checking proves these components compile; it proves nothing about
 * whether the mole covers its eyes, whether the tag list is two-up at phone
 * width, or whether a download arrives. That is what these check.
 */

import { expect, test } from '@playwright/test'
import { APP, SIGNED_OUT, createTag } from './helpers'

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
  test('the print PDF downloads, and the QR opens', async ({ page, request }) => {
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
