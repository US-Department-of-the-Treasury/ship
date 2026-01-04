/**
 * Category 19.1: Program Operations Offline
 * Tests program creation and conflict handling offline.
 *
 * SKIP REASON: These tests require offline mutation queue which is
 * NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue with IndexedDB persistence
 * 2. Pending sync icon per item (data-testid="pending-sync-icon")
 * 3. Conflict resolution UI for duplicate prefixes
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'


test.describe('19.1 Program Operations Offline', () => {
  test('create program offline with unique prefix', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User is on programs page
    await page.goto('/programs')
    await goOffline()

    // WHEN: User creates a new program
    await page.getByRole('button', { name: /new/i }).click()
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

  test('program prefix conflict detected on sync', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: Programs with prefixes exist on server
    const existingProgram = testData.programs[0]

    await page.goto('/programs')
    await goOffline()

    // WHEN: User creates program offline
    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/programs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Conflict Program')

    // Set prefix that might conflict
    const prefixInput = page.getByLabel('Prefix')
    if (await prefixInput.isVisible()) {
      await prefixInput.fill(existingProgram.properties?.prefix || 'TEST')
    }

    await page.goto('/programs')

    // Mock conflict response
    await page.route('**/api/documents', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 400,
          body: JSON.stringify({ error: 'Prefix already taken' })
        })
      } else {
        route.continue()
      }
    })

    // AND: Comes back online
    await goOnline()

    // THEN: Shows conflict error
    await expect(page.getByText(/prefix.*taken|already exists/i)).toBeVisible({ timeout: 10000 })
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
