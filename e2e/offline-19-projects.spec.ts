/**
 * Category 19.3: Project Operations Offline
 * Tests project creation and issue assignment offline.
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


test.describe('19.3 Project Operations Offline', () => {
  test('create project offline', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User is on projects list
    await page.goto('/projects')
    await goOffline()

    // WHEN: User creates project (via new button or similar)
    const newButton = page.getByRole('button', { name: /new/i })
    if (await newButton.isVisible()) {
      await newButton.click()
      await page.waitForURL(/\/projects\/[^/]+$/)

      const titleInput = page.locator('[contenteditable="true"]').first()
      await titleInput.click()
      await page.keyboard.type('Offline Project')

      await page.goto('/projects')

      // THEN: Project appears with pending
      await expect(page.getByText('Offline Project')).toBeVisible()
      await expect(page.getByTestId('pending-sync-icon')).toBeVisible()

      // WHEN: Online
      await goOnline()

      // THEN: Syncs
      await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
    }
  })

  test('assign issue to project offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User has an issue without project assignment
    const issue = testData.issues.find(i => !i.project_id) || testData.issues[0]
    await page.goto(`/issues/${issue.id}`)
    await goOffline()

    // WHEN: User assigns to project
    const projectSelect = page.getByLabel(/project/i)
    if (await projectSelect.isVisible()) {
      const options = await projectSelect.locator('option').allTextContents()
      if (options.length > 1) {
        await projectSelect.selectOption({ index: 1 })

        // THEN: Assignment shows with pending
        await expect(page.getByTestId('pending-sync-icon')).toBeVisible()

        // WHEN: Online
        await goOnline()
        await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
      }
    }
  })

  test('edit project description offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User opens existing project
    const project = testData.projects[0]
    await page.goto(`/projects/${project.id}`)
    await goOffline()

    // WHEN: User edits content
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Offline project description update')

    // Wait for autosave
    await page.waitForTimeout(1000)

    // THEN: Shows pending indicator
    await expect(page.getByTestId('pending-sync-icon')).toBeVisible()

    // WHEN: Online
    await goOnline()

    // THEN: Syncs successfully
    await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
  })

  test('change issue project assignment offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: Issue is already assigned to a project
    const issue = testData.issues.find(i => i.project_id)
    if (issue) {
      await page.goto(`/issues/${issue.id}`)
      await goOffline()

      // WHEN: User changes project
      const projectSelect = page.getByLabel(/project/i)
      if (await projectSelect.isVisible()) {
        // Select a different project
        const options = await projectSelect.locator('option').allTextContents()
        if (options.length > 2) {
          await projectSelect.selectOption({ index: 2 })

          // THEN: Shows pending
          await expect(page.getByTestId('pending-sync-icon')).toBeVisible()

          // WHEN: Online
          await goOnline()
          await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
        }
      }
    }
  })
})
