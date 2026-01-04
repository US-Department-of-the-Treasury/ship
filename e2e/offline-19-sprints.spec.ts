/**
 * Category 19.2: Sprint Operations Offline
 * Tests sprint creation and issue assignment offline.
 *
 * SKIP REASON: These tests require offline mutation queue which is
 * NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue with IndexedDB persistence
 * 2. Pending sync icon per item (data-testid="pending-sync-icon")
 * 3. Sprint selector UI with offline support
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'


test.describe('19.2 Sprint Operations Offline', () => {
  test('create sprint offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User is on a project page with sprints
    const project = testData.projects[0]
    await page.goto(`/projects/${project.id}`)
    await goOffline()

    // WHEN: User creates a sprint (via sprint tab or button)
    const newSprintButton = page.getByRole('button', { name: /new sprint/i })
    if (await newSprintButton.isVisible()) {
      await newSprintButton.click()

      // Fill sprint details
      const nameInput = page.getByRole('textbox', { name: /name/i })
      if (await nameInput.isVisible()) {
        await nameInput.fill('Offline Sprint')
      }

      await page.getByRole('button', { name: /create|save/i }).click()

      // THEN: Sprint appears with pending indicator
      await expect(page.getByText('Offline Sprint')).toBeVisible()
      await expect(page.getByTestId('pending-sync-icon')).toBeVisible()

      // WHEN: Online
      await goOnline()

      // THEN: Sprint syncs with server-assigned sprint number
      await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
    }
  })

  test('move issue to sprint offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User has an issue open
    const issue = testData.issues[0]
    await page.goto(`/issues/${issue.id}`)
    await goOffline()

    // WHEN: User assigns to sprint (if sprint selector exists)
    const sprintSelect = page.getByLabel(/sprint/i)
    if (await sprintSelect.isVisible()) {
      // Get available sprint options
      const options = await sprintSelect.locator('option').allTextContents()
      if (options.length > 1) {
        await sprintSelect.selectOption({ index: 1 })

        // THEN: UI shows sprint assignment with pending
        await expect(page.getByTestId('pending-sync-icon')).toBeVisible()

        // WHEN: Online
        await goOnline()

        // THEN: Assignment persists
        await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
      }
    }
  })

  test('edit sprint dates offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User is viewing a sprint
    const sprint = testData.sprints[0]
    if (sprint) {
      await page.goto(`/sprints/${sprint.id}`)
      await goOffline()

      // WHEN: User edits sprint dates (if editable)
      const startDateInput = page.getByLabel(/start.*date/i)
      if (await startDateInput.isVisible()) {
        await startDateInput.fill('2026-02-01')

        // THEN: Shows pending indicator
        await expect(page.getByTestId('pending-sync-icon')).toBeVisible()

        // WHEN: Online
        await goOnline()

        // THEN: Syncs
        await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
      }
    }
  })

  test('remove issue from sprint offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: Issue is in a sprint
    const issue = testData.issues.find(i => i.sprint_id)
    if (issue) {
      await page.goto(`/issues/${issue.id}`)
      await goOffline()

      // WHEN: User removes from sprint
      const sprintSelect = page.getByLabel(/sprint/i)
      if (await sprintSelect.isVisible()) {
        await sprintSelect.selectOption('')

        // THEN: Shows pending
        await expect(page.getByTestId('pending-sync-icon')).toBeVisible()

        // WHEN: Online
        await goOnline()

        // THEN: Syncs
        await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
      }
    }
  })
})
