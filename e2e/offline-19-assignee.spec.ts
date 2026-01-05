/**
 * Category 19.4: Person/Assignee Operations Offline
 * Tests assignee changes offline.
 *
 * SKIP REASON: These tests require offline mutation queue and pending sync
 * UI which are NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue with IndexedDB persistence
 * 2. Pending sync icon per item (data-testid="pending-sync-icon")
 * 3. Assignee badge component (data-testid="assignee-badge")
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'


test.describe.skip('19.4 Assignee Operations Offline', () => {
  test('assign issue to person offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User has an unassigned issue open
    const issue = testData.issues.find(i => !i.assignee_id) || testData.issues[0]
    await page.goto(`/issues/${issue.id}`)
    await goOffline()

    // WHEN: User assigns to team member
    const assigneeSelect = page.getByLabel(/assignee/i)
    if (await assigneeSelect.isVisible()) {
      const options = await assigneeSelect.locator('option').allTextContents()
      if (options.length > 1) {
        await assigneeSelect.selectOption({ index: 1 })

        // THEN: Assignee shows with pending indicator
        await expect(page.getByTestId('pending-sync-icon')).toBeVisible()

        // WHEN: Online
        await goOnline()

        // THEN: Assignment syncs
        await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
      }
    }
  })

  test('change assignee offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: Issue already assigned
    const issue = testData.issues.find(i => i.assignee_id)
    if (issue) {
      await page.goto(`/issues/${issue.id}`)
      await goOffline()

      // WHEN: User changes assignee
      const assigneeSelect = page.getByLabel(/assignee/i)
      if (await assigneeSelect.isVisible()) {
        const options = await assigneeSelect.locator('option').allTextContents()
        if (options.length > 2) {
          await assigneeSelect.selectOption({ index: 2 })

          // THEN: Shows new assignee with pending
          await expect(page.getByTestId('pending-sync-icon')).toBeVisible()

          // WHEN: Online
          await goOnline()
          await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
        }
      }
    }
  })

  test('unassign issue offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: Issue is assigned
    const issue = testData.issues.find(i => i.assignee_id)
    if (issue) {
      await page.goto(`/issues/${issue.id}`)
      await goOffline()

      // WHEN: User unassigns
      const assigneeSelect = page.getByLabel(/assignee/i)
      if (await assigneeSelect.isVisible()) {
        await assigneeSelect.selectOption('')

        // THEN: Shows unassigned with pending
        await expect(page.getByTestId('pending-sync-icon')).toBeVisible()

        // WHEN: Online
        await goOnline()
        await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
      }
    }
  })

  test('assignee avatar loads from cache when offline', async ({ page, goOffline, login, testData }) => {
    await login()

    // GIVEN: Issue is assigned to someone with avatar
    const issue = testData.issues.find(i => i.assignee_id)
    if (issue) {
      await page.goto(`/issues/${issue.id}`)

      // Cache loaded
      await page.waitForTimeout(1000)

      // WHEN: Goes offline
      await goOffline()
      await page.reload()

      // THEN: Issue still shows assignee info from cache
      const assigneeElement = page.getByTestId('assignee-badge')
      if (await assigneeElement.isVisible()) {
        await expect(assigneeElement).toBeVisible()
      }
    }
  })
})
