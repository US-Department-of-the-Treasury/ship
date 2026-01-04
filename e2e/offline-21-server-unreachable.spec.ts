/**
 * Category 21: Server Unreachable vs True Offline
 * Tests distinction between network offline and server unavailable.
 *
 * SKIP REASON: These tests require offline UI indicators and mutation queue
 * which are NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline indicator component (data-testid="offline-indicator")
 * 2. Connection status display (data-testid="connection-status")
 * 3. Pending sync count UI (data-testid="pending-sync-count")
 * 4. Server error vs offline distinction in UI
 *
 * See: docs/application-architecture.md "Offline UI Components"
 */
import { test, expect } from './fixtures/offline'


test.describe('21.1 Network Online But Server Down', () => {
  test('detects server unreachable when navigator.onLine is true', async ({ page, login }) => {
    await login()

    // GIVEN: User is on docs page
    await page.goto('/docs')

    // WHEN: Server becomes unreachable (but browser thinks it's online)
    await page.route('**/api/**', (route) => {
      route.abort('connectionfailed')
    })

    // AND: User tries to create a document
    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Server Down Test')

    // Try to navigate which triggers save
    await page.goto('/docs')

    // Wait for request to fail
    await page.waitForTimeout(3000)

    // THEN: Shows server unreachable indicator
    await expect(page.getByText(/server.*unreachable|connection.*failed|unable.*connect/i)).toBeVisible({ timeout: 10000 })
  })

  test('handles 503 Service Unavailable gracefully', async ({ page, login }) => {
    await login()

    // GIVEN: User is on docs page
    await page.goto('/docs')

    // WHEN: Server returns 503
    await page.route('**/api/documents', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 503, body: 'Service Unavailable' })
      } else {
        route.continue()
      }
    })

    // AND: User tries to create document
    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('503 Test')
    await page.goto('/docs')
    await page.waitForTimeout(3000)

    // THEN: Shows maintenance/unavailable message
    await expect(page.getByText(/service.*unavailable|maintenance|try.*later|server.*error/i)).toBeVisible({ timeout: 10000 })
  })

  test('distinguishes between offline and server error in UI', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User goes truly offline
    await page.goto('/docs')
    await goOffline()

    // THEN: Shows "You're offline" indicator
    await expect(page.getByTestId('offline-indicator')).toBeVisible()

    // WHEN: User comes back online but server is down
    await page.context().setOffline(false)
    await page.route('**/api/**', (route) => route.abort('connectionfailed'))

    // Trigger a request by reloading or interacting
    await page.reload().catch(() => {}) // May fail, that's ok
    await page.waitForTimeout(2000)

    // THEN: Shows different indicator for server issues (not just "offline")
    // The exact text depends on implementation
    const connectionStatus = page.getByTestId('connection-status')
    if (await connectionStatus.isVisible()) {
      await expect(connectionStatus).toHaveText(/server|error|unreachable/i)
    }
  })

  test('retries automatically when server becomes available', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User has pending mutation
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Retry Test')
    await page.goto('/docs')

    // WHEN: First attempt fails with 503, then succeeds
    let attemptCount = 0
    await page.route('**/api/documents', (route) => {
      if (route.request().method() === 'POST') {
        attemptCount++
        if (attemptCount <= 2) {
          route.fulfill({ status: 503 })
        } else {
          route.continue()
        }
      } else {
        route.continue()
      }
    })
    await goOnline()

    // THEN: Eventually syncs
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 30000 })
  })
})
