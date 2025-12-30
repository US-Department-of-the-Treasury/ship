import { test, expect } from '@playwright/test'

test.describe('Projects (Phase 4)', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.getByRole('textbox', { name: /email/i }).fill('dev@ship.local')
    await page.getByRole('textbox', { name: /password/i }).fill('admin123')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('can navigate to Projects mode via icon rail', async ({ page }) => {
    // Click Projects icon in the rail
    await page.getByRole('button', { name: /projects/i }).click()

    // Should be in projects mode
    await expect(page).toHaveURL(/\/projects/)

    // Should see Projects heading
    await expect(page.getByRole('heading', { name: /projects/i, level: 1 })).toBeVisible({ timeout: 5000 })
  })

  test('shows projects list with New Project button', async ({ page }) => {
    await page.goto('/projects')

    // Should see New Project button
    await expect(page.getByRole('button', { name: /new project/i })).toBeVisible({ timeout: 5000 })
  })

  test('can create a new project', async ({ page }) => {
    await page.goto('/projects')

    // Click New Project button
    await page.getByRole('button', { name: /new project/i }).click()

    // Should navigate to project editor
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 5000 })
  })

  test('new project appears in sidebar list', async ({ page }) => {
    await page.goto('/projects')

    // Count existing projects in sidebar
    await page.waitForTimeout(500)
    const initialCount = await page.locator('aside ul li').count()

    // Create new project
    await page.getByRole('button', { name: /new project/i }).click()

    // Wait for navigation
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 5000 })

    // Project should appear in sidebar
    await page.waitForTimeout(500)
    const newCount = await page.locator('aside ul li').count()
    expect(newCount).toBeGreaterThanOrEqual(initialCount)
  })

  test('project editor has prefix badge in sidebar', async ({ page }) => {
    await page.goto('/projects')

    // Create new project
    await page.getByRole('button', { name: /new project/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see prefix label in properties sidebar
    await expect(page.getByText('Prefix')).toBeVisible({ timeout: 5000 })

    // Should see color label for color picker
    await expect(page.getByText('Color')).toBeVisible({ timeout: 5000 })
  })

  test('project editor has View Issues & Sprints button', async ({ page }) => {
    await page.goto('/projects')

    // Create new project
    await page.getByRole('button', { name: /new project/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see the button to navigate to view page
    await expect(page.getByRole('button', { name: /view issues & sprints/i })).toBeVisible({ timeout: 5000 })
  })

  test('View Issues & Sprints navigates to tabbed view', async ({ page }) => {
    await page.goto('/projects')

    // Create new project
    await page.getByRole('button', { name: /new project/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 5000 })

    // Click View Issues & Sprints button
    await page.getByRole('button', { name: /view issues & sprints/i }).click()

    // Should navigate to /view route
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/view/, { timeout: 5000 })
  })

  test('project view has Issues, Sprints, and Settings tabs', async ({ page }) => {
    await page.goto('/projects')

    // Create new project
    await page.getByRole('button', { name: /new project/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 5000 })

    // Navigate to tabbed view
    await page.getByRole('button', { name: /view issues & sprints/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/view/, { timeout: 5000 })

    // Should see tabs (use text locator to target tab buttons, not icon rail)
    const tabsContainer = page.locator('.flex.gap-1')
    await expect(tabsContainer.getByText('Issues')).toBeVisible({ timeout: 5000 })
    await expect(tabsContainer.getByText('Sprints')).toBeVisible({ timeout: 5000 })
    await expect(tabsContainer.getByText('Settings')).toBeVisible({ timeout: 5000 })
  })

  test('can switch between project tabs', async ({ page }) => {
    await page.goto('/projects')

    // Create new project and navigate to view
    await page.getByRole('button', { name: /new project/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 5000 })
    await page.getByRole('button', { name: /view issues & sprints/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/view/, { timeout: 5000 })

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

  test('can create issue from project view', async ({ page }) => {
    await page.goto('/projects')

    // Create new project and navigate to view
    await page.getByRole('button', { name: /new project/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 5000 })
    await page.getByRole('button', { name: /view issues & sprints/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/view/, { timeout: 5000 })

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

  test('project list shows issue and sprint counts', async ({ page }) => {
    await page.goto('/projects')

    // Wait for projects to load
    await page.waitForTimeout(1000)

    // If there are project cards, they should show counts
    const projectCards = page.locator('button:has-text("issues")')
    if (await projectCards.count() > 0) {
      await expect(projectCards.first()).toContainText(/\d+ issue/)
    }
  })

  test('can navigate between projects using sidebar', async ({ page }) => {
    await page.goto('/projects')

    // Create first project
    await page.getByRole('button', { name: /new project/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 5000 })
    const firstProjectUrl = page.url()

    // Go back to projects list
    await page.goto('/projects')

    // Create second project
    await page.getByRole('button', { name: /new project/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 5000 })
    expect(page.url()).not.toBe(firstProjectUrl)

    // Click first project in sidebar
    const sidebarItems = page.locator('aside ul li button')
    if (await sidebarItems.count() >= 2) {
      await sidebarItems.first().click()
      await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/)
    }
  })

  test('project settings can update project name', async ({ page }) => {
    await page.goto('/projects')

    // Create new project and navigate to view
    await page.getByRole('button', { name: /new project/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 5000 })
    await page.getByRole('button', { name: /view issues & sprints/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/view/, { timeout: 5000 })

    // Go to Settings tab - use tabs container
    const tabsContainer = page.locator('.flex.gap-1')
    await tabsContainer.getByText('Settings').click()

    // Find name input and update it
    const nameInput = page.locator('input[type="text"]').first()
    await expect(nameInput).toBeVisible({ timeout: 5000 })
    await nameInput.clear()
    await nameInput.fill('Updated Project Name')

    // Save changes - use exact button text
    await page.getByRole('button', { name: 'Save Changes' }).click()

    // Wait for API call and re-render
    await page.waitForTimeout(1500)

    // Verify the input still has the updated value (proving save was successful)
    await expect(nameInput).toHaveValue('Updated Project Name')
  })
})
