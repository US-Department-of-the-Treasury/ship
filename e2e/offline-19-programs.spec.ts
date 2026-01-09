/**
 * Category 19.1: Program Operations Offline
 * Tests program creation and editing offline.
 *
 * SKIP REASON: These tests require offline mutation queue which is
 * NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue with IndexedDB persistence
 * 2. Pending sync icon per item (data-testid="pending-sync-icon")
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'


test.describe('19.1 Program Operations Offline', () => {
  test('create program offline', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User is on programs page
    await page.goto('/programs')
    await goOffline()

    // WHEN: User creates a new program
    await page.getByRole('button', { name: 'New Program', exact: true }).click()
    await page.waitForURL(/\/programs\/[^/]+$/)
    // Use title input, not contenteditable editor
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill('Offline Program')
    // Blur to trigger save and wait for throttled save
    await page.getByTestId('tiptap-editor').click()
    await page.waitForTimeout(1000)

    // Navigate back to list
    await page.goto('/programs')

    // THEN: Program appears in list with pending indicator
    await expect(page.getByText('Offline Program').first()).toBeVisible()
    await expect(page.getByTestId('pending-sync-icon').first()).toBeVisible()

    // WHEN: User comes back online
    await goOnline()

    // THEN: Program syncs successfully (allow time for multiple mutations)
    await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 20000 })
  })

  test('edit program title offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User opens existing program
    const program = testData.programs[0]
    await page.goto(`/programs/${program.id}`)
    await expect(page.getByTestId('tiptap-editor')).toBeVisible({ timeout: 10000 })

    await goOffline()

    // WHEN: User edits title (using input element, not contenteditable)
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill('Updated Program')
    // Blur to trigger save
    await page.getByTestId('tiptap-editor').click()

    // THEN: Shows pending indicator
    await expect(page.getByTestId('pending-sync-icon').first()).toBeVisible()

    // WHEN: Online
    await goOnline()

    // THEN: Syncs successfully
    await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
    await page.reload()
    await expect(titleInput).toHaveValue('Updated Program')
  })
})
