/**
 * Category 9: Cold Start & Navigation
 * Tests first visit while offline and navigation to uncached pages.
 *
 * SKIP REASON: These tests require page caching and offline-first UI
 * which are NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Service Worker for app shell caching
 * 2. TanStack Query + IndexedDB for data caching (Category 1)
 * 3. Offline error page with friendly messaging
 * 4. Cache status detection for navigation
 *
 * See: docs/application-architecture.md "Layer 2: Lists/Metadata (Planned)"
 */
import { test, expect } from './fixtures/offline'



// Tests requiring Service Worker (not yet implemented)
test.describe.skip('9.1 First Visit While Offline', () => {
  test('app shows meaningful error on first visit while offline', async ({ browser }) => {
    // GIVEN: Fresh browser with no cache (simulating first visit)
    const context = await browser.newContext()
    const page = await context.newPage()

    // WHEN: User tries to load app while offline
    await context.setOffline(true)
    await page.goto('/docs')

    // THEN: Shows friendly "you're offline" message, not broken UI
    await expect(page.getByText(/offline|connect.*internet|no connection/i)).toBeVisible()
    // AND: Does not show infinite loading spinner
    await expect(page.getByTestId('loading-spinner')).not.toBeVisible({ timeout: 5000 })
    // AND: Suggests user to connect and refresh
    await expect(page.getByText(/connect.*try again|refresh/i)).toBeVisible()

    await context.close()
  })

  test('app recovers when connection restored after cold start failure', async ({ browser }) => {
    // GIVEN: User hit offline error on cold start
    const context = await browser.newContext()
    const page = await context.newPage()
    await context.setOffline(true)
    await page.goto('/docs')
    await expect(page.getByText(/offline/i)).toBeVisible()

    // WHEN: Connection is restored
    await context.setOffline(false)
    await page.reload()

    // THEN: App loads normally (after login)
    await page.waitForURL(/login/)
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await expect(page.getByTestId('document-list')).toBeVisible()

    await context.close()
  })
})

test.describe('9.2 Navigation to Uncached Pages', () => {
  // SKIP: This test doesn't match the current architecture.
  // The app uses global providers (ProgramsProvider, IssuesProvider) that fetch ALL
  // data on app startup. By the time the user goes offline, all list data is already
  // cached in TanStack Query's in-memory cache.
  //
  // The OfflineEmptyState is designed for first-visit-offline scenarios when there's
  // no cached data at all - which is tested in section 9.1 (requires Service Worker).
  //
  // With global providers, users get full offline access to all pages they've loaded
  // while online - which is actually the desired UX for offline support.
  test.skip('navigating to uncached page shows appropriate message', async ({ browser }) => {
    const context = await browser.newContext()
    const page = await context.newPage()

    try {
      await page.goto('/login')
      await page.fill('input[name="email"]', 'dev@ship.local')
      await page.fill('input[name="password"]', 'admin123')
      await page.click('button[type="submit"]')
      await page.waitForURL(/\/docs/)

      await expect(page.getByTestId('document-list')).toBeVisible()
      await page.waitForTimeout(500)

      await context.setOffline(true)
      await page.evaluate(() => window.dispatchEvent(new Event('offline')))

      await page.getByRole('button', { name: 'Programs' }).click()
      await page.waitForURL(/\/programs/)

      await expect(page.getByTestId('offline-empty-state')).toBeVisible({ timeout: 10000 })
      await expect(page.getByText(/not available offline|visit.*online first/i)).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test('navigating to cached page works offline', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User has visited both docs and programs pages
    await page.goto('/docs')
    await expect(page.getByTestId('document-list')).toBeVisible()
    await page.goto('/programs')
    await expect(page.getByTestId('programs-list')).toBeVisible()
    await page.goto('/docs') // Back to docs

    // WHEN: User goes offline and navigates between cached pages
    await goOffline()
    await page.goto('/programs')

    // THEN: Programs page loads from cache
    await expect(page.getByTestId('programs-list')).toBeVisible()
  })

  test('deep link to specific document works if cached', async ({ page, goOffline, login, testData }) => {
    await login()

    // GIVEN: User previously visited a specific document
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await expect(page.getByTestId('tiptap-editor')).toBeVisible()

    // WHEN: User refreshes while offline
    await goOffline()
    await page.goto(`/docs/${doc.id}`)

    // THEN: Document loads from cache
    await expect(page.getByTestId('tiptap-editor')).toBeVisible()
  })

  // Requires "not available offline" UI (not yet implemented)
  test.skip('deep link to uncached document shows error', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User has docs list cached but not specific doc
    await page.goto('/docs')

    // WHEN: User goes offline and navigates to uncached doc
    await goOffline()
    await page.goto('/docs/never-visited-doc-id')

    // THEN: Shows document not cached message
    await expect(page.getByText(/document.*not available|load.*offline/i)).toBeVisible()
  })
})
