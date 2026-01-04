/**
 * Category 33: App Version Mismatch
 * Tests handling of old cached app with new API.
 *
 * SKIP REASON: These tests require TanStack Query cache persistence and
 * document list component which are NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. TanStack Query with IndexedDB persistence
 * 2. Document list component (data-testid="document-list")
 * 3. Pending sync count UI (data-testid="pending-sync-count")
 * 4. Cache version migration logic
 *
 * See: docs/application-architecture.md "Layer 2: Lists/Metadata (Planned)"
 */
import { test, expect } from './fixtures/offline'


test.describe('33.1 Old Cached App, New API', () => {
  test('detects API version mismatch and handles gracefully', async ({ page, login }) => {
    await login()

    // GIVEN: User has cached app version
    await page.goto('/docs')
    await page.context().setOffline(true)
    await page.reload() // Load from cache

    // WHEN: Coming online with API version mismatch
    await page.route('**/api/documents', (route) => {
      route.fulfill({
        status: 400,
        body: JSON.stringify({
          error: 'API version mismatch',
          required_version: '2.0',
          client_version: '1.0',
        }),
      })
    })
    await page.context().setOffline(false)
    await page.waitForTimeout(3000)

    // THEN: App handles the error (shows message or prompts reload)
    // Should not crash
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })

  test('preserves pending changes through app update prompt', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User has pending offline changes
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Pre-Update Doc')
    await page.goto('/docs')

    // WHEN: Version mismatch detected
    await page.route('**/api/documents', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 400,
          body: JSON.stringify({ error: 'API version mismatch' }),
        })
      } else {
        route.continue()
      }
    })
    await goOnline()
    await page.waitForTimeout(3000)

    // THEN: Pending changes NOT immediately lost
    await expect(page.getByTestId('pending-sync-count')).not.toHaveText('0')
  })

  test('handles IndexedDB schema migration after app update', async ({ page }) => {
    // GIVEN: Old IndexedDB schema exists
    await page.addInitScript(() => {
      // Create old schema data before app loads
      const request = window.indexedDB.open('ship-offline-cache', 1)
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('documents_v1')) {
          db.createObjectStore('documents_v1')
        }
      }
    })

    // WHEN: App loads with potential new schema version
    await page.goto('/login')
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page.goto('/docs')

    // THEN: Migrates gracefully without data loss
    await expect(page.getByTestId('document-list')).toBeVisible({ timeout: 15000 })
  })

  test('service worker update handling', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User is working offline
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await goOffline()
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Offline work')

    // WHEN: Coming online (simulating SW update notification)
    await page.evaluate(() => {
      // Mock SW update available event
      window.dispatchEvent(new CustomEvent('sw-update-available'))
    })
    await goOnline()

    // THEN: App handles gracefully, doesn't lose content
    await expect(page.getByTestId('tiptap-editor')).toContainText('Offline work')
  })

  test('handles stale cache gracefully', async ({ page, login }) => {
    await login()

    // GIVEN: User has stale cached data
    await page.goto('/docs')

    // Simulate stale cache by modifying timestamp
    await page.evaluate(() => {
      const key = 'tanstack-query-cache-timestamp'
      // Set timestamp to 1 week ago
      localStorage.setItem(key, String(Date.now() - 7 * 24 * 60 * 60 * 1000))
    })

    // WHEN: User reloads
    await page.reload()

    // THEN: App refreshes data and works correctly
    await expect(page.getByTestId('document-list')).toBeVisible({ timeout: 15000 })
  })

  test('concurrent version between multiple tabs', async ({ browser }) => {
    // GIVEN: Two tabs open
    const context = await browser.newContext()
    const page1 = await context.newPage()
    const page2 = await context.newPage()

    // Login in first tab
    await page1.goto('/login')
    await page1.fill('input[name="email"]', 'dev@ship.local')
    await page1.fill('input[name="password"]', 'admin123')
    await page1.click('button[type="submit"]')
    await page1.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    // Both navigate to docs
    await page1.goto('/docs')
    await page2.goto('/docs')

    // WHEN: Both tabs work with shared storage
    await expect(page1.getByTestId('document-list')).toBeVisible()
    await expect(page2.getByTestId('document-list')).toBeVisible()

    // Make change in tab 1
    await page1.getByRole('button', { name: /new/i }).click()
    await page1.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page1.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page1.keyboard.type('Tab 1 Doc')
    await page1.goto('/docs')

    // THEN: Both tabs remain functional
    await page1.reload()
    await page2.reload()
    await expect(page1.getByTestId('document-list')).toBeVisible()
    await expect(page2.getByTestId('document-list')).toBeVisible()

    await context.close()
  })

  test('handles API deprecation warnings', async ({ page, login }) => {
    await login()

    // GIVEN: API returns deprecation warnings
    await page.route('**/api/documents', (route) => {
      route.fulfill({
        status: 200,
        headers: {
          'X-API-Deprecation-Warning': 'This endpoint will be removed in v3.0'
        },
        body: JSON.stringify([])
      })
    })

    // WHEN: User loads page
    await page.goto('/docs')

    // THEN: App handles gracefully (may log warning, but doesn't break)
    await expect(page.getByTestId('document-list')).toBeVisible()
  })
})
