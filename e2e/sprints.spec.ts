import { test, expect } from '@playwright/test'

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
    await page.getByRole('button', { name: /sign in/i }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('Sprints tab shows in program view', async ({ page }) => {
    await page.goto('/programs')

    // Click on an existing program (Ship Core from seed data)
    await page.locator('main').getByRole('button', { name: /ship core/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see Sprints tab button in the program editor
    await expect(page.getByRole('button', { name: 'Sprints' })).toBeVisible({ timeout: 5000 })
  })

  test('can assign issue to sprint via sprint picker in issue editor', async ({ page }) => {
    // Navigate to an existing program with sprints (Ship Core from seed data)
    await page.goto('/programs')
    await page.locator('main').getByRole('button', { name: /ship core/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Get program ID for later
    const programUrl = page.url()
    const programId = programUrl.split('/programs/')[1]

    // Navigate to issues and create a new issue
    await page.goto('/issues')
    await page.getByRole('button', { name: /new issue/i }).click()
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 10000 })

    // Give the issue a title
    const titleInput = page.getByPlaceholder('Untitled')
    await titleInput.fill('Sprint Picker Test Issue')

    // Wait for title to save (API call)
    await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')

    // Assign the issue to Ship Core program using the Program combobox
    await page.getByRole('combobox').filter({ hasText: 'No Program' }).click()

    // Wait for popover and click Ship Core
    await page.waitForTimeout(300)
    await page.getByText('Ship Core').click()

    // Wait for sprints to load
    await page.waitForResponse(resp => resp.url().includes('/api/programs/') && resp.url().includes('/sprints'))

    // Now use the Sprint picker to assign to a sprint
    await page.getByRole('combobox').filter({ hasText: 'No Sprint' }).click()

    // Wait for popover and select a sprint (any Sprint will do from seed data)
    await page.waitForTimeout(300)
    const sprintOption = page.locator('[cmdk-item]').filter({ hasText: /Sprint \d+/ }).first()
    await sprintOption.click()

    // Wait for the update to save
    await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')

    // Verify the sprint is now selected (the combobox should show the sprint name)
    await expect(page.getByRole('combobox').filter({ hasText: /Sprint \d+/ })).toBeVisible({ timeout: 5000 })
  })
})
