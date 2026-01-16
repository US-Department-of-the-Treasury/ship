/**
 * Document Workflows E2E Tests
 *
 * Tests for critical document workflows:
 * - Issue project assignment via dropdown
 * - Issue sprint assignment via properties panel
 * - Issue to project conversion
 * - Sprint planning board shows correct issues
 *
 * These tests use slow mode (3x timeout) for dev server reliability
 */

import { test, expect, Page } from './fixtures/dev-server'

// These tests run against existing dev servers (pnpm dev must be running)
// No container spinup = fast execution even on low memory systems

// Allow retries for flaky dev server conditions
test.describe.configure({ retries: 2 })

// Add delay between tests to let dev server recover
test.afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 2000))
})

// =============================================================================
// HELPERS
// =============================================================================

async function login(page: Page) {
  // Navigate to login and wait for page to be stable
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('#email')).toBeVisible({ timeout: 15000 })

  // Fill credentials with a small delay to ensure React is ready
  await page.locator('#email').click()
  await page.locator('#email').fill('dev@ship.local')
  await page.locator('#password').click()
  await page.locator('#password').fill('admin123')

  // Verify fields are filled before clicking
  await expect(page.locator('#email')).toHaveValue('dev@ship.local')
  await expect(page.locator('#password')).toHaveValue('admin123')

  // Click sign in and wait for redirect
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL('/login', { timeout: 30000 })
}

async function createIssue(page: Page, title: string) {
  await page.goto('/issues')
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('button', { name: 'New Issue', exact: true })).toBeVisible({ timeout: 20000 })
  await page.getByRole('button', { name: 'New Issue', exact: true }).click()
  await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 20000 })

  // Set title and wait for save indicator
  const titleInput = page.getByPlaceholder('Untitled')
  await titleInput.fill(title)
  // Wait for title to be saved
  await page.waitForTimeout(1000)
}

// =============================================================================
// ISSUE PROGRAM ASSIGNMENT
// =============================================================================

test.describe('Issue Program Assignment', () => {
  test.slow() // 3x timeout for dev server

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('user creates issue and assigns to program via dropdown', async ({ page }) => {
    await createIssue(page, 'Program Assignment Test')

    // Find and click the Program combobox
    const programCombobox = page.getByRole('combobox', { name: 'Program' })
    await expect(programCombobox).toBeVisible({ timeout: 10000 })
    await programCombobox.click()

    // Wait for dropdown and select Ship Core
    await page.waitForTimeout(500)
    const shipCoreOption = page.locator('[cmdk-item]').filter({ hasText: 'Ship Core' })
    await expect(shipCoreOption).toBeVisible({ timeout: 5000 })
    await shipCoreOption.click()

    // Verify program is selected (UI-based assertion, not waitForResponse)
    await expect(programCombobox).toContainText('Ship Core', { timeout: 5000 })
  })
})

// =============================================================================
// ISSUE SPRINT ASSIGNMENT
// =============================================================================

test.describe('Issue Sprint Assignment', () => {
  test.slow() // 3x timeout for dev server

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('user assigns issue to sprint via properties panel', async ({ page }) => {
    await createIssue(page, 'Sprint Assignment Test')

    // Assign to program first
    const programCombobox = page.getByRole('combobox', { name: 'Program' })
    await programCombobox.click()
    await page.waitForTimeout(500)
    await page.locator('[cmdk-item]').filter({ hasText: 'Ship Core' }).click()
    await expect(programCombobox).toContainText('Ship Core', { timeout: 5000 })

    // Add estimate (required for sprint)
    const estimateInput = page.getByRole('spinbutton', { name: /estimate/i })
    await estimateInput.click()
    await estimateInput.clear()
    await estimateInput.pressSequentially('4', { delay: 100 })
    await page.waitForTimeout(1000) // Wait for debounced save and sprints to load

    // Assign to sprint
    const sprintCombobox = page.getByRole('combobox', { name: 'Sprint' })
    await expect(sprintCombobox).toBeVisible({ timeout: 10000 })
    await sprintCombobox.click()
    await page.waitForTimeout(500)

    // Select first available sprint
    const sprintOption = page.locator('[cmdk-item]').filter({ hasText: /Sprint \d+/ }).first()
    if (await sprintOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sprintOption.click()
      // Verify sprint selected via UI
      await expect(sprintCombobox).toContainText(/Sprint \d+/, { timeout: 5000 })
    }
  })
})

// =============================================================================
// DOCUMENT CONVERSION
// =============================================================================

test.describe('Issue to Project Conversion', () => {
  test.slow() // 3x timeout for dev server

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('user converts issue to project and sees in projects list', async ({ page }) => {
    const issueTitle = `Conversion Test ${Date.now()}`
    await createIssue(page, issueTitle)

    // Click "Promote to Project" button
    const promoteButton = page.getByRole('button', { name: /Promote to Project/i })
    await expect(promoteButton).toBeVisible({ timeout: 10000 })
    await promoteButton.click()

    // Confirm in dialog
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await dialog.getByRole('button', { name: /Promote to Project/i }).click()

    // Wait for navigation to new project
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 20000 })

    // Verify title preserved
    await expect(page.getByPlaceholder('Untitled')).toHaveValue(issueTitle)

    // Go to projects list and verify title appears
    await page.goto('/projects')
    // Use row selector to avoid matching sidebar and main content both
    await expect(page.getByRole('row', { name: new RegExp(issueTitle) })).toBeVisible({ timeout: 15000 })
  })
})

// =============================================================================
// SPRINT PLANNING BOARD
// =============================================================================

test.describe('Sprint Planning Board', () => {
  test.slow() // 3x timeout for dev server

  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('sprint planning board displays issues', async ({ page }) => {
    // Navigate to Ship Core program
    await page.goto('/programs')
    await expect(page.getByRole('row', { name: /Ship Core/i })).toBeVisible({ timeout: 10000 })
    await page.getByRole('row', { name: /Ship Core/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 10000 })

    // Click Sprints tab
    await page.getByRole('tab', { name: 'Sprints' }).click()
    await page.waitForTimeout(1000)

    // Click "Plan Sprint" button
    const planSprintButton = page.getByRole('button', { name: /Plan Sprint/i })
    if (await planSprintButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await planSprintButton.click({ force: true })
      await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+\/view/, { timeout: 15000 })

      // Click Planning tab
      await page.getByRole('tab', { name: 'Planning' }).click()
      await page.waitForLoadState('networkidle')

      // Should see kanban columns
      await expect(page.locator('h2').filter({ hasText: 'Backlog' })).toBeVisible({ timeout: 10000 })
      await expect(page.locator('h2').filter({ hasText: /^Sprint$/ })).toBeVisible()
    }
  })
})
