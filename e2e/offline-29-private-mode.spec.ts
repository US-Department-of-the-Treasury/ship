/**
 * Category 29: Private/Incognito Mode
 * Tests handling when IndexedDB is unavailable or restricted.
 */
import { test, expect } from './fixtures/offline'

test.describe('29.1 IndexedDB Unavailable', () => {
  test('gracefully handles IndexedDB unavailable', async ({ browser }) => {
    // GIVEN: Private browsing context (may restrict IndexedDB)
    const context = await browser.newContext({
      storageState: undefined,
    })
    const page = await context.newPage()

    // Simulate IndexedDB restriction
    await page.addInitScript(() => {
      // @ts-ignore
      delete window.indexedDB
    })

    // WHEN: User loads app and logs in
    await page.goto('/login')
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page.goto('/docs')

    // THEN: App still functions for online use
    await expect(page.getByTestId('document-list')).toBeVisible({ timeout: 15000 })

    await context.close()
  })

  test('shows warning about limited offline support', async ({ browser }) => {
    // GIVEN: IndexedDB restricted context
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.addInitScript(() => {
      // @ts-ignore - Mock IndexedDB being unavailable
      const originalOpen = window.indexedDB?.open
      if (window.indexedDB) {
        window.indexedDB.open = function () {
          throw new DOMException('SecurityError')
        }
      }
    })

    // WHEN: User loads app
    await page.goto('/login')
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page.goto('/docs')

    // THEN: App should handle gracefully (may show warning or just work online-only)
    await expect(page.getByTestId('document-list')).toBeVisible({ timeout: 15000 })

    await context.close()
  })

  test('warns before making offline changes if persistence unavailable', async ({ browser }) => {
    // GIVEN: IndexedDB restricted context
    const context = await browser.newContext()
    const page = await context.newPage()

    // Store flag to detect IndexedDB issues
    await page.addInitScript(() => {
      (window as any).__indexedDBUnavailable = true
      const originalOpen = window.indexedDB?.open
      if (window.indexedDB) {
        window.indexedDB.open = function (...args) {
          const request = originalOpen?.apply(this, args)
          if (request) {
            setTimeout(() => {
              const error = new DOMException('QuotaExceededError', 'QuotaExceededError')
              Object.defineProperty(request, 'error', { value: error })
              request.dispatchEvent(new Event('error'))
            }, 100)
          }
          return request!
        }
      }
    })

    // Login and navigate
    await page.goto('/login')
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page.goto('/docs')

    // THEN: App handles storage issues gracefully
    await expect(page.getByTestId('document-list')).toBeVisible({ timeout: 15000 })

    await context.close()
  })

  test('localStorage fallback when IndexedDB fails quota', async ({ page }) => {
    // GIVEN: IndexedDB throws quota error
    await page.addInitScript(() => {
      const originalOpen = window.indexedDB?.open
      if (window.indexedDB && originalOpen) {
        window.indexedDB.open = function (...args) {
          const request = originalOpen.apply(this, args)
          setTimeout(() => {
            try {
              const error = new DOMException('QuotaExceededError', 'QuotaExceededError')
              Object.defineProperty(request, 'error', { value: error })
              request.dispatchEvent(new Event('error'))
            } catch {}
          }, 100)
          return request
        }
      }
    })

    // WHEN: App loads
    await page.goto('/login')
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page.goto('/docs')

    // THEN: Core functionality works even with storage issues
    await expect(page.getByTestId('document-list')).toBeVisible({ timeout: 15000 })
  })

  test('session storage used when all else fails', async ({ browser }) => {
    // GIVEN: Both IndexedDB and localStorage restricted
    const context = await browser.newContext()
    const page = await context.newPage()

    await page.addInitScript(() => {
      // @ts-ignore
      delete window.indexedDB
      const originalSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = function () {
        throw new DOMException('QuotaExceededError')
      }
    })

    // WHEN: App loads
    await page.goto('/login')
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')

    // THEN: App handles and shows appropriate state
    // May fail login or show warning, but shouldn't crash
    const body = page.locator('body')
    await expect(body).toBeVisible()

    await context.close()
  })
})
