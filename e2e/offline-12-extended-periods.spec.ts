/**
 * Category 12: Extended Offline Periods
 * Tests long offline durations and large sync queues.
 *
 * SKIP REASON: These tests require offline mutation queue and sync progress UI
 * which are NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. IndexedDB-backed mutation queue with persistence
 * 2. Pending sync count UI (data-testid="pending-sync-count")
 * 3. Stale data indicator (data-testid="stale-data-banner")
 * 4. Sync progress indicator (data-testid="sync-progress")
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'


// TODO: Skip until offline mutation queue and sync progress UI is implemented (see file header)
test.describe.skip('12.1 Long Offline Duration', () => {
  test('cached data remains usable after extended offline period', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User has data cached
    await page.goto('/docs')
    await expect(page.getByTestId('document-list')).toBeVisible()

    // WHEN: User goes offline and waits (simulating hours)
    await goOffline()
    // Simulate time passing by manipulating Date
    await page.evaluate(() => {
      const realNow = Date.now
      Date.now = () => realNow() + 6 * 60 * 60 * 1000 // 6 hours later
    })
    await page.reload()

    // THEN: Cached data still loads
    await expect(page.getByTestId('document-list')).toBeVisible()
    // AND: Shows "data may be outdated" warning
    await expect(page.getByText(/outdated|hours? ago/i)).toBeVisible()
  })

  test('large sync queue processes completely after extended offline', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User creates many documents offline
    await page.goto('/docs')
    await goOffline()

    for (let i = 1; i <= 10; i++) {
      await page.getByRole('button', { name: 'New Document', exact: true }).click()
      await page.waitForURL(/\/docs\/[^/]+$/)
      const titleInput = page.locator('[contenteditable="true"]').first()
      await titleInput.click()
      await page.keyboard.type(`Bulk Doc ${i}`)
      await page.goto('/docs')
      await page.waitForTimeout(100)
    }

    // WHEN: User comes back online
    await goOnline()

    // THEN: All 10 documents sync (may take time)
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 60000 })

    // AND: All documents exist on server
    const response = await page.request.get('/api/documents?type=wiki')
    const docs = await response.json()
    for (let i = 1; i <= 10; i++) {
      expect(docs.some((d: { title: string }) => d.title === `Bulk Doc ${i}`)).toBe(true)
    }
  })

  test('sync progress indicator shows during large sync', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User has 5 pending mutations
    await page.goto('/docs')
    await goOffline()
    for (let i = 1; i <= 5; i++) {
      await page.getByRole('button', { name: 'New Document', exact: true }).click()
      await page.waitForURL(/\/docs\/[^/]+$/)
      const titleInput = page.locator('[contenteditable="true"]').first()
      await titleInput.click()
      await page.keyboard.type(`Progress Doc ${i}`)
      await page.goto('/docs')
    }

    // WHEN: User comes back online
    await goOnline()

    // THEN: Sync progress is visible (e.g., "Syncing 3/5...")
    await expect(page.getByTestId('sync-progress')).toBeVisible()
    await expect(page.getByTestId('sync-progress')).toContainText(/\d+.*\/.*\d+/)
  })
})
