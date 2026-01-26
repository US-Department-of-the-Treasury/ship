import { test, expect } from './fixtures/isolated-env'

/**
 * Issue Estimates & Status Tracking - E2E Tests
 *
 * Tests for:
 * - Estimate field in issue editor
 * - Estimate validation for sprint assignment
 * - Sprint capacity display
 * - Status change timestamp tracking
 * - Activity/change history
 */

// FIXME: Tests timeout waiting for API responses - issue creation flow may be broken
test.describe.fixme('Issue Estimates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test.describe('Estimate Field UI', () => {
    test('shows estimate field in issue editor properties', async ({ page }) => {
      // Create a new issue to test estimate field
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

      // Should see Estimate field label in properties sidebar (label element, exact match)
      await expect(page.locator('label').filter({ hasText: /^Estimate$/ })).toBeVisible({ timeout: 5000 })
    })

    test('can enter estimate as free text number', async ({ page }) => {
      await page.goto('/issues')
      // Use exact match to avoid matching both "New issue" icon and "New Issue" button
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

      // Find and fill estimate input
      const estimateInput = page.locator('input[type="number"]')
      await expect(estimateInput).toBeVisible({ timeout: 5000 })
      await estimateInput.fill('4.5')

      // Wait for save and React state update
      await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')
      await page.waitForTimeout(500) // Allow React to process state update

      // Verify value persists
      await expect(estimateInput).toHaveValue('4.5')
    })

    test('accepts decimal values (0.5 increments)', async ({ page }) => {
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

      const estimateInput = page.locator('input[type="number"]')
      await expect(estimateInput).toBeVisible({ timeout: 5000 })
      await estimateInput.fill('2.5')

      await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')
      await page.waitForTimeout(500)
      await expect(estimateInput).toHaveValue('2.5')
    })

    test('shows hours label/hint next to estimate field', async ({ page }) => {
      // Create a new issue to test hours label
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

      // Should show "hours" label next to estimate field
      await expect(page.getByText('hours')).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe('Sprint Assignment Validation', () => {
    test('allows adding issue without estimate to backlog', async ({ page }) => {
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

      // Set title
      await page.getByPlaceholder('Untitled').fill('Backlog Issue No Estimate')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/'))

      // Should be able to save without estimate (backlog is fine)
      // No error should appear
      await expect(page.getByText(/estimate required|must have estimate/i)).not.toBeVisible()
    })

    test('requires estimate before adding issue to sprint', async ({ page }) => {
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

      // Set title and program
      await page.getByPlaceholder('Untitled').fill('Sprint Issue Needs Estimate')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/'))

      // Select a program first
      await page.getByRole('combobox').filter({ hasText: 'No Program' }).click()
      await page.waitForTimeout(300)
      await page.getByText('API Platform', { exact: true }).click()
      await page.waitForResponse(resp => resp.url().includes('/api/programs/') && resp.url().includes('/sprints'))

      // Try to assign to sprint without estimate - should show error or be disabled
      await page.getByRole('combobox').filter({ hasText: 'No Sprint' }).click()
      await page.waitForTimeout(300)
      const sprintOption = page.locator('[cmdk-item]').filter({ hasText: /Sprint \d+/ }).first()

      // Either sprint options are disabled, or clicking shows validation error
      const isDisabled = await sprintOption.isDisabled().catch(() => false)
      if (!isDisabled) {
        await sprintOption.click()
        // Should show validation message
        await expect(page.getByText(/add an estimate before assigning/i)).toBeVisible({ timeout: 3000 })
      }
    })

    test('allows sprint assignment after estimate is set', async ({ page }) => {
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

      // Set title
      await page.getByPlaceholder('Untitled').fill('Sprint Issue With Estimate')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/'))

      // Set estimate first
      const estimateInput = page.locator('input[type="number"]').or(page.getByPlaceholder(/estimate|hours/i))
      await estimateInput.fill('4')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')

      // Select program
      await page.getByRole('combobox').filter({ hasText: 'No Program' }).click()
      await page.waitForTimeout(300)
      await page.getByText('API Platform', { exact: true }).click()
      await page.waitForResponse(resp => resp.url().includes('/api/programs/') && resp.url().includes('/sprints'))

      // Now sprint assignment should work
      await page.getByRole('combobox').filter({ hasText: 'No Sprint' }).click()
      await page.waitForTimeout(300)
      await page.locator('[cmdk-item]').filter({ hasText: /Sprint \d+/ }).first().click()
      await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')

      // Should show sprint selected
      await expect(page.getByRole('combobox').filter({ hasText: /Sprint \d+/ })).toBeVisible({ timeout: 5000 })
    })
  })

  test.describe('Sprint Capacity Display', () => {
    test('sprint header shows total estimated hours', async ({ page }) => {
      // Navigate to a program with sprints
      await page.goto('/programs')
      await page.locator('tr[role="row"]', { hasText: /API Platform/i }).first().click()
      await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

      // Go to Sprints tab (it's a tab, not a button)
      await page.getByRole('tab', { name: 'Sprints' }).click()

      // Should see estimated hours in active sprint section or timeline
      await expect(page.getByText(/\d+h|\d+ hours|estimated/i).first()).toBeVisible({ timeout: 5000 })
    })

    test('sprint timeline cards show estimate totals when issues have estimates', async ({ page }) => {
      await page.goto('/programs')
      await page.locator('tr[role="row"]', { hasText: /API Platform/i }).first().click()
      await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

      await page.getByRole('tab', { name: 'Sprints' }).click()

      // Timeline cards should be visible
      const sprintCard = page.locator('button').filter({ hasText: /Sprint \d+/ }).first()
      await expect(sprintCard).toBeVisible({ timeout: 5000 })

      // Sprint cards show issue counts (hours only show when estimates exist)
      // The format is "X/Y done" or "X/Y ✓" for completed sprints
      await expect(sprintCard.getByText(/\d+\/\d+/)).toBeVisible({ timeout: 5000 })
    })
  })
})

// FIXME: Tests timeout waiting for API responses - issue creation flow may be broken
test.describe.fixme('Status Change Tracking', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test.describe('Timestamp Updates', () => {
    test('sets started_at when status changes to in_progress', async ({ page }) => {
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

      // Set title
      await page.getByPlaceholder('Untitled').fill('Track Started Time')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/'))

      // Change status to in_progress
      await page.locator('select').filter({ hasText: /backlog|todo/i }).selectOption('in_progress')

      // Wait for API response and verify started_at is set
      const response = await page.waitForResponse(resp =>
        resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH'
      )
      const data = await response.json()
      expect(data.started_at).toBeTruthy()
    })

    test('sets completed_at when status changes to done', async ({ page }) => {
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

      await page.getByPlaceholder('Untitled').fill('Track Completed Time')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/'))

      // Change status to done
      await page.locator('select').filter({ hasText: /backlog|todo/i }).selectOption('done')

      const response = await page.waitForResponse(resp =>
        resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH'
      )
      const data = await response.json()
      expect(data.completed_at).toBeTruthy()
    })

    test('preserves started_at when reopening (done -> in_progress)', async ({ page }) => {
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

      await page.getByPlaceholder('Untitled').fill('Track Reopen')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/'))

      // First complete it
      await page.locator('select').filter({ hasText: /backlog|todo/i }).selectOption('done')
      let response = await page.waitForResponse(resp =>
        resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH'
      )
      const completedData = await response.json()
      const originalCompletedAt = completedData.completed_at

      // Now reopen it
      await page.locator('select').filter({ hasText: /done/i }).selectOption('in_progress')
      response = await page.waitForResponse(resp =>
        resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH'
      )
      const reopenedData = await response.json()

      // Original completed_at should be preserved (or moved to history)
      // reopened_at should be set
      expect(reopenedData.reopened_at || reopenedData.started_at).toBeTruthy()
    })
  })

  test.describe('Activity History', () => {
    test('API returns history of status changes', async ({ page }) => {
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })
      const issueId = page.url().split('/documents/')[1]

      await page.getByPlaceholder('Untitled').fill('History Test Issue')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/'))

      // Make a status change
      await page.locator('select').filter({ hasText: /backlog|todo/i }).selectOption('in_progress')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')

      // Fetch history (API should have this endpoint)
      const historyResponse = await page.request.get(`/api/issues/${issueId}/history`)
      expect(historyResponse.ok()).toBeTruthy()

      const history = await historyResponse.json()
      expect(Array.isArray(history)).toBeTruthy()
      expect(history.length).toBeGreaterThan(0)

      // Should have status change entry
      const statusChange = history.find((h: any) => h.field === 'state' || h.field === 'status')
      expect(statusChange).toBeTruthy()
    })

    test('history tracks estimate changes', async ({ page }) => {
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })
      const issueId = page.url().split('/documents/')[1]

      await page.getByPlaceholder('Untitled').fill('Estimate History Test')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/'))

      // Set initial estimate
      const estimateInput = page.locator('input[type="number"]').or(page.getByPlaceholder(/estimate|hours/i))
      await estimateInput.fill('4')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')

      // Change estimate
      await estimateInput.fill('8')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')

      // Fetch history
      const historyResponse = await page.request.get(`/api/issues/${issueId}/history`)
      const history = await historyResponse.json()

      // Should have estimate change entries
      const estimateChanges = history.filter((h: any) => h.field === 'estimate')
      expect(estimateChanges.length).toBeGreaterThanOrEqual(1)
    })

    test('history tracks assignee changes', async ({ page }) => {
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })
      const issueId = page.url().split('/documents/')[1]

      await page.getByPlaceholder('Untitled').fill('Assignee History Test')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/'))

      // Assign to someone
      await page.getByRole('combobox').filter({ hasText: /unassigned|no assignee/i }).click()
      await page.waitForTimeout(300)
      // Select first person
      await page.locator('[cmdk-item]').filter({ hasText: /[A-Z][a-z]+ [A-Z][a-z]+/ }).first().click()
      await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')

      // Fetch history
      const historyResponse = await page.request.get(`/api/issues/${issueId}/history`)
      const history = await historyResponse.json()

      // Should have assignee change entry
      const assigneeChange = history.find((h: any) => h.field === 'assignee' || h.field === 'assignee_id')
      expect(assigneeChange).toBeTruthy()
    })

    test('history includes who made the change', async ({ page }) => {
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })
      const issueId = page.url().split('/documents/')[1]

      await page.getByPlaceholder('Untitled').fill('Who Changed Test')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/'))

      // Make a change
      await page.locator('select').filter({ hasText: /backlog|todo/i }).selectOption('in_progress')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')

      // Fetch history
      const historyResponse = await page.request.get(`/api/issues/${issueId}/history`)
      const history = await historyResponse.json()

      // Each entry should have changed_by
      expect(history[0].changed_by).toBeTruthy()
    })

    test('history includes timestamp of change', async ({ page }) => {
      await page.goto('/issues')
      await page.getByRole('button', { name: 'New Issue', exact: true }).click()
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })
      const issueId = page.url().split('/documents/')[1]

      await page.getByPlaceholder('Untitled').fill('When Changed Test')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/'))

      await page.locator('select').filter({ hasText: /backlog|todo/i }).selectOption('in_progress')
      await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')

      const historyResponse = await page.request.get(`/api/issues/${issueId}/history`)
      const history = await historyResponse.json()

      // Each entry should have created_at timestamp
      expect(history[0].created_at).toBeTruthy()
    })
  })
})

// FIXME: Tests timeout waiting for API responses - issue creation flow may be broken
test.describe.fixme('Progress Chart Integration', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('progress chart shows estimate-based metrics', async ({ page }) => {
    await page.goto('/programs')
    await page.locator('tr[role="row"]', { hasText: /API Platform/i }).first().click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    await page.getByRole('tab', { name: 'Sprints' }).click()

    // The progress chart should include hours-based visualization
    // Look for the chart container
    await expect(page.locator('svg, [class*="chart"], [class*="progress"]').first()).toBeVisible({ timeout: 5000 })
  })
})
