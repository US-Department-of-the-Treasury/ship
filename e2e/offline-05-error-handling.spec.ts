/**
 * Category 5: Error Handling
 * Tests conflict resolution and network error handling.
 *
 * Infrastructure implemented:
 * - Conflict detection on 409 responses (markMutationConflict in queryClient.ts)
 * - Conflict resolution UI with dismiss/reload options (PendingSyncCount.tsx)
 * - Retry logic with exponential backoff (1s, 2s, 4s, 8s, 16s)
 * - Error state UI for sync failures (MAX_RETRY_COUNT = 5)
 * - Mutation sync status tracking (pending, syncing, synced, conflict)
 */
import { test, expect } from './fixtures/offline'



test.describe('5.1 Sync Conflicts', () => {
  test('shows conflict resolution UI when server rejects stale update', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // Capture console logs for debugging
    page.on('console', msg => {
      if (msg.text().includes('processPendingMutations') || msg.text().includes('[QueryClient]') || msg.text().includes('[PendingSyncCount]') || msg.type() === 'error') {
        console.log('[BROWSER]', msg.type(), msg.text())
      }
    })

    // Use existing test document (already in cache)
    const doc = testData.wikis[0]

    // GIVEN: User edits document title offline (title uses REST API, not WebSocket)
    await page.goto(`/docs/${doc.id}`)
    await expect(page.getByTestId('tiptap-editor')).toBeVisible({ timeout: 10000 })

    // Mock conflict response BEFORE going offline so it catches syncs
    await page.route('**/api/documents/**', (route) => {
      if (route.request().method() === 'PATCH') {
        console.log('[TEST] Intercepting PATCH - returning 409')
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Version conflict' })
        })
      } else {
        route.continue()
      }
    })

    await goOffline()

    // Edit document title (input element with placeholder="Untitled", not contenteditable TipTap content)
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await expect(titleInput).toBeVisible({ timeout: 5000 })
    await titleInput.click()
    await titleInput.fill('User A offline title edit')
    // Trigger blur to save the title change
    await page.getByTestId('tiptap-editor').click()

    // Wait for pending mutation to be queued
    await page.waitForTimeout(1000)

    // Verify mutation was queued
    const pendingCount = await page.locator('[data-testid="pending-sync-count"]').textContent()
    console.log('[TEST] Pending sync count before goOnline:', pendingCount)

    // WHEN: User comes back online and sync fails due to conflict
    await goOnline()

    // Wait for sync to attempt and fail
    await page.waitForTimeout(3000)

    // THEN: Conflict resolution UI appears (text in PendingSyncCount component)
    await expect(page.getByTestId('conflict-message')).toBeVisible({ timeout: 10000 })
  })

  test('handles document deleted while offline', async ({ page, goOffline, goOnline, login, testData, deleteDoc }) => {
    await login()

    // Use existing test document (already in cache)
    const doc = testData.wikis[1]

    // GIVEN: User has document open offline
    await page.goto(`/docs/${doc.id}`)
    await expect(page.getByTestId('tiptap-editor')).toBeVisible({ timeout: 10000 })
    await goOffline()
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Edits to deleted doc')

    // AND: Document is deleted on server (via API while user is offline)
    await deleteDoc(doc.id)

    // WHEN: User comes back online
    await goOnline()

    // THEN: User is notified document was deleted
    await expect(page.getByText(/deleted|no longer exists/i)).toBeVisible({ timeout: 10000 })
  })
})

test.describe('5.2 Network Flakiness', () => {
  test('shows error after max retries exceeded', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User creates document offline
    await page.goto('/docs')

    // Set up route interception BEFORE going offline to ensure it catches all sync attempts
    // Must intercept both /api/documents (POST create) and /api/documents/* (PATCH update)
    await page.route('**/api/documents/**', (route) => {
      const method = route.request().method()
      if (method === 'POST' || method === 'PATCH') {
        console.log('[TEST] Intercepting', method, 'to', route.request().url(), '- aborting')
        route.abort('connectionfailed')
      } else {
        route.continue()
      }
    })
    await page.route('**/api/documents', (route) => {
      const method = route.request().method()
      if (method === 'POST' || method === 'PATCH') {
        console.log('[TEST] Intercepting', method, 'to', route.request().url(), '- aborting')
        route.abort('connectionfailed')
      } else {
        route.continue()
      }
    })

    await goOffline()
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    // Use title input, not contenteditable editor
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill('Max Retry Test')
    await page.waitForTimeout(1000) // Wait for throttled save
    await page.goto('/docs')

    // WHEN: Go online - sync attempts will fail due to route interception
    await goOnline()

    // THEN: Error state shown after retries exhausted
    // AND: Mutation remains in queue for manual retry (visible via retry button)
    // AND: "Failed to sync" error message is visible after retries exhausted
    // Note: With exponential backoff (1s, 2s, 4s, 8s, 16s), all 5 retries take ~31s
    await expect(page.getByTestId('sync-error-message')).toBeVisible({ timeout: 45000 })
  })

  test('handles intermittent connectivity gracefully', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User is on docs page
    await page.goto('/docs')

    // WHEN: Network drops and recovers multiple times
    await goOffline()
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    // Use title input, not contenteditable editor
    let titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill('Intermittent 1')
    await page.waitForTimeout(1000) // Wait for throttled save
    await page.goto('/docs')

    await goOnline()
    await page.waitForTimeout(500)
    await goOffline()

    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    // Re-select title input for new document
    titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill('Intermittent 2')
    await page.waitForTimeout(1000) // Wait for throttled save
    await page.goto('/docs')

    await goOnline()

    // THEN: All mutations eventually sync
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 15000 })
    // AND: Both documents exist on server
    const response = await page.request.get('/api/documents?type=wiki')
    const docs = await response.json()
    expect(docs.some((d: { title: string }) => d.title === 'Intermittent 1')).toBe(true)
    expect(docs.some((d: { title: string }) => d.title === 'Intermittent 2')).toBe(true)
  })
})
