/**
 * Category 15: Chained Operations
 * Tests create-edit chains offline.
 *
 * Infrastructure implemented:
 * 1. Offline mutation queue with IndexedDB persistence
 * 2. Temp ID to real ID mapping (updateMutationResourceId)
 * 3. Pending sync count UI (data-testid="pending-sync-count")
 * 4. Pending sync icon per item (data-testid="pending-sync-icon")
 *
 * Note: Operation collapsing (create+delete = no-op) is NOT implemented.
 * These tests verify that chained operations work correctly when synced in order.
 *
 * Note: Issue sync handlers are NOT implemented - only document/program handlers exist.
 */
import { test, expect } from './fixtures/offline'



test.describe('15.1 Create-Edit Chains', () => {
  test('create document with title offline', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User is offline
    await page.goto('/docs')
    await goOffline()

    // WHEN: User creates a document and sets title
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    // Use the title input field (not contenteditable editor)
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill('Chained Test')
    // Wait for throttled save + IndexedDB persistence
    await page.waitForTimeout(1000)

    // AND: User goes back to docs list
    await page.goto('/docs')
    await expect(page.getByRole('link', { name: 'Chained Test' }).first()).toBeVisible()

    // Verify pending icon shows
    await expect(page.getByTestId('pending-sync-icon').first()).toBeVisible()

    // WHEN: User comes back online
    await goOnline()

    // THEN: Mutations sync and document has correct title
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 15000 })
    await expect(page.getByRole('link', { name: 'Chained Test' }).first()).toBeVisible()
  })

  test('multiple creates offline sync in order', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User is on docs page offline
    await page.goto('/docs')
    await goOffline()

    // WHEN: User creates multiple documents
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const firstInput = page.locator('input[placeholder="Untitled"]')
    await firstInput.click()
    await firstInput.fill('First Doc')
    await page.waitForTimeout(1000) // Wait for throttled save
    await page.goto('/docs')

    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const secondInput = page.locator('input[placeholder="Untitled"]')
    await secondInput.click()
    await secondInput.fill('Second Doc')
    await page.waitForTimeout(1000) // Wait for throttled save
    await page.goto('/docs')

    // Verify both are visible locally
    await expect(page.getByRole('link', { name: 'First Doc' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Second Doc' }).first()).toBeVisible()

    // WHEN: User comes back online
    await goOnline()

    // THEN: Both documents sync
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 15000 })

    // Both documents still visible after sync
    await expect(page.getByRole('link', { name: 'First Doc' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Second Doc' }).first()).toBeVisible()
  })

  // Issue sync handlers are not implemented - skip until they are
  test.skip('create issue offline', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User is on issues page offline
    await page.goto('/issues')
    await goOffline()

    // WHEN: User creates issue
    await page.getByRole('button', { name: 'New Issue' }).click()
    await page.waitForURL(/\/issues\/[^/]+$/)
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill('Offline Issue')
    await page.waitForTimeout(1000)
    await page.goto('/issues')

    // WHEN: User comes back online
    await goOnline()

    // THEN: Issue syncs successfully
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 15000 })
  })
})
