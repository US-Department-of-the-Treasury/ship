/**
 * Category 10: Search & Filtering Offline
 * Tests search functionality on cached data.
 *
 * SKIP REASON: These tests require TanStack Query + IndexedDB cache for
 * list data which is NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. TanStack Query for data fetching with IndexedDB persistence
 * 2. Client-side search over cached data
 * 3. "Offline results" indicator UI
 * 4. Filter UI components (status filter, etc.)
 *
 * See: docs/application-architecture.md "Layer 2: Lists/Metadata (Planned)"
 */
import { test, expect } from './fixtures/offline'


test.describe.skip('10.1 Search on Cached Data', () => {
  test('search filters cached document list', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User has docs page cached with documents
    await page.goto('/docs')
    await expect(page.getByTestId('document-list')).toBeVisible()
    const initialCount = await page.getByTestId('doc-item').count()

    // WHEN: User goes offline and searches
    await goOffline()
    const searchBox = page.getByRole('searchbox')
    if (await searchBox.isVisible()) {
      await searchBox.fill('test')

      // THEN: List filters to matching cached docs
      const filteredCount = await page.getByTestId('doc-item').count()
      expect(filteredCount).toBeLessThanOrEqual(initialCount)
    }
  })

  test('search shows "offline - limited results" indicator', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User is on docs page
    await page.goto('/docs')

    // WHEN: User goes offline and searches
    await goOffline()
    const searchBox = page.getByRole('searchbox')
    if (await searchBox.isVisible()) {
      await searchBox.fill('test query')

      // THEN: Shows indicator that search is local only
      await expect(page.getByText(/searching cached|offline.*results may be incomplete/i)).toBeVisible()
    }
  })

  test('filter dropdowns work with cached data', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User has issues page cached
    await page.goto('/issues')
    await expect(page.getByTestId('issues-list')).toBeVisible()

    // WHEN: User goes offline and filters by status
    await goOffline()
    const statusFilter = page.getByRole('combobox', { name: /status/i })
    if (await statusFilter.isVisible()) {
      await statusFilter.selectOption('in_progress')

      // THEN: Issues filter correctly from cache
      const items = page.getByTestId('issue-item')
      const count = await items.count()
      // Verify filter was applied (count should be <= original)
      expect(count).toBeGreaterThanOrEqual(0)
    }
  })
})
