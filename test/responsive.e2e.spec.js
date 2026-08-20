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