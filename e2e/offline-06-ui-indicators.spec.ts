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

    // WHEN: User creates documents offline (without editing titles to avoid update mutations)
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0')

    // Create first document - just create, no title edit
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    // Wait for IndexedDB persistence before page reload
    await page.waitForTimeout(500)
    await page.goto('/docs')
    // Count increases for the create mutation
    const count1 = await page.getByTestId('pending-sync-count').textContent()
    expect(parseInt(count1 || '0')).toBeGreaterThan(0)

    // Create second document - just create, no title edit
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    // Wait for IndexedDB persistence before page reload
    await page.waitForTimeout(500)
    await page.goto('/docs')
    // Count increases further
    const count2 = await page.getByTestId('pending-sync-count').textContent()
    expect(parseInt(count2 || '0')).toBeGreaterThan(parseInt(count1 || '0'))

    // WHEN: User comes back online and syncs
    await goOnline()

    // Wait a bit and then dump debug logs
    await page.waitForTimeout(2000)
    const logs = await page.evaluate(() => localStorage.getItem('__debug_logs__'))
    console.log('Debug logs:', logs)

    // THEN: Count decreases to 0 as syncs complete
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 10000 })
  })

  test('individual items show sync status', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User creates a document offline (from documents page, not editor)
    await page.goto('/docs')
    await goOffline()

    // Click New Document - this will navigate to editor
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    // Wait for IndexedDB persistence before page reload
    await page.waitForTimeout(500)

    // Navigate back - the editor may redirect us anyway when offline
    // Wait for navigation to complete and settle
    await page.goto('/docs')
    await page.waitForLoadState('networkidle')

    // THEN: Check that we have at least one pending change tracked
    await expect(page.getByTestId('pending-sync-count')).not.toHaveText('0', { timeout: 5000 })

    // And that the doc item with pending sync icon exists in sidebar
    const pendingSyncIcon = page.getByTestId('sync-status-pending').first()
    await expect(pendingSyncIcon).toBeVisible({ timeout: 5000 })

    // WHEN: User comes back online
    await goOnline()

    // THEN: Status transitions through syncing to synced (or directly to synced if fast)
    // The syncing state may be too brief to catch, so we check for either
    await expect(
      page.getByTestId('sync-status-syncing').or(page.getByTestId('sync-status-synced'))
    ).toBeVisible({ timeout: 5000 })

    // Eventually all items should be synced (count = 0)
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 10000 })
  })
})
