/**
 * Category 20: Reference Integrity
 * Tests handling of referenced entities deleted while user offline.
 *
 * SKIP REASON: These tests require offline mutation queue and pending sync
 * UI which are NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue with IndexedDB persistence
 * 2. Pending sync icon per item (data-testid="pending-sync-icon")
 * 3. Reference integrity error handling in sync
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'


test.describe.skip('20.1 Referenced Entity Deleted While Offline', () => {
  test('handles assignee deleted while user offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User is viewing an issue with assignee
    const issue = testData.issues.find(i => i.assignee_id)
    if (issue) {
      await page.goto(`/issues/${issue.id}`)
      await goOffline()

      // WHEN: User makes changes to the issue
      await page.getByTestId('tiptap-editor').click()
      await page.keyboard.type('Updated while offline')

      // Mock server response indicating assignee was deleted
      await page.route('**/api/documents/**', (route) => {
        if (route.request().method() === 'PATCH' || route.request().method() === 'PUT') {
          // Simulate server accepting update but returning null assignee
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ...issue,
              assignee_id: null,
              _warning: 'Assignee was deleted'
            })
          })
        } else {
          route.continue()
        }
      })

      // AND: Comes back online
      await goOnline()
      await page.waitForTimeout(3000)

      // THEN: Issue syncs, assignee cleared gracefully
      await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
    }
  })

  test('handles sprint deleted while user offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: Issue is in a sprint and user goes offline
    const issue = testData.issues.find(i => i.sprint_id)
    if (issue) {
      await page.goto(`/issues/${issue.id}`)
      await goOffline()

      // WHEN: User makes other changes offline
      await page.getByTestId('tiptap-editor').click()
      await page.keyboard.type(' (updated offline)')

      // Mock server response indicating sprint was deleted
      await page.route('**/api/documents/**', (route) => {
        if (route.request().method() === 'PATCH' || route.request().method() === 'PUT') {
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ...issue,
              sprint_id: null,
              _warning: 'Sprint was deleted'
            })
          })
        } else {
          route.continue()
        }
      })

      // AND: User comes back online
      await goOnline()
      await page.waitForTimeout(3000)

      // THEN: Issue syncs, shows notification about sprint removal
      await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
    }
  })

  test('handles project deleted while creating issue offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User is in a project's issues view
    const project = testData.projects[0]
    await page.goto(`/projects/${project.id}`)
    await goOffline()

    // WHEN: User creates an issue
    const newIssueButton = page.getByRole('button', { name: /new.*issue/i })
    if (await newIssueButton.isVisible()) {
      await newIssueButton.click()
      await page.waitForURL(/\/issues\/[^/]+$/)

      const titleInput = page.locator('[contenteditable="true"]').first()
      await titleInput.click()
      await page.keyboard.type('Orphaned Issue Test')

      // Mock server response indicating project was deleted
      await page.route('**/api/documents', (route) => {
        if (route.request().method() === 'POST') {
          route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'Project no longer exists'
            })
          })
        } else {
          route.continue()
        }
      })

      // WHEN: User comes back online
      await goOnline()
      await page.waitForTimeout(3000)

      // THEN: Shows error about project deletion
      await expect(page.getByText(/project.*deleted|no longer exists/i)).toBeVisible({ timeout: 10000 })
    }
  })

  test('handles parent document deleted while editing child', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: Document has a parent reference
    const doc = testData.wikis.find(d => d.parent_id) || testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await goOffline()

    // WHEN: User edits document
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Child document update')

    // Mock server accepting but clearing parent
    await page.route('**/api/documents/**', (route) => {
      if (route.request().method() === 'PATCH' || route.request().method() === 'PUT') {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...doc,
            parent_id: null,
            _warning: 'Parent document was deleted'
          })
        })
      } else {
        route.continue()
      }
    })

    // AND: Comes back online
    await goOnline()
    await page.waitForTimeout(3000)

    // THEN: Syncs successfully, gracefully handles orphaned state
    await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
  })
})
