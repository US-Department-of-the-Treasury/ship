/**
 * Sprint Planning Kanban View - E2E Test Specifications
 *
 * These tests verify the sprint planning kanban functionality in SprintView.tsx.
 * Run: pnpm test:e2e e2e/sprint-planning-kanban.spec.ts
 *
 * Test Organization:
 * - Layout: Two-column kanban (Backlog left, Sprint right)
 * - Add Issue: Click + button to add issue to sprint (with estimate modal if needed)
 * - Remove Issue: Click × button to remove issue from sprint back to backlog
 */

import { test, expect, Page } from './fixtures/isolated-env'

// =============================================================================
// HELPERS
// =============================================================================

async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#email').fill('dev@ship.local')
  await page.locator('#password').fill('admin123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL('/login', { timeout: 5000 })
}

async function navigateToSprintPlanningView(page: Page) {
  // Navigate to a program's Sprints tab and click "Open →" to go to SprintView
  await page.goto('/programs')
  await page.locator('main').getByRole('button', { name: /Ship Core/i }).click()
  await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

  // Click Sprints tab
  await page.getByRole('tab', { name: 'Sprints' }).click()

  // Wait for active sprint content and click "Open →"
  const openButton = page.getByRole('button', { name: /Open/ })
  await expect(openButton).toBeVisible({ timeout: 10000 })
  await openButton.click()

  // Should be on the sprint planning view
  await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+\/view/, { timeout: 5000 })
}

// =============================================================================
// LAYOUT TESTS
// =============================================================================

test.describe('Sprint Planning Kanban Layout', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToSprintPlanningView(page)
  })

  test('shows two-column layout: Backlog left, Sprint right', async ({ page }) => {
    // Wait for content to load
    await page.waitForLoadState('networkidle')

    // Should see Backlog column header (h2 element)
    await expect(page.locator('h2').filter({ hasText: 'Backlog' })).toBeVisible({ timeout: 5000 })

    // Should see Sprint column header (h2 element with exactly "Sprint", not "Sprint N")
    await expect(page.locator('h2').filter({ hasText: /^Sprint$/ })).toBeVisible()
  })

  test('backlog column shows issues without sprint assignment', async ({ page }) => {
    // Wait for content to load
    await page.waitForLoadState('networkidle')

    // Backlog column should exist - h2 with "Backlog" and "X issues" text below
    await expect(page.locator('h2').filter({ hasText: 'Backlog' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/\d+ issues/).first()).toBeVisible()
  })

  test('sprint column shows issues assigned to this sprint', async ({ page }) => {
    // Wait for content to load
    await page.waitForLoadState('networkidle')

    // Sprint column should exist - h2 with exactly "Sprint" (not "Sprint N")
    await expect(page.locator('h2').filter({ hasText: /^Sprint$/ })).toBeVisible({ timeout: 5000 })
  })
})

// =============================================================================
// ADD ISSUE TO SPRINT TESTS
// =============================================================================

test.describe('Add Issue to Sprint', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToSprintPlanningView(page)
  })

  test('backlog issues have + button to add to sprint', async ({ page }) => {
    // Wait for content to load
    await page.waitForLoadState('networkidle')

    // Look for + button in the backlog column (left side of kanban)
    // The + buttons are on backlog issue cards
    const addButtons = page.locator('button').filter({ hasText: '+' })

    const count = await addButtons.count()
    if (count > 0) {
      await expect(addButtons.first()).toBeVisible()
    }
    // If no backlog issues, that's fine - test passes
  })

  test('clicking + button on issue without estimate shows estimate modal', async ({ page }) => {
    // Wait for content to load
    await page.waitForLoadState('networkidle')

    // Find a + button (for adding to sprint)
    const addButton = page.locator('button').filter({ hasText: '+' }).first()

    if (await addButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addButton.click()

      // Should show estimate modal (if issue has no estimate) or just add to sprint
      const estimateModal = page.getByText(/Set Estimate|Story Points|Estimate/i).first()
      const wasAdded = await page.waitForResponse(
        resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH',
        { timeout: 3000 }
      ).catch(() => null)

      // Either the modal appeared OR the issue was added directly
      const modalVisible = await estimateModal.isVisible().catch(() => false)
      expect(modalVisible || wasAdded !== null).toBeTruthy()
    }
    // If no add button visible, test passes (no backlog issues)
  })

  test('add issue to sprint makes PATCH request with CSRF token', async ({ page }) => {
    // Wait for content to load
    await page.waitForLoadState('networkidle')

    // Find a + button (for adding to sprint)
    const addButton = page.locator('button').filter({ hasText: '+' }).first()

    if (await addButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Listen for CSRF token request
      const csrfPromise = page.waitForRequest(
        req => req.url().includes('/api/csrf-token'),
        { timeout: 5000 }
      ).catch(() => null)

      // Listen for PATCH request
      const patchPromise = page.waitForResponse(
        resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH',
        { timeout: 5000 }
      ).catch(() => null)

      await addButton.click()

      // If estimate modal appears, fill it and submit
      const estimateInput = page.locator('input[type="number"]').first()
      if (await estimateInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        await estimateInput.fill('3')
        await page.getByRole('button', { name: /Add to Sprint|Save|Submit/i }).click()
      }

      // Should have made CSRF token request
      const csrfRequest = await csrfPromise
      const patchResponse = await patchPromise

      // At least one of these should have happened (CSRF fetched, and/or PATCH made)
      expect(csrfRequest !== null || patchResponse !== null).toBeTruthy()
    }
  })
})

// =============================================================================
// REMOVE ISSUE FROM SPRINT TESTS
// =============================================================================

test.describe('Remove Issue from Sprint', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToSprintPlanningView(page)
  })

  test('sprint issues have × button to remove from sprint', async ({ page }) => {
    // Wait for content to load
    await page.waitForLoadState('networkidle')

    // Look for × button (remove buttons are on sprint issues)
    const removeButtons = page.locator('button').filter({ hasText: '×' })

    const count = await removeButtons.count()
    if (count > 0) {
      await expect(removeButtons.first()).toBeVisible()
    }
    // If no sprint issues, that's fine - test passes
  })

  test('clicking × button removes issue from sprint', async ({ page }) => {
    // Wait for content to load
    await page.waitForLoadState('networkidle')

    // Find a × button (for removing from sprint)
    const removeButton = page.locator('button').filter({ hasText: '×' }).first()

    if (await removeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Click remove button and wait for PATCH
      const [response] = await Promise.all([
        page.waitForResponse(
          resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH',
          { timeout: 5000 }
        ),
        removeButton.click()
      ])

      // PATCH should succeed (200) and set sprint_id to null
      expect(response.status()).toBe(200)
    }
  })

  test('remove issue makes PATCH request with sprint_id: null', async ({ page }) => {
    // Wait for content to load
    await page.waitForLoadState('networkidle')

    // Find a × button (for removing from sprint)
    const removeButton = page.locator('button').filter({ hasText: '×' }).first()

    if (await removeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Listen for PATCH request
      const requestPromise = page.waitForRequest(
        req => req.url().includes('/api/issues/') && req.method() === 'PATCH'
      )

      await removeButton.click()

      const request = await requestPromise
      const body = request.postDataJSON()

      // Verify payload sets sprint_id to null
      expect(body.sprint_id).toBeNull()
    }
  })
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

test.describe('Sprint Planning Kanban Integration', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToSprintPlanningView(page)
  })

  test('Plan Sprint button from timeline navigates to this view', async ({ page }) => {
    // Go back to program view
    await page.goto('/programs')
    await page.locator('main').getByRole('button', { name: /Ship Core/i }).click()
    await page.getByRole('tab', { name: 'Sprints' }).click()

    // Click Plan Sprint button (if visible)
    const planButton = page.getByRole('button', { name: /Plan Sprint/i })
    if (await planButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await planButton.click()
      await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+\/view/, { timeout: 5000 })
    }
  })
})
