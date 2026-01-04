/**
 * Category 6: UI Indicators
 * Tests that offline/sync status is accurately displayed.
 *
 * SKIP REASON: These tests require offline UI components which are
 * NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline indicator component (data-testid="offline-indicator")
 * 2. Pending sync count badge (data-testid="pending-sync-count")
 * 3. Per-item sync status icons (sync-status-pending, syncing, synced)
 * 4. Listen to navigator.onLine events to update indicator state
 *
 * See: docs/application-architecture.md "Offline UI Components"
 */
import { test, expect } from './fixtures/offline'



test.describe('6.1 Offline Status Display', () => {
  test('offline indicator appears when network drops', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User is on the app
    await page.goto('/docs')
    await expect(page.getByTestId('offline-indicator')).not.toBeVisible()

    // WHEN: Network drops
    await goOffline()

    // THEN: Offline indicator appears
    await expect(page.getByTestId('offline-indicator')).toBeVisible()
    await expect(page.getByTestId('offline-indicator')).toHaveText(/offline/i)
  })

  test('offline indicator disappears when back online', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User is offline
    await page.goto('/docs')
    await goOffline()
    await expect(page.getByTestId('offline-indicator')).toBeVisible()

    // WHEN: Network returns
    await goOnline()

    // THEN: Offline indicator disappears
    await expect(page.getByTestId('offline-indicator')).not.toBeVisible()
  })

  test('pending sync count updates in real-time', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User is on docs page
    await page.goto('/docs')
    await goOffline()

    // WHEN: User creates multiple documents
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0')

    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    let titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Count Test 1')
    await page.goto('/docs')
    await expect(page.getByTestId('pending-sync-count')).toHaveText('1')

    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Count Test 2')
    await page.goto('/docs')
    await expect(page.getByTestId('pending-sync-count')).toHaveText('2')

    // WHEN: User comes back online and syncs
    await goOnline()

    // THEN: Count decreases as syncs complete
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 10000 })
  })

  test('individual items show sync status', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User creates a document offline
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Status Test')
    await page.goto('/docs')

    // THEN: Item shows pending status icon
    const docItem = page.getByTestId('doc-item').filter({ hasText: 'Status Test' })
    await expect(docItem.getByTestId('sync-status-pending')).toBeVisible()

    // WHEN: User comes back online
    await goOnline()

    // THEN: Status transitions to syncing then synced
    await expect(docItem.getByTestId('sync-status-syncing')).toBeVisible()
    await expect(docItem.getByTestId('sync-status-synced')).toBeVisible({ timeout: 10000 })
  })
})
