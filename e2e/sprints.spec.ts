import { test, expect } from './fixtures/isolated-env'

/**
 * Sprint tests that complement program-mode-sprint-ux.spec.ts
 *
 * NOTE: Most sprint tests are in program-mode-sprint-ux.spec.ts
 * This file contains only tests that use existing seed data programs/sprints
 */

test.describe('Sprints - Issue Editor Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('Sprints tab shows in program view', async ({ page }) => {
    await page.goto('/programs')

    // Click on an existing program (Ship Core from seed data) - using table row
    await page.locator('tr[role="row"]', { hasText: /ship core/i }).first().click()
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see Sprints tab in the program editor
    await expect(page.getByRole('tab', { name: 'Sprints' })).toBeVisible({ timeout: 5000 })
  })

  test('can assign issue to sprint via sprint picker in issue editor', async ({ page }) => {
    // Navigate to an existing program with sprints (Ship Core from seed data)
    await page.goto('/programs')
    await page.locator('tr[role="row"]', { hasText: /ship core/i }).first().click()
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })

    // Navigate to issues and create a new issue
    await page.goto('/issues')
    await page.getByRole('button', { name: 'New Issue', exact: true }).click()
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

    // Give the issue a title
    const titleInput = page.getByPlaceholder('Untitled')
    await titleInput.fill('Sprint Picker Test Issue')

    // Wait for title to save (API call) - unified document model uses /api/documents/
    await page.waitForResponse(resp => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH')

    // Add an estimate first (required before assigning to sprint)
    const estimateInput = page.getByRole('spinbutton', { name: /estimate/i })
    await estimateInput.fill('4')
    await page.waitForResponse(resp => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH')

    // Assign the issue to Ship Core program using the Programs multi-select
    // Programs now use MultiAssociationChips with "Add program..." button
    // Use specific selector to avoid collision with navigation Programs button
    await page.getByText('Add program...').click()

    // Wait for dropdown and click Ship Core
    await page.waitForTimeout(300)
    await page.getByRole('button', { name: /Ship Core/i }).click()

    // Wait for sprints to load
    await page.waitForResponse(resp => resp.url().includes('/api/programs/') && resp.url().includes('/sprints'))

    // Now use the Sprint picker to assign to a sprint
    // Sprint uses Combobox with aria-label="Sprint"
    await page.getByRole('combobox', { name: 'Sprint' }).click()

    // Wait for popover and select a sprint (any Sprint will do from seed data)
    await page.waitForTimeout(300)
    const sprintOption = page.locator('[cmdk-item]').filter({ hasText: /Sprint \d+/ }).first()
    await sprintOption.click()

    // Wait for the update to save - unified document model uses /api/documents/
    await page.waitForResponse(resp => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH')

    // Verify the sprint is now selected (the combobox should show the sprint name)
    await expect(page.getByRole('combobox', { name: 'Sprint' })).toHaveText(/Sprint \d+/, { timeout: 5000 })
  })
})

test.describe('Sprint Planning Page', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('Start Sprint button is visible on planning sprint', async ({ page }) => {
    // Navigate to a program and go to Sprints tab
    await page.goto('/programs')
    await page.locator('tr[role="row"]', { hasText: /ship core/i }).first().click()
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })

    // Click Sprints tab
    await page.locator('main').getByRole('tab', { name: 'Sprints' }).click()

    // Create a new sprint by clicking "+ Create sprint" - this creates via API and navigates
    await page.getByText(/\+ Create sprint/).first().click()

    // Should navigate to the new sprint document
    await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 10000 })

    // Should see Plan tab (sprints in 'planning' status show 'Plan' tab)
    await expect(page.getByRole('tab', { name: 'Plan' })).toBeVisible({ timeout: 5000 })

    // Click the Plan tab to see the Start Sprint button (it's on the Plan tab, not Overview)
    await page.getByRole('tab', { name: 'Plan' }).click()

    // Should see "Start Sprint" button (since it's in planning status)
    await expect(page.getByRole('button', { name: /start sprint/i })).toBeVisible({ timeout: 5000 })

    // Status should show "Planning" somewhere on the page
    await expect(page.getByText('Planning').first()).toBeVisible({ timeout: 5000 })
  })
})
