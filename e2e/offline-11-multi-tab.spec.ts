/**
 * Category 11: Multi-Tab Offline Behavior
 * Tests multiple tabs working offline.
 *
 * SKIP REASON: These tests require offline mutation queue and shared
 * IndexedDB state which are NOT YET IMPLEMENTED.
 *
 * NOTE: The Yjs editor DOES sync across tabs (test 2 should pass), but
 * the list-level mutations (tests 1, 3) require the mutation queue.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue with IndexedDB (shared across tabs)
 * 2. Pending sync count UI (data-testid="pending-sync-count")
 * 3. BroadcastChannel or SharedWorker for tab coordination
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'



// Skipping until mutation queue is implemented (see file header)
test.describe.skip('11.1 Multiple Tabs Offline', () => {
  test('changes in one offline tab appear in another offline tab', async ({ context, login }) => {
    // Login in first page
    const page1 = await context.newPage()
    await page1.goto('/login')
    await page1.fill('input[name="email"]', 'dev@ship.local')
    await page1.fill('input[name="password"]', 'admin123')
    await page1.click('button[type="submit"]')
    await page1.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    // GIVEN: Two tabs open on same page
    await page1.goto('/docs')
    const page2 = await context.newPage()
    await page2.goto('/docs')

    // WHEN: Both tabs go offline and tab 1 creates a document
    await context.setOffline(true)
    await page1.getByRole('button', { name: 'New Document', exact: true }).click()
    await page1.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page1.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page1.keyboard.type('Multi-Tab Test')
    await page1.goto('/docs')

    // THEN: Tab 2 sees the new document (shared IndexedDB)
    await page2.reload()
    await expect(page2.getByText('Multi-Tab Test')).toBeVisible()
  })

  test('conflicting offline edits in two tabs merge correctly', async ({ context, login }) => {
    // Login
    const page1 = await context.newPage()
    await page1.goto('/login')
    await page1.fill('input[name="email"]', 'dev@ship.local')
    await page1.fill('input[name="password"]', 'admin123')
    await page1.click('button[type="submit"]')
    await page1.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    // GIVEN: Two tabs editing same document offline
    await page1.goto('/docs')
    // Create a document first
    await page1.getByRole('button', { name: 'New Document', exact: true }).click()
    await page1.waitForURL(/\/docs\/[^/]+$/)
    const docUrl = page1.url()

    const page2 = await context.newPage()
    await page2.goto(docUrl)
    await context.setOffline(true)

    // WHEN: Both tabs make edits
    await page1.getByTestId('tiptap-editor').click()
    await page1.keyboard.type('Tab 1 edit')
    await page2.getByTestId('tiptap-editor').click()
    await page2.keyboard.type('Tab 2 edit')

    // AND: Come back online
    await context.setOffline(false)

    // THEN: Both edits are preserved via Yjs CRDT
    await page1.waitForTimeout(2000)
    const content = await page1.getByTestId('tiptap-editor').textContent()
    expect(content).toContain('Tab 1 edit')
    expect(content).toContain('Tab 2 edit')
  })

  test('pending sync count is consistent across tabs', async ({ context }) => {
    // Login in first page
    const page1 = await context.newPage()
    await page1.goto('/login')
    await page1.fill('input[name="email"]', 'dev@ship.local')
    await page1.fill('input[name="password"]', 'admin123')
    await page1.click('button[type="submit"]')
    await page1.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    // GIVEN: Two tabs open
    await page1.goto('/docs')
    const page2 = await context.newPage()
    await page2.goto('/docs')
    await context.setOffline(true)

    // WHEN: Tab 1 creates a document
    await page1.getByRole('button', { name: 'New Document', exact: true }).click()
    await page1.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page1.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page1.keyboard.type('Sync Count Test')
    await page1.goto('/docs')

    // THEN: Both tabs show same pending count
    await expect(page1.getByTestId('pending-sync-count')).toHaveText('1')
    await page2.reload()
    await expect(page2.getByTestId('pending-sync-count')).toHaveText('1')
  })
})
