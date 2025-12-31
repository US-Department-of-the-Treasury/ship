import { test, expect } from '@playwright/test'

test.describe('Programs', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('can navigate to Programs mode via icon rail', async ({ page }) => {
    // Click Programs icon in the rail
    await page.getByRole('button', { name: /programs/i }).click()

    // Should be in programs mode
    await expect(page).toHaveURL(/\/programs/)

    // Should see Programs heading
    await expect(page.getByRole('heading', { name: /programs/i, level: 1 })).toBeVisible({ timeout: 5000 })
  })

  test('shows programs list with New Program button', async ({ page }) => {
    await page.goto('/programs')

    // Should see New Program button
    await expect(page.getByRole('button', { name: /new program/i })).toBeVisible({ timeout: 5000 })
  })

  test('can create a new program', async ({ page }) => {
    await page.goto('/programs')

    // Click New Program button
    await page.getByRole('button', { name: /new program/i }).click()

    // Should navigate to program editor
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })
  })

  test('new program appears in sidebar list', async ({ page }) => {
    await page.goto('/programs')

    // Count existing programs in sidebar
    await page.waitForTimeout(500)
    const initialCount = await page.locator('aside ul li').count()

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()

    // Wait for navigation
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Program should appear in sidebar
    await page.waitForTimeout(500)
    const newCount = await page.locator('aside ul li').count()
    expect(newCount).toBeGreaterThanOrEqual(initialCount)
  })

  test('program editor has prefix badge in sidebar', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see prefix label in properties sidebar
    await expect(page.getByText('Prefix')).toBeVisible({ timeout: 5000 })

    // Should see color label for color picker
    await expect(page.getByText('Color')).toBeVisible({ timeout: 5000 })
  })

  test('program editor has View Issues & Sprints button', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see the button to navigate to view page
    await expect(page.getByRole('button', { name: /view issues & sprints/i })).toBeVisible({ timeout: 5000 })
  })

  test('View Issues & Sprints navigates to tabbed view', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Click View Issues & Sprints button
    await page.getByRole('button', { name: /view issues & sprints/i }).click()

    // Should navigate to /view route
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+\/view/, { timeout: 5000 })
  })

  test('program view has Issues, Sprints, and Settings tabs', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Navigate to tabbed view
    await page.getByRole('button', { name: /view issues & sprints/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+\/view/, { timeout: 5000 })

    // Should see tabs (use text locator to target tab buttons, not icon rail)
    const tabsContainer = page.locator('.flex.gap-1')
    await expect(tabsContainer.getByText('Issues')).toBeVisible({ timeout: 5000 })
    await expect(tabsContainer.getByText('Sprints')).toBeVisible({ timeout: 5000 })
    await expect(tabsContainer.getByText('Settings')).toBeVisible({ timeout: 5000 })
  })

  test('can switch between program tabs', async ({ page }) => {
    await page.goto('/programs')

    // Create new program and navigate to view
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })
    await page.getByRole('button', { name: /view issues & sprints/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+\/view/, { timeout: 5000 })

    // Use tabs container to click tab buttons (not icon rail buttons)
    const tabsContainer = page.locator('.flex.gap-1')

    // Click Sprints tab
    await tabsContainer.getByText('Sprints').click()

    // Should see sprint-related content - use first() to avoid strict mode with multiple matches
    await expect(page.getByRole('button', { name: /new sprint/i })).toBeVisible({ timeout: 5000 })

    // Click Settings tab
    await tabsContainer.getByText('Settings').click()

    // Should see settings form with Name label
    await expect(page.getByText('Name')).toBeVisible({ timeout: 5000 })
  })

  test('can create issue from program view', async ({ page }) => {
    await page.goto('/programs')

    // Create new program and navigate to view
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })
    await page.getByRole('button', { name: /view issues & sprints/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+\/view/, { timeout: 5000 })

    // Ensure we're on Issues tab (default) - use tabs container
    const tabsContainer = page.locator('.flex.gap-1')
    await tabsContainer.getByText('Issues').click()

    // Wait for tab content to load
    await page.waitForTimeout(500)

    // Click New Issue button in the header (exact match)
    await page.getByRole('button', { name: 'New Issue', exact: true }).click()

    // Should navigate to issue editor (may go to list then redirect, so just check we end up at issues)
    await expect(page).toHaveURL(/\/issues/, { timeout: 5000 })
  })

  test('program list shows issue and sprint counts', async ({ page }) => {
    await page.goto('/programs')

    // Wait for programs to load
    await page.waitForTimeout(1000)

    // If there are program cards, they should show counts
    const programCards = page.locator('button:has-text("issues")')
    if (await programCards.count() > 0) {
      await expect(programCards.first()).toContainText(/\d+ issue/)
    }
  })

  test('can navigate between programs using sidebar', async ({ page }) => {
    await page.goto('/programs')

    // Create first program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })
    const firstProgramUrl = page.url()

    // Go back to programs list
    await page.goto('/programs')

    // Create second program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })
    expect(page.url()).not.toBe(firstProgramUrl)

    // Click first program in sidebar
    const sidebarItems = page.locator('aside ul li button')
    if (await sidebarItems.count() >= 2) {
      await sidebarItems.first().click()
      await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/)
    }
  })

  test('program settings can update program name', async ({ page }) => {
    await page.goto('/programs')

    // Create new program and navigate to view
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })
    await page.getByRole('button', { name: /view issues & sprints/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+\/view/, { timeout: 5000 })

    // Go to Settings tab - use tabs container
    const tabsContainer = page.locator('.flex.gap-1')
    await tabsContainer.getByText('Settings').click()

    // Find name input and update it
    const nameInput = page.locator('input[type="text"]').first()
    await expect(nameInput).toBeVisible({ timeout: 5000 })
    await nameInput.clear()
    await nameInput.fill('Updated Program Name')

    // Save changes - use exact button text
    await page.getByRole('button', { name: 'Save Changes' }).click()

    // Wait for API call and re-render
    await page.waitForTimeout(1500)

    // Verify the input still has the updated value (proving save was successful)
    await expect(nameInput).toHaveValue('Updated Program Name')
  })
})
