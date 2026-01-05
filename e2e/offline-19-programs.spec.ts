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
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/programs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Offline Program')

    // Navigate back to list
    await page.goto('/programs')

    // THEN: Program appears in list with pending indicator
    await expect(page.getByText('Offline Program')).toBeVisible()
    await expect(page.getByTestId('pending-sync-icon')).toBeVisible()

    // WHEN: User comes back online
    await goOnline()

    // THEN: Program syncs successfully
    await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
  })

  test('edit program title offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User opens existing program
    const program = testData.programs[0]
    await page.goto(`/programs/${program.id}`)

    const originalTitle = await page.locator('[contenteditable="true"]').first().textContent()
    await goOffline()

    // WHEN: User edits title
    await page.locator('[contenteditable="true"]').first().click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('Updated Program')
    await page.keyboard.press('Tab')

    // THEN: Shows pending indicator
    await expect(page.getByTestId('pending-sync-icon')).toBeVisible()

    // WHEN: Online
    await goOnline()

    // THEN: Syncs successfully
    await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
    await page.reload()
    await expect(page.locator('[contenteditable="true"]').first()).toContainText('Updated Program')
  })
})
