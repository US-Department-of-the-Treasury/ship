/**
 * Category 5: Error Handling
 * Tests conflict resolution and network error handling.
 *
 * SKIP REASON: These tests require offline mutation queue and conflict
 * resolution UI which are NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue (Category 2, 4)
 * 2. Conflict detection when syncing stale data
 * 3. Conflict resolution UI with user choice options
 * 4. Retry logic with exponential backoff
 * 5. Error state UI for sync failures
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'



test.describe('5.1 Sync Conflicts', () => {
  test('shows conflict resolution UI when server rejects stale update', async ({ page, goOffline, goOnline, login, createDoc }) => {
    await login()

    // Create a test document
    const doc = await createDoc({
      title: 'Conflict Test Doc',
      document_type: 'wiki'
    })

    // GIVEN: User edits document offline
    await page.goto(`/docs/${doc.id}`)
    await goOffline()
    await page.locator('[contenteditable="true"]').first().click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('User A offline edit')

    // Mock conflict response when coming online
    await page.route('**/api/documents/**', (route) => {
      if (route.request().method() === 'PATCH') {
        route.fulfill({
          status: 409,
          body: JSON.stringify({ error: 'Version conflict' })
        })
      } else {
        route.continue()
      }
    })

    // WHEN: User comes back online and sync fails due to conflict
    await goOnline()

    // THEN: Conflict resolution UI appears
    await expect(page.getByText(/conflict|version/i)).toBeVisible({ timeout: 10000 })
  })

  test('handles document deleted while offline', async ({ page, goOffline, goOnline, login, createDoc, deleteDoc }) => {
    await login()

    // Create a test document
    const doc = await createDoc({
      title: 'Doc to be Deleted',
      document_type: 'wiki'
    })

    // GIVEN: User has document open offline
    await page.goto(`/docs/${doc.id}`)
    await goOffline()
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Edits to deleted doc')

    // AND: Document is deleted on server
    await deleteDoc(doc.id)

    // WHEN: User comes back online
    await goOnline()

    // THEN: User is notified document was deleted
    await expect(page.getByText(/deleted|no longer exists/i)).toBeVisible({ timeout: 10000 })
  })
})

test.describe('5.2 Network Flakiness', () => {
  test('retries failed mutations automatically', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User creates document offline
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Retry Test')
    await page.goto('/docs')

    // WHEN: Network is flaky (online but first request fails)
    let requestCount = 0
    await page.route('**/api/documents', (route) => {
      if (route.request().method() === 'POST') {
        requestCount++
        if (requestCount === 1) {
          route.abort('connectionfailed') // First attempt fails
        } else {
          route.continue()
        }
      } else {
        route.continue()
      }
    })
    await goOnline()

    // THEN: Mutation eventually succeeds via retry
    await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 15000 })
  })

  test('shows error after max retries exceeded', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User creates document offline
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Max Retry Test')
    await page.goto('/docs')

    // WHEN: Network always fails
    await page.route('**/api/documents', (route) => {
      if (route.request().method() === 'POST') {
        route.abort('connectionfailed')
      } else {
        route.continue()
      }
    })
    await goOnline()

    // THEN: Error state shown after retries exhausted
    await expect(page.getByText(/failed to sync|retry later/i)).toBeVisible({ timeout: 30000 })
    // AND: Mutation remains in queue for manual retry
    await expect(page.getByTestId('pending-sync-icon')).toBeVisible()
  })

  test('handles intermittent connectivity gracefully', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User is on docs page
    await page.goto('/docs')

    // WHEN: Network drops and recovers multiple times
    await goOffline()
    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    let titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Intermittent 1')
    await page.goto('/docs')

    await goOnline()
    await page.waitForTimeout(500)
    await goOffline()

    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Intermittent 2')
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
