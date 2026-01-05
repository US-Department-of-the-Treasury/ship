/**
 * Category 17: User Controls
 * Tests manual sync controls and pending queue management.
 *
 * SKIP REASON: These tests require user-facing sync control UI which is
 * NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. "Sync Now" button for manual sync trigger
 * 2. Pending queue panel UI (data-testid="pending-queue-panel")
 * 3. Ability to discard pending mutations
 * 4. Queue item list with descriptions (data-testid="pending-queue-item")
 *
 * See: docs/application-architecture.md "Offline UI Components"
 */
import { test, expect } from './fixtures/offline'



test.describe.skip('17.1 Manual Sync Controls', () => {
  test('user can manually trigger sync', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User has pending changes
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Manual Sync Test')
    await page.goto('/docs')
    await goOnline()

    // WHEN: User clicks "Sync Now" button
    const syncButton = page.getByRole('button', { name: /sync now/i })
    if (await syncButton.isVisible()) {
      await syncButton.click()

      // THEN: Sync initiates immediately
      await expect(page.getByTestId('sync-status')).toContainText(/syncing/i)
      await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 10000 })
    }
  })

  test('user can discard pending change', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User has pending changes offline
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Discard Test')
    await page.goto('/docs')

    // WHEN: User chooses to discard pending change
    const pendingIcon = page.getByTestId('pending-sync-icon')
    if (await pendingIcon.isVisible()) {
      await pendingIcon.click() // Opens pending queue

      const discardButton = page.getByRole('button', { name: /discard|remove/i })
      if (await discardButton.isVisible()) {
        await discardButton.click()
        await page.getByRole('button', { name: /confirm/i }).click()

        // THEN: Change is removed from queue
        await expect(page.getByTestId('pending-sync-count')).toHaveText('0')
        await expect(page.getByText('Discard Test')).not.toBeVisible()
      }
    }
  })

  test('user can view pending changes queue', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User has multiple pending changes
    await page.goto('/docs')
    await goOffline()
    for (let i = 1; i <= 3; i++) {
      await page.getByRole('button', { name: 'New Document', exact: true }).click()
      await page.waitForURL(/\/docs\/[^/]+$/)
      const titleInput = page.locator('[contenteditable="true"]').first()
      await titleInput.click()
      await page.keyboard.type(`Queue Item ${i}`)
      await page.goto('/docs')
    }

    // WHEN: User clicks pending count
    await page.getByTestId('pending-sync-count').click()

    // THEN: Queue panel shows all pending mutations
    await expect(page.getByTestId('pending-queue-panel')).toBeVisible()
    await expect(page.getByTestId('pending-queue-item')).toHaveCount(3)
    // AND: Each item shows description
    await expect(page.getByTestId('pending-queue-item').first()).toContainText('Queue Item')
  })
})
