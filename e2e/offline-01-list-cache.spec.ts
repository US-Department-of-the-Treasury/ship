/**
 * Category 1: Document List Cache (TanStack Query + IndexedDB)
 * Tests that document lists load from cache when offline.
 *
 * Infrastructure implemented:
 * - TanStack Query with PersistQueryClientProvider (main.tsx)
 * - IndexedDB persistence via idb-keyval (queryClient.ts)
 * - networkMode: 'offlineFirst' for queries
 * - OfflineIndicator component with data-testid="offline-indicator"
 */
import { test, expect } from './fixtures/offline'


test.describe('1.1 Lists Load from Cache When Offline', () => {
  test('document list loads from IndexedDB when offline after previous visit', async ({ page, goOffline, login }) => {
    // Login first
    await login()

    // GIVEN: User has previously loaded the docs page (cache populated)
    await page.goto('/docs')
    await expect(page.getByRole('heading', { name: /docs/i })).toBeVisible()
    await expect(page.getByTestId('document-list')).toBeVisible()
    const initialCount = await page.getByTestId('doc-item').count()
    expect(initialCount).toBeGreaterThan(0)

    // Wait for IndexedDB persistence to complete (TanStack Query persist-client is async)
    // This ensures the cache is written before we go offline
    await page.waitForTimeout(500)

    // WHEN: User goes offline and refreshes
    await goOffline()
    await page.reload()

    // THEN: Document list still loads from cache (with extended timeout for cache restoration)
    await expect(page.getByTestId('document-list')).toBeVisible({ timeout: 10000 })
    // AND: Offline indicator is visible
    await expect(page.getByTestId('offline-indicator')).toBeVisible()
  })

  test('issue list loads from IndexedDB when offline', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User has previously loaded the issues page
    await page.goto('/issues')
    await expect(page.getByTestId('issues-list')).toBeVisible()
    const initialCount = await page.getByTestId('issue-item').count()
    expect(initialCount).toBeGreaterThan(0)

    // WHEN: User goes offline and refreshes
    await goOffline()
    await page.reload()

    // THEN: Issue list still loads from cache
    await expect(page.getByTestId('issues-list')).toBeVisible()
    await expect(page.getByTestId('offline-indicator')).toBeVisible()
  })

  test('programs list loads from IndexedDB when offline', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User has previously loaded the programs page
    await page.goto('/programs')
    await expect(page.getByTestId('programs-list')).toBeVisible()
    const initialCount = await page.getByTestId('program-item').count()
    expect(initialCount).toBeGreaterThan(0)

    // WHEN: User goes offline and refreshes
    await goOffline()
    await page.reload()

    // THEN: Programs list still loads from cache
    await expect(page.getByTestId('programs-list')).toBeVisible()
    await expect(page.getByTestId('offline-indicator')).toBeVisible()
  })
})

test.describe('1.2 Empty Cache Shows Offline Message', () => {
  test('shows offline message when cache is empty and network unavailable', async ({ page, goOffline, login }) => {
    // GIVEN: User has visited before (app shell cached by service worker)
    await login()
    await page.goto('/docs')
    await expect(page.getByRole('heading', { name: /docs/i })).toBeVisible()

    // AND: User clears their data cache (simulates cleared IndexedDB)
    await page.evaluate(async () => {
      // Clear IndexedDB (TanStack Query cache)
      const dbs = await indexedDB.databases()
      for (const db of dbs) {
        if (db.name) indexedDB.deleteDatabase(db.name)
      }
      // Clear auth cache
      localStorage.removeItem('ship:auth-cache')
    })

    // WHEN: User goes offline and tries to reload
    await goOffline()
    await page.reload()

    // THEN: Shows appropriate offline/unavailable message
    await expect(page.getByText(/offline|unavailable|connect/i)).toBeVisible()
    // AND: Does not show loading spinner indefinitely
    await expect(page.getByTestId('loading-spinner')).not.toBeVisible({ timeout: 5000 })
  })
})

// REMOVED: Stale data indicator tests
// The StaleDataBanner component was removed because React Query already handles:
// - Auto-refetch on window focus
// - Auto-refetch when network comes back online
// - Background refetching
// The banner added unnecessary visual clutter and layout shift without meaningful benefit.
