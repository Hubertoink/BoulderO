import { expect, test } from '@playwright/test'

const viewports = [
  { name: '320x568', width: 320, height: 568 },
  { name: '375x667', width: 375, height: 667 },
  { name: '390x844', width: 390, height: 844 },
  { name: '844x390', width: 844, height: 390 },
  { name: '412x915', width: 412, height: 915 },
  { name: '768x1024', width: 768, height: 1024 },
]

for (const viewport of viewports) {
  test(`keeps ${viewport.name} free of overflow and modal regressions`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.getByRole('button', { name: 'Karte entdecken' }).click()

    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false)
    await expect(page.locator('.bottom-nav')).toHaveCSS('flex-direction', 'row')

    const signInButton = page.getByRole('button', { name: 'Anmelden', exact: true })
    await signInButton.click()
    const dialog = page.getByRole('dialog', { name: 'BoulderO Konto' })
    const closeButton = dialog.getByRole('button', { name: 'Schließen' })

    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('E-Mail')).toHaveCSS('font-size', '16px')
    await expect(closeButton).toBeFocused()
    await expect.poll(async () => {
      const box = await closeButton.boundingBox()
      return box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height
    }).toBe(true)

    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(signInButton).toBeFocused()
  })
}

test('extends the desktop map to the viewport bottom', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Karte entdecken' }).click()

  await expect.poll(() => page.locator('.map-frame').evaluate((element) => Math.round(element.getBoundingClientRect().bottom))).toBe(768)
  await expect.poll(() => page.locator('.map-view').evaluate((element) => Math.round(element.getBoundingClientRect().bottom))).toBe(768)
})

test('does not scroll short mobile content views', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Karte entdecken' }).click()
  await page.addStyleTag({ content: 'main.view > * { display: none !important; }' })
  for (const name of ['Tagebuch', 'Feed', 'Community']) {
    await page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('button', { name }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight)).toBe(844)
  }
})

test('keeps the mobile app stable behind an offset keyboard viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const viewport = new EventTarget()
    viewport.height = 844
    viewport.offsetTop = 0
    viewport.scale = 1
    window.__setVisualViewport = (height, offsetTop = 0) => {
      viewport.height = height
      viewport.offsetTop = offsetTop
      viewport.dispatchEvent(new Event('resize'))
      viewport.dispatchEvent(new Event('scroll'))
    }
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Karte entdecken' }).click()

  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /interactive-widget=overlays-content/)
  await expect(page.locator('.bottom-nav')).toHaveCSS('position', 'fixed')
  const initialLayout = await page.evaluate(() => ({
    appBottom: Math.round(document.querySelector('.app-shell').getBoundingClientRect().bottom),
    mapBottom: Math.round(document.querySelector('.map-frame').getBoundingClientRect().bottom),
    navBottom: Math.round(document.querySelector('.bottom-nav').getBoundingClientRect().bottom),
  }))
  await page.getByPlaceholder('Hallen in Mannheim suchen').focus()
  await page.evaluate(() => window.__setVisualViewport(520, 96))
  await expect(page.locator('.bottom-nav')).toBeVisible()
  await expect.poll(() => page.evaluate(() => ({
    appBottom: Math.round(document.querySelector('.app-shell').getBoundingClientRect().bottom),
    mapBottom: Math.round(document.querySelector('.map-frame').getBoundingClientRect().bottom),
    navBottom: Math.round(document.querySelector('.bottom-nav').getBoundingClientRect().bottom),
  }))).toEqual(initialLayout)
  await expect.poll(() => page.evaluate(() => ({
    dialogHeight: getComputedStyle(document.documentElement).getPropertyValue('--dialog-viewport-height').trim(),
    dialogTop: getComputedStyle(document.documentElement).getPropertyValue('--dialog-viewport-top').trim(),
  }))).toEqual({ dialogHeight: '520px', dialogTop: '96px' })

  await page.evaluate(() => window.__setVisualViewport(844, 0))
})

test('marks the map field as a search instead of an autofill field', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Karte entdecken' }).click()
  const search = page.getByPlaceholder('Hallen in Mannheim suchen')

  await expect(search).toHaveAttribute('type', 'search')
  await expect(search).toHaveAttribute('autocomplete', 'off')
  await expect(search).toHaveAttribute('enterkeyhint', 'search')
  await expect(search).toHaveCSS('appearance', 'none')
})

test('keeps mobile dialogs flush with an offset keyboard viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dialog-viewport-height'))).toBe('844px')
  await page.evaluate(() => {
    const backdrop = document.createElement('div')
    backdrop.className = 'composer-backdrop keyboard-test-backdrop'
    backdrop.style.setProperty('--dialog-viewport-height', '520px')
    backdrop.style.setProperty('--dialog-viewport-top', '96px')
    backdrop.innerHTML = '<section class="journal-composer group-editor"><div style="height: 800px"></div></section>'
    const host = document.createElement('main')
    host.className = 'compact-view'
    host.append(backdrop)
    document.body.append(host)
  })

  await expect.poll(() => page.locator('.keyboard-test-backdrop').evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { top: Math.round(bounds.top), width: Math.round(bounds.width), height: Math.round(bounds.height), bottom: Math.round(bounds.bottom) }
  })).toEqual({ top: 96, width: 390, height: 520, bottom: 616 })

  await expect.poll(() => page.locator('.keyboard-test-backdrop .journal-composer').evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { top: Math.round(bounds.top), bottom: Math.round(bounds.bottom), scrollable: element.scrollHeight > element.clientHeight }
  })).toEqual({ top: 96, bottom: 616, scrollable: true })
})

test('sizes the group map picker against the keyboard viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dialog-viewport-height'))).toBe('844px')
  await page.evaluate(() => {
    const backdrop = document.createElement('div')
    backdrop.className = 'composer-backdrop group-spot-map-backdrop keyboard-test-map-backdrop'
    backdrop.style.setProperty('--dialog-viewport-height', '520px')
    backdrop.style.setProperty('--dialog-viewport-top', '96px')
    backdrop.innerHTML = '<section class="group-spot-map-dialog"><div style="height: 800px"></div></section>'
    const host = document.createElement('main')
    host.className = 'compact-view'
    host.append(backdrop)
    document.body.append(host)
  })

  await expect.poll(() => page.locator('.keyboard-test-map-backdrop .group-spot-map-dialog').evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { width: Math.round(bounds.width), bottom: Math.round(bounds.bottom), maxHeight: getComputedStyle(element).maxHeight }
  })).toEqual({ width: 390, bottom: 616, maxHeight: '508px' })
})
