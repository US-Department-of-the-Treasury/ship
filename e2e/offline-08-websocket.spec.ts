/**
 * Category 8: WebSocket Collaboration Offline
 * Tests WebSocket disconnect/reconnect behavior.
 *
 * SKIP REASON: These tests require collaboration status UI which is
 * NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Collaboration status indicator (data-testid="collab-status")
 * 2. WebSocket reconnection state display
 * 3. Sync status after reconnection
 *
 * Note: The underlying Yjs + y-websocket DO work, but the UI indicators
 * are not implemented yet.
 *
 * See: docs/application-architecture.md "Layer 1: Editor Content"
 */
import { test, expect } from './fixtures/offline'


// Skipping until collab-status UI is implemented (see file header)
test.describe.skip('8.1 WebSocket Disconnect/Reconnect', () => {
  test('WebSocket reconnects automatically when online', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User has document open with active WebSocket connection
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await expect(page.getByTestId('collab-status')).toContainText(/connected|online/i)

    // WHEN: Network drops
    await goOffline()

    // THEN: Collab status shows disconnected
    await expect(page.getByTestId('collab-status')).toContainText(/disconnected|offline/i)

    // WHEN: Network returns
    await goOnline()

    // THEN: WebSocket reconnects
    await expect(page.getByTestId('collab-status')).toContainText(/connected|synced/i, { timeout: 10000 })
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
    await expect(page.getByTestId('collab-status')).toContainText(/synced/i, { timeout: 10000 })

    // AND: Another tab can see the changes
    const newPage = await page.context().newPage()
    await newPage.goto(`/docs/${doc.id}`)
    await expect(newPage.getByText('unique marker 67890')).toBeVisible()
    await newPage.close()
  })
})
