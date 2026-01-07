/**
 * Category 8: WebSocket Collaboration Offline
 * Tests WebSocket disconnect/reconnect behavior.
 *
 * IMPLEMENTATION STATUS: Complete
 * - sync-status indicator shows Saved/Cached/Saving/Offline
 * - collab-status shows connected users
 * - y-websocket handles automatic reconnection
 */
import { test, expect } from './fixtures/offline'


test.describe('8.1 WebSocket Disconnect/Reconnect', () => {
  test('WebSocket reconnects automatically when online', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User has document open with active WebSocket connection
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await expect(page.getByTestId('sync-status')).toContainText(/saved/i)

    // WHEN: Network drops
    await goOffline()

    // THEN: Sync status shows offline
    await expect(page.getByTestId('sync-status')).toContainText(/offline/i)

    // WHEN: Network returns
    await goOnline()

    // THEN: WebSocket reconnects and status shows saved
    await expect(page.getByTestId('sync-status')).toContainText(/saved/i, { timeout: 10000 })
  })

  test('local edits during WebSocket disconnect sync on reconnect', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User has document open
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await goOffline()

    // WHEN: User types while disconnected
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Typed while disconnected - unique marker 67890')

    // AND: Reconnects
    await goOnline()

    // THEN: Yjs syncs the local changes
    await expect(page.getByTestId('sync-status')).toContainText(/saved/i, { timeout: 10000 })

    // AND: Another tab can see the changes
    const newPage = await page.context().newPage()
    await newPage.goto(`/docs/${doc.id}`)
    await expect(newPage.getByText('unique marker 67890')).toBeVisible()
    await newPage.close()
  })
})
