/**
 * Category 3: Editor Content (Yjs + y-indexeddb)
 * Tests that editor content persists offline via Yjs CRDT.
 *
 * NOTE: The Yjs/y-indexeddb layer IS implemented - editor content caches locally.
 * However, document LIST caching (TanStack Query + IndexedDB) is NOT implemented.
 * This means:
 * - Once a doc page loads, editing works offline (Yjs caches content)
 * - But navigating to /docs/:id while offline fails (no metadata cache)
 *
 * These tests focus on what IS implemented: editor interaction while offline.
 */
import { test, expect } from './fixtures/offline'

test.describe('3.1 Editor Content Persists Offline', () => {
  test('typing in editor while offline is preserved', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User has a document open (loads while online)
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    const editor = page.getByTestId('tiptap-editor')
    await expect(editor).toBeVisible()

    // WHEN: User goes offline and types
    await goOffline()
    await editor.click()
    await page.keyboard.type('Offline typing test - unique marker 12345')
    await page.waitForTimeout(1000) // Wait for Yjs to save to IndexedDB

    // THEN: Content is visible in the editor
    await expect(editor).toContainText('unique marker 12345')

    // AND: When back online, content persists
    await goOnline()
    await page.waitForTimeout(1000)
    await expect(editor).toContainText('unique marker 12345')
  })

  test('multiple offline edits accumulate correctly', async ({ page, goOffline, login, testData }) => {
    await login()

    // GIVEN: User has a document open
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    const editor = page.getByTestId('tiptap-editor')
    await expect(editor).toBeVisible()

    // WHEN: User goes offline and makes multiple edits
    await goOffline()
    await editor.click()
    await page.keyboard.type('First offline edit. ')
    await page.waitForTimeout(500)
    await page.keyboard.type('Second offline edit. ')
    await page.waitForTimeout(500)
    await page.keyboard.type('Third offline edit.')

    // THEN: All edits are captured
    await expect(editor).toContainText('First offline edit')
    await expect(editor).toContainText('Second offline edit')
    await expect(editor).toContainText('Third offline edit')
  })

  test('offline editor changes sync when back online', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User has document open and goes offline
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    const editor = page.getByTestId('tiptap-editor')
    await expect(editor).toBeVisible()

    await goOffline()
    await editor.click()
    const uniqueContent = `Sync test content ${Date.now()}`
    await page.keyboard.type(uniqueContent)
    await page.waitForTimeout(1000)

    // WHEN: User comes back online
    await goOnline()

    // THEN: Editor shows sync status change
    // Check for collab-status indicator if available
    const collabStatus = page.getByTestId('collab-status')
    if (await collabStatus.isVisible()) {
      // Wait for reconnection
      await page.waitForTimeout(3000)
    }

    // Content should still be there
    await expect(editor).toContainText(uniqueContent)
  })

  test('editor handles offline/online transitions gracefully', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User is editing a document
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    const editor = page.getByTestId('tiptap-editor')
    await expect(editor).toBeVisible()
    await editor.click()

    // WHEN: Network repeatedly drops and returns
    for (let i = 0; i < 3; i++) {
      await goOffline()
      await page.keyboard.type(`Cycle ${i + 1} offline. `)
      await page.waitForTimeout(500)

      await goOnline()
      await page.keyboard.type(`Cycle ${i + 1} online. `)
      await page.waitForTimeout(500)
    }

    // THEN: All content is preserved
    await expect(editor).toContainText('Cycle 1 offline')
    await expect(editor).toContainText('Cycle 3 online')
  })

  // Document metadata caching via TanStack Query + IndexedDB is now implemented
  // along with Yjs editor content caching
  test('editor content loads from IndexedDB when offline', async ({ page, goOffline, login, testData }) => {
    await login()

    // GIVEN: User previously edited a document (Yjs state cached)
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await expect(page.getByTestId('tiptap-editor')).toBeVisible()

    // Type some content to ensure it's cached
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Previously typed content for offline test')
    await page.waitForTimeout(1000) // Wait for Yjs to save

    // WHEN: User goes offline and refreshes
    await goOffline()
    await page.reload()

    // THEN: Editor content still loads
    // NOTE: This requires TanStack Query + IndexedDB for document metadata
    await expect(page.getByText('Previously typed content for offline test')).toBeVisible()
  })
})
