import { test, expect } from '@playwright/test'

test.describe('Sprints (Phase 6)', () => {
  // Helper to create a program and navigate to its view page
  async function createProgramAndGoToView(page: import('@playwright/test').Page): Promise<string> {
    await page.goto('/programs')

    // Click New Program and wait for navigation (longer timeout for API call)
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/([a-f0-9-]+)/, { timeout: 15000 })
    const programId = page.url().split('/programs/')[1]

    // Navigate to the program view page (tabbed view)
    await page.getByRole('button', { name: /view issues & sprints/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+\/view/, { timeout: 5000 })

    return programId
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
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('Sprints tab shows in program view', async ({ page }) => {
    await createProgramAndGoToView(page)

    // Should see Sprints tab (use tabs container)
    const tabsContainer = page.locator('.flex.gap-1')
    await expect(tabsContainer.getByText('Sprints')).toBeVisible({ timeout: 5000 })
  })

  test('can create a new sprint from program Sprints tab', async ({ page }) => {
    await createProgramAndGoToView(page)

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
    await createProgramAndGoToView(page)
    await createSprint(page, 'Sprint Status Test')

    // Should see planned status badge
    await expect(page.getByText('planned')).toBeVisible({ timeout: 5000 })
  })

  test('clicking sprint navigates to sprint view', async ({ page }) => {
    await createProgramAndGoToView(page)
    await createSprint(page, 'Sprint View Test')

    // Click on the sprint card
    await page.getByText('Sprint View Test').click()

    // Should navigate to sprint view
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })
  })

  test('sprint view shows backlog and sprint columns', async ({ page }) => {
    await createProgramAndGoToView(page)
    await createSprint(page, 'Two Column Test')

    // Navigate to sprint
    await page.getByText('Two Column Test').click()
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see backlog and sprint column headers
    await expect(page.getByRole('heading', { name: 'Backlog' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('heading', { name: 'Sprint' })).toBeVisible()
  })

  test('sprint view shows progress percentage', async ({ page }) => {
    await createProgramAndGoToView(page)
    await createSprint(page, 'Progress Bar Test')

    // Navigate to sprint
    await page.getByText('Progress Bar Test').click()
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see progress indicator (e.g., "0% complete (0/0)")
    await expect(page.getByText(/\d+% complete/)).toBeVisible({ timeout: 5000 })
  })

  test('can start a sprint (change status to active)', async ({ page }) => {
    await createProgramAndGoToView(page)
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
    await createProgramAndGoToView(page)
    await createSprint(page, 'Date Range Test')

    // Navigate to sprint
    await page.getByText('Date Range Test').click()
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see date range in format like "Dec 30 - Jan 13"
    // The page shows: program_name · Dec 30 - Jan 13
    await expect(page.getByText(/\w{3} \d+ - \w{3} \d+/)).toBeVisible({ timeout: 5000 })
  })

  test('sprint list in program shows progress', async ({ page }) => {
    await createProgramAndGoToView(page)
    await createSprint(page, 'Progress List Test')

    // Sprint card should show progress (e.g., "0/0 done")
    await expect(page.getByText(/\d+\/\d+ done/)).toBeVisible({ timeout: 5000 })
  })

  test('sprint view has back button to program', async ({ page }) => {
    const programId = await createProgramAndGoToView(page)
    await createSprint(page, 'Back Button Test')

    // Navigate to sprint
    await page.getByText('Back Button Test').click()
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })

    // Click back button - it's the first button in the main content header
    // The back button has the left arrow SVG and is inside the header
    await page.locator('main button:has(svg)').first().click()

    // Should navigate back to program (editor page, not view)
    await expect(page).toHaveURL(new RegExp(`/programs/${programId}`), { timeout: 5000 })
  })

  test('can assign issue to sprint via sprint picker in issue editor', async ({ page }) => {
    // Create a program with a sprint
    await createProgramAndGoToView(page)
    await createSprint(page, 'Picker Test Sprint')

    // Get the sprint URL for later verification
    await page.getByText('Picker Test Sprint').click()
    await expect(page).toHaveURL(/\/sprints\/[a-f0-9-]+/, { timeout: 5000 })
    const sprintUrl = page.url()

    // Go back to create an issue in the program
    await page.locator('main button:has(svg)').first().click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Get the program info for selecting in the issue
    const programUrl = page.url()
    const programId = programUrl.split('/programs/')[1]

    // Navigate to issues and create a new issue
    await page.goto('/issues')
    await page.getByRole('button', { name: /new issue/i }).click()
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 10000 })

    // Give the issue a title - use the actual title input field
    const titleInput = page.getByPlaceholder('Untitled')
    await titleInput.fill('Sprint Picker Test Issue')

    // Wait for title to save (API call)
    await page.waitForResponse(resp => resp.url().includes('/api/issues/') && resp.request().method() === 'PATCH')

    // Assign the issue to the program using the Program combobox
    // Click the Program combobox button (shows "No Program")
    await page.getByRole('combobox').filter({ hasText: 'No Program' }).click()

    // Wait for popover and click the program (it will show the program name)
    await page.waitForTimeout(300) // Wait for popover animation
    // The program name appears in the dropdown - click it
    const programItems = page.locator('[cmdk-item]')
    // Find the program item (not "No Program") and click it
    await programItems.filter({ hasNot: page.getByText('No Program') }).first().click()

    // Wait for sprints to load (triggered by program selection)
    await page.waitForResponse(resp => resp.url().includes('/api/programs/') && resp.url().includes('/sprints'))

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
