/**
 * Category 15: Chained Operations
 * Tests create-edit-delete chains offline.
 *
 * SKIP REASON: These tests require offline mutation queue with operation
 * collapsing which is NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue with IndexedDB persistence
 * 2. Operation collapsing (create + delete = no-op)
 * 3. Pending sync count UI (data-testid="pending-sync-count")
 * 4. Pending sync icon per item (data-testid="pending-sync-icon")
 * 5. Undo functionality for offline operations
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'


// TODO: Skip until offline mutation queue with operation collapsing is implemented (see file header)
test.describe.skip('15.1 Create-Edit-Delete Chains', () => {
  test('create then edit then delete same document offline', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User is offline
    await page.goto('/docs')
    await goOffline()

    // WHEN: User creates a document
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const docUrl = page.url()
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Chained Test')
    await page.goto('/docs')
    await expect(page.getByText('Chained Test')).toBeVisible()

    // AND: Edits it
    await page.getByText('Chained Test').click()
    await page.locator('[contenteditable="true"]').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' - Edited')
    await page.keyboard.press('Tab')

    // AND: Deletes it
    await page.goto('/docs')
    await page.getByText('Chained Test').hover()
    await page.getByRole('button', { name: /delete/i }).click()
    await page.getByRole('button', { name: /confirm/i }).click()

    // WHEN: User comes back online
    await goOnline()

    // THEN: Net result is no document (create+delete = nothing)
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 10000 })
    await expect(page.getByText('Chained Test')).not.toBeVisible()
  })

  test('create issue, change status - all offline', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User is on issues page offline
    await page.goto('/issues')
    await goOffline()

    // WHEN: User creates issue
    await page.getByRole('button', { name: /new issue/i }).click()
    await page.waitForURL(/\/issues\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Full Workflow Test')

    // AND: Changes status
    const statusSelect = page.getByLabel('Status')
    await statusSelect.selectOption('in_progress')

    // WHEN: User comes back online
    await goOnline()

    // THEN: Issue exists with correct status
    await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 15000 })
    await page.reload()
    await expect(page.getByLabel('Status')).toHaveValue('in_progress')
  })

  test('undo in chain removes intermediate operations', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User creates a document offline
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Undo Chain Test')
    await page.goto('/docs')
    await expect(page.getByText('Undo Chain Test')).toBeVisible()

    // WHEN: User deletes then immediately undoes
    await page.getByText('Undo Chain Test').hover()
    await page.getByRole('button', { name: /delete/i }).click()
    await page.getByRole('button', { name: /confirm/i }).click()

    // Click undo if available
    const undoButton = page.getByRole('button', { name: /undo/i })
    if (await undoButton.isVisible()) {
      await undoButton.click()

      // THEN: Document exists and pending queue is clean
      await expect(page.getByText('Undo Chain Test')).toBeVisible()
      // Only create mutation should be pending, not create+delete+restore
      await expect(page.getByTestId('pending-sync-count')).toHaveText('1')
    }
  })
})
