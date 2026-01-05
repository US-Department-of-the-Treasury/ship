/**
 * Category 26: Schema/Cache Version Migration
 * Tests cache format migration after app updates.
 *
 * SKIP REASON: These tests require TanStack Query cache with IndexedDB
 * persistence which is NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. TanStack Query with IndexedDB persistence
 * 2. Cache version migration logic
 * 3. Document list component (data-testid="document-list")
 *
 * See: docs/application-architecture.md "Layer 2: Lists/Metadata (Planned)"
 */
import { test, expect } from './fixtures/offline'


test.describe.skip('26.1 Old Cache Format After App Update', () => {
  test('old cache format handled after app update', async ({ page }) => {
    // GIVEN: User has old cache format (simulating pre-update state)
    await page.evaluate(() => {
      // Write old format cache
      localStorage.setItem('tanstack-query-cache-version', '1')
      const oldFormat = {
        state: { queries: [{ queryKey: ['documents'], state: { data: [{ id: '1', title: 'Old' }] } }] },
        version: 1
      }
      localStorage.setItem('REACT_QUERY_OFFLINE_CACHE', JSON.stringify(oldFormat))
    })

    // WHEN: User loads new version of app
    await page.goto('/login')
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page.goto('/docs')

    // THEN: Old cache is migrated or cleared gracefully
    await expect(page.getByTestId('document-list')).toBeVisible({ timeout: 15000 })
  })

  test('cache cleared if migration fails', async ({ page }) => {
    // GIVEN: Incompatible old cache
    await page.evaluate(() => {
      localStorage.setItem('REACT_QUERY_OFFLINE_CACHE', 'not valid json at all {{{')
    })

    // WHEN: App loads
    await page.goto('/login')
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page.goto('/docs')

    // THEN: Cache is cleared and fresh data loaded
    await expect(page.getByTestId('document-list')).toBeVisible({ timeout: 15000 })
  })

  test('IndexedDB version upgrade handled gracefully', async ({ page }) => {
    // GIVEN: Old IndexedDB schema exists
    await page.addInitScript(() => {
      // Create old schema data before app loads
      const request = window.indexedDB.open('ship-offline-cache', 1)
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('documents_v1')) {
          db.createObjectStore('documents_v1') // Old schema
        }
      }
    })

    // WHEN: App loads with new schema version
    await page.goto('/login')
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page.goto('/docs')

    // THEN: Migrates gracefully without data loss
    await expect(page.getByTestId('document-list')).toBeVisible({ timeout: 15000 })
  })

  test('mixed cache versions between tabs handled', async ({ browser }) => {
    // GIVEN: Two tabs with potentially different cache states
    const context = await browser.newContext()
    const page1 = await context.newPage()
    const page2 = await context.newPage()

    // Login in first tab
    await page1.goto('/login')
    await page1.fill('input[name="email"]', 'dev@ship.local')
    await page1.fill('input[name="password"]', 'admin123')
    await page1.click('button[type="submit"]')
    await page1.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    // Navigate to docs in first tab
    await page1.goto('/docs')
    await expect(page1.getByTestId('document-list')).toBeVisible()

    // Second tab navigates
    await page2.goto('/docs')
    await expect(page2.getByTestId('document-list')).toBeVisible()

    // THEN: Both tabs work correctly with shared cache
    await page1.reload()
    await expect(page1.getByTestId('document-list')).toBeVisible()

    await context.close()
  })

  test('cache version mismatch shows update prompt if needed', async ({ page, goOnline }) => {
    // GIVEN: User has cached app version
    await page.goto('/login')
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page.goto('/docs')
    await page.context().setOffline(true)
    await page.reload() // Load from cache

    // WHEN: Coming online with API returning version mismatch
    await page.route('**/api/**', (route) => {
      // First request returns version mismatch
      if (route.request().resourceType() === 'fetch') {
        route.fulfill({
          status: 400,
          body: JSON.stringify({
            error: 'API version mismatch',
            required_version: '2.0',
            client_version: '1.0',
          }),
        })
      } else {
        route.continue()
      }
    })
    await page.context().setOffline(false)
    await page.waitForTimeout(2000)

    // THEN: Either shows update prompt or handles gracefully
    // App should not crash
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })
})
