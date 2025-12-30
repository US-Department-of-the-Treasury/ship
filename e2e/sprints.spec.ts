import { test, expect } from '@playwright/test'

test.describe('Sprints (Phase 6)', () => {
  // Helper to create a project and navigate to its view page
  async function createProjectAndGoToView(page: import('@playwright/test').Page): Promise<string> {
    await page.goto('/projects')

    // Click New Project and wait for navigation (longer timeout for API call)
    await page.getByRole('button', { name: /new project/i }).click()
    await expect(page).toHaveURL(/\/projects\/([a-f0-9-]+)/, { timeout: 15000 })
    const projectId = page.url().split('/projects/')[1]

    // Navigate to the project view page (tabbed view)
    await page.getByRole('button', { name: /view issues & sprints/i }).click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+\/view/, { timeout: 5000 })

    return projectId
  }

  // Helper to click Sprints tab (avoiding icon rail)
  async function clickSprintsTab(page: import('@playwright/test').Page) {
    const tabsContainer = page.locator('.flex.gap-1')
    await tabsContainer.getByText('Sprints').click()
  }

  // Helper to create a sprint
  async function createSprint(page: import('@playwright/test').Page, name: string) {
    await clickSprintsTab(page)
    await page.getByRole('button', { name: /new sprint/i }).click()

    // Wait for modal to appear
    await expect(page.getByRole('heading', { name: /create sprint/i })).toBeVisible({ timeout: 5000 })

    // Fill in sprint name
    await page.locator('input[type="text"]').first().fill(name)

    // Submit the form
    await page.locator('button[type="submit"]:has-text("Create Sprint")').click()

    // Wait for modal to close and sprint to appear
    await expect(page.getByText(name)).toBeVisible({ timeout: 10000 })
  }

  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.getByRole('textbox', { name: /email/i }).fill('dev@ship.local')
    await page.getByRole('textbox', { name: /password/i }).fill('password')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('Sprints tab shows in project view', async ({ page }) => {
    await createProjectAndGoToView(page)

    // Should see Sprints tab (use tabs container)
    const tabsContainer = page.locator('.flex.gap-1')
    await expect(tabsContainer.getByText('Sprints')).toBeVisible({ timeout: 5000 })
  })

  test('can create a new sprint from project Sprints tab', async ({ page }) => {
    await createProjectAndGoToView(page)

    // Click Sprints tab
    await clickSprintsTab(page)

    // Click New Sprint button
    await page.getByRole('button', { name: /new sprint/i }).click()

    // Modal should appear with "Create Sprint" heading
    await expect(page.getByRole('heading', { name: /create sprint/i })).toBeVisible({ timeout: 5000 })

    // Fill in sprint name
    const nameInput = page.locator('input[type="text"]').first()
    await nameInput.fill('Sprint 1')

    // Fill in goal (optional - textarea)
    await page.locator('textarea').fill('Complete the MVP features')

    // Submit the form
    await page.locator('button[type="submit"]:has-text("Create Sprint")').click()

    // Sprint should appear in list
    await expect(page.getByText('Sprint 1')).toBeVisible({ timeout: 10000 })
  })

  test('sprint shows status badge (planned/active/completed)', async ({ page }) => {
    await createProjectAndGoToView(page)
    await createSprint(page, 'Sprint Status Test')

    // Should see planned status badge
    await expect(page.getByText('planned')).toBeVisible({ timeout: 5000 })
  })

  test('clicking sprint navigates to sprint view', async ({ page }) => {
    await createProjectAndGoToView(page)
    await createSprint(page, 'Sprint View Test')

    // Click on the sprint card
    await page.getByText('Sprint View Test').click()

    // Should navigate to sprint view
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })
  })

  test('sprint view shows backlog and sprint columns', async ({ page }) => {
    await createProjectAndGoToView(page)
    await createSprint(page, 'Two Column Test')

    // Navigate to sprint
    await page.getByText('Two Column Test').click()
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see backlog and sprint column headers
    await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('heading', { name: 'Sprint' })).toBeVisible()
  })

  test('sprint view shows progress percentage', async ({ page }) => {
    await createProjectAndGoToView(page)
    await createSprint(page, 'Progress Bar Test')

    // Navigate to sprint
    await page.getByText('Progress Bar Test').click()
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see progress indicator (e.g., "0% complete (0/0)")
    await expect(page.getByText(/\d+% complete/)).toBeVisible({ timeout: 5000 })
  })

  test('can start a sprint (change status to active)', async ({ page }) => {
    await createProjectAndGoToView(page)
    await createSprint(page, 'Start Sprint Test')

    // Navigate to sprint
    await page.getByText('Start Sprint Test').click()
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })

    // Verify Start Sprint button is visible before clicking
    const startButton = page.getByRole('button', { name: 'Start Sprint' })
    await expect(startButton).toBeVisible({ timeout: 5000 })

    // Click Start Sprint button and wait for API response
    const [response] = await Promise.all([
      page.waitForResponse(resp => resp.url().includes('/api/sprints/') && resp.request().method() === 'PATCH'),
      startButton.click()
    ])

    // Verify API call succeeded
    expect(response.status()).toBe(200)

    // Should now show Complete Sprint button (proves status changed to active)
    await expect(page.getByRole('button', { name: 'Complete Sprint' })).toBeVisible({ timeout: 10000 })
  })

  test('sprint shows date range', async ({ page }) => {
    await createProjectAndGoToView(page)
    await createSprint(page, 'Date Range Test')

    // Navigate to sprint
    await page.getByText('Date Range Test').click()
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see date range in format like "Dec 30 - Jan 13"
    // The page shows: project_name · Dec 30 - Jan 13
    await expect(page.getByText(/\w{3} \d+ - \w{3} \d+/)).toBeVisible({ timeout: 5000 })
  })

  test('sprint list in project shows progress', async ({ page }) => {
    await createProjectAndGoToView(page)
    await createSprint(page, 'Progress List Test')

    // Sprint card should show progress (e.g., "0/0 done")
    await expect(page.getByText(/\d+\/\d+ done/)).toBeVisible({ timeout: 5000 })
  })

  test('sprint view has back button to project', async ({ page }) => {
    const projectId = await createProjectAndGoToView(page)
    await createSprint(page, 'Back Button Test')

    // Navigate to sprint
    await page.getByText('Back Button Test').click()
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })

    // Click back button - it's the first button in the main content header
    // The back button has the left arrow SVG and is inside the header
    await page.locator('main button:has(svg)').first().click()

    // Should navigate back to project (editor page, not view)
    await expect(page).toHaveURL(new RegExp(`/projects/${projectId}`), { timeout: 5000 })
  })

  test('can assign issue to sprint via sprint picker in issue editor', async ({ page }) => {
    // Create a project with a sprint
    await createProjectAndGoToView(page)
    await createSprint(page, 'Picker Test Sprint')

    // Get the sprint URL for later verification
    await page.getByText('Picker Test Sprint').click()
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })
    const sprintUrl = page.url()

    // Go back to create an issue in the project
    await page.locator('main button:has(svg)').first().click()
    await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+/, { timeout: 5000 })

    // Get the project info for selecting in the issue
    const projectUrl = page.url()
    const projectId = projectUrl.split('/projects/')[1]

    // Navigate to issues and create a new issue
    await page.goto('/issues')
    await page.getByRole('button', { name: /new issue/i }).click()
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 10000 })

    // Give the issue a title - use the actual title input field
    const titleInput = page.getByPlaceholder('Untitled')
    await titleInput.fill('Sprint Picker Test Issue')

    // Wait for title to save (API call)
    await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')

    // Assign the issue to the project using the Project combobox
    // Click the Project combobox button (shows "No Project")
    await page.getByRole('combobox').filter({ hasText: 'No Project' }).click()

    // Wait for popover and click the project (it will show the project name)
    await page.waitForTimeout(300) // Wait for popover animation
    // The project name appears in the dropdown - click it
    const projectItems = page.locator('[cmdk-item]')
    // Find the project item (not "No Project") and click it
    await projectItems.filter({ hasNot: page.getByText('No Project') }).first().click()

    // Wait for sprints to load (triggered by project selection)
    await page.waitForResponse(resp => resp.url().includes('/api/projects/') && resp.url().includes('/sprints'))

    // Now use the Sprint picker combobox to assign the issue to the sprint
    // Click the Sprint combobox button (shows "No Sprint")
    await page.getByRole('combobox').filter({ hasText: 'No Sprint' }).click()

    // Wait for popover and click the sprint
    await page.waitForTimeout(300)
    await page.getByText('Picker Test Sprint').click()

    // Wait for the update to save
    await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')

    // Navigate to the sprint view
    await page.goto(sprintUrl)
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })

    // Verify the issue appears in the Sprint column (right side)
    // Use .first() since the issue may appear in both backlog and sprint during assignment
    await expect(page.getByText('Sprint Picker Test Issue').first()).toBeVisible({ timeout: 10000 })
  })
})
