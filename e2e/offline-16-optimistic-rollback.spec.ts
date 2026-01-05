/**
 * Category 16: Optimistic UI Rollback
 * Tests UI reversion when sync fails.
 *
 * SKIP REASON: These tests require offline mutation queue with rollback
 * handling which is NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue with IndexedDB persistence
 * 2. Optimistic UI updates with rollback capability
 * 3. Error notification UI for sync failures
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'


test.describe.skip('16.1 Rollback on Sync Failure', () => {
  test('UI reverts to previous state when sync fails', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User updates document title offline
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    const originalTitle = await page.locator('[contenteditable="true"]').first().textContent()

    await goOffline()
    await page.locator('[contenteditable="true"]').first().click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('Optimistic Update')
    await page.keyboard.press('Tab')

    // UI shows optimistic update
    await expect(page.locator('[contenteditable="true"]').first()).toContainText('Optimistic Update')

    // WHEN: Sync fails permanently
    await page.route('**/api/documents/**', (route) => {
      if (route.request().method() === 'PATCH') {
        route.fulfill({ status: 400, body: JSON.stringify({ error: 'Validation failed' }) })
      } else {
        route.continue()
      }
    })
    await goOnline()
    await page.waitForTimeout(5000) // Wait for retries to exhaust

    // THEN: UI reverts to original state
    await expect(page.locator('[contenteditable="true"]').first()).toContainText(originalTitle || '')
    // AND: Error notification shown
    await expect(page.getByText(/failed.*update|reverted/i)).toBeVisible()
  })

  test('optimistic delete reverts when sync fails', async ({ page, goOffline, goOnline, login, createDoc }) => {
    await login()

    // Create a test document
    const doc = await createDoc({
      title: 'Doc to Fail Delete',
      document_type: 'wiki'
    })

    // GIVEN: User deletes document offline
    await page.goto('/docs')
    await expect(page.getByText('Doc to Fail Delete')).toBeVisible()
    await goOffline()
    await page.getByText('Doc to Fail Delete').hover()
    await page.getByRole('button', { name: /delete/i }).click()
    await page.getByRole('button', { name: /confirm/i }).click()

    // UI shows doc removed
    await expect(page.getByText('Doc to Fail Delete')).not.toBeVisible()

    // WHEN: Sync fails
    await page.route('**/api/documents/**', (route) => {
      if (route.request().method() === 'DELETE') {
        route.fulfill({ status: 500 })
      } else {
        route.continue()
      }
    })
    await goOnline()
    await page.waitForTimeout(5000)

    // THEN: Deleted doc reappears
    await expect(page.getByText('Doc to Fail Delete')).toBeVisible()
  })
})
