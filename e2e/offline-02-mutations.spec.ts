/**
 * Category 2: Offline Mutations (Create/Update/Delete Queue)
 * Tests that mutations are queued offline and sync when back online.
 *
 * SKIP REASON: These tests require an offline mutation queue which is
 * NOT YET IMPLEMENTED. The app currently has no mutation queue - all
 * mutations go directly to the server API.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Implement IndexedDB-backed mutation queue
 * 2. Queue mutations when offline (detect via navigator.onLine)
 * 3. Process queue in FIFO order when online
 * 4. Add pending indicator UI (data-testid="pending-sync-icon")
 * 5. Generate temporary IDs for offline-created documents
 * 6. Replace temporary IDs with server IDs after sync
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'

test.describe.skip('2.1 Create Document Queues When Offline', () => {
  test('creating a wiki document offline adds it to queue and shows pending state', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User is on docs page and goes offline
    await page.goto('/docs')
    await expect(page.locator('h2', { hasText: /docs/i })).toBeVisible()
    await goOffline()

    // WHEN: User creates a new document (use the sidebar button which has exact match)
    await page.getByRole('button', { name: 'New document', exact: true }).click()
    // Fill in title in the editor that opens (title is an input, not contenteditable)
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.fill('Offline Test Doc')
    // Wait for auto-save throttle and blur to trigger save
    await page.keyboard.press('Tab')
    await page.waitForTimeout(600) // Auto-save throttle is 500ms

    // Navigate back to list
    await page.goto('/docs')

    // THEN: Document appears in sidebar with pending indicator
    const docItem = page.getByTestId('doc-item').filter({ hasText: 'Offline Test Doc' })
    await expect(docItem).toBeVisible()
    await expect(docItem.getByTestId('pending-sync-icon')).toBeVisible()
  })

  // SKIP: This test requires proper ID remapping when offline-created docs sync.
  // The current implementation has a race condition where update mutations
  // queued with temp IDs fail when the create mutation completes with a real ID.
  // Infrastructure needed: Mutation queue with ID remapping after create success.
  test.skip('offline-created document syncs when back online', async ({ page, goOffline, goOnline, login }) => {
    await login()
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: 'New document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    // ... test would verify sync completes when back online
    await goOnline()
  })

  test('creating issue offline generates temporary ticket number', async ({ page, goOffline, login, testData }) => {
    await login()

    // GIVEN: User is on issues page and goes offline
    await page.goto('/issues')
    await expect(page.locator('h2', { hasText: /issues/i })).toBeVisible()
    await goOffline()

    // WHEN: User creates a new issue (use the sidebar button which is aria-labeled)
    await page.getByRole('button', { name: 'New issue', exact: true }).click()
    await page.waitForURL(/\/issues\/[^/]+$/, { timeout: 10000 })
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.fill('Offline Bug Report')
    // Wait for auto-save throttle and blur to trigger save
    await page.keyboard.press('Tab')
    await page.waitForTimeout(600)

    // Navigate back to list
    await page.goto('/issues')

    // THEN: Issue appears in the issues list (sidebar)
    const issueItem = page.getByTestId('issue-item').filter({ hasText: 'Offline Bug Report' })
    await expect(issueItem).toBeVisible()
    // Pending indicator should be visible for offline-created issues
    await expect(issueItem.getByTestId('pending-sync-icon')).toBeVisible()
  })
})

test.describe.skip('2.2 Update Document Queues When Offline', () => {
  test('updating document title offline shows pending state', async ({ page, goOffline, login, testData }) => {
    await login()

    // GIVEN: User has a document open
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await expect(page.getByTestId('tiptap-editor')).toBeVisible()

    // WHEN: User goes offline and updates the title
    await goOffline()
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.fill('Updated While Offline')
    await page.keyboard.press('Tab') // Blur to trigger save

    // THEN: Title updates locally with pending indicator
    await expect(page.getByTestId('pending-sync-icon')).toBeVisible()
  })

  test('offline title update syncs correctly when online', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User updated title offline
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await expect(page.getByTestId('tiptap-editor')).toBeVisible()
    await goOffline()
    const titleInput = page.locator('input[name="title"], input[placeholder="Untitled"]').first()
    await titleInput.fill('Synced Title')
    await page.keyboard.press('Tab')

    // WHEN: User comes back online
    await goOnline()

    // THEN: Pending indicator clears
    await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
    // AND: Refreshing shows the synced title (confirming server has it)
    await page.reload()
    await expect(page.locator('input[placeholder="Untitled"]')).toHaveValue('Synced Title')
  })

  test('updating issue status offline shows pending state', async ({ page, goOffline, login, testData }) => {
    await login()

    // GIVEN: User has an issue open
    const issue = testData.issues[0]
    await page.goto(`/issues/${issue.id}`)
    await expect(page.getByTestId('tiptap-editor')).toBeVisible()

    // WHEN: User goes offline and changes status
    await goOffline()
    const statusSelect = page.getByLabel('Status')
    await statusSelect.selectOption('in_progress')

    // THEN: Status updates locally with pending indicator
    await expect(page.getByTestId('pending-sync-icon')).toBeVisible()
  })
})

test.describe.skip('2.3 Delete Document Queues When Offline', () => {
  // SKIP: These tests require a delete button in the document tree UI, which is NOT YET IMPLEMENTED
  // The DocumentTreeItem component only has an "Add sub-document" button, no delete functionality
  // Infrastructure needed:
  // 1. Add delete button to DocumentTreeItem (visible on hover)
  // 2. Add confirmation dialog
  // 3. Implement optimistic delete with undo option

  test.skip('deleting document offline removes from list with undo option', async ({ page, goOffline, login, createDoc }) => {
    // This test is skipped because delete UI is not implemented
    await login()
    const doc = await createDoc({ title: 'Doc to Delete', document_type: 'wiki' })
    await page.goto(`/docs/${doc.id}`)
    await expect(page.getByTestId('tiptap-editor')).toBeVisible()
    // Delete functionality would be tested here
  })

  test.skip('offline deletion syncs when back online', async ({ page, goOffline, goOnline, login, createDoc }) => {
    // This test is skipped because delete UI is not implemented
    await login()
    const doc = await createDoc({ title: 'Doc for Sync Delete', document_type: 'wiki' })
    await page.goto(`/docs/${doc.id}`)
    // Delete functionality would be tested here
  })
})
