/**
 * Category 14: Server Validation Failures
 * Tests handling of server validation errors during sync.
 *
 * SKIP REASON: These tests require offline mutation queue with error handling
 * which is NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue with IndexedDB persistence
 * 2. Sync error handling and display (data-testid="sync-error-icon")
 * 3. Retry mechanism with backoff (data-testid="retry-sync-button")
 * 4. Pending sync count UI (data-testid="pending-sync-count")
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'


test.describe('14.1 Invalid Offline Data', () => {
  test('handles server validation error for offline-created data', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User creates a document offline with empty title
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    // Don't type anything - leave title empty (invalid)
    await page.goto('/docs')

    // Mock validation error response
    await page.route('**/api/documents', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 400,
          body: JSON.stringify({ error: 'Title is required' })
        })
      } else {
        route.continue()
      }
    })

    // WHEN: User comes back online and sync is attempted
    await goOnline()

    // THEN: Shows validation error from server
    await expect(page.getByText(/title.*required|validation.*failed/i)).toBeVisible({ timeout: 10000 })
    // AND: Item stays in pending state with error indicator
    await expect(page.getByTestId('sync-error-icon')).toBeVisible()
  })

  test('server 500 error during sync shows retry option', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User creates document offline
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Server Error Test')
    await page.goto('/docs')

    // WHEN: Server returns 500 on sync
    await page.route('**/api/documents', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: JSON.stringify({ error: 'Internal error' }) })
      } else {
        route.continue()
      }
    })
    await goOnline()

    // THEN: Shows server error with retry option
    await expect(page.getByText(/server error|try again/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('retry-sync-button')).toBeVisible()
  })

  test('rate limited sync retries with backoff', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User has pending mutations
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Rate Test')
    await page.goto('/docs')

    // WHEN: Server rate limits first requests then succeeds
    let requestCount = 0
    await page.route('**/api/documents', (route) => {
      if (route.request().method() === 'POST') {
        requestCount++
        if (requestCount <= 2) {
          route.fulfill({ status: 429, headers: { 'Retry-After': '1' } })
        } else {
          route.continue()
        }
      } else {
        route.continue()
      }
    })
    await goOnline()

    // THEN: Eventually syncs after backoff
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 30000 })
  })
})
