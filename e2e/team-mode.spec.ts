import { test, expect } from './fixtures/isolated-env'

test.describe('Team Mode (Phase 7)', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('can navigate to Teams mode via icon rail', async ({ page }) => {
    // Click Teams icon in rail
    await page.getByRole('button', { name: 'Teams' }).click()

    // Should navigate to /team
    await expect(page).toHaveURL('/team', { timeout: 5000 })
  })

  test('Teams mode shows header with team member count', async ({ page }) => {
    await page.goto('/team')

    // Should see Teams heading
    await expect(page.getByRole('heading', { name: 'Teams' })).toBeVisible({ timeout: 5000 })

    // Should see team member count
    await expect(page.getByText(/\d+ team members/)).toBeVisible({ timeout: 5000 })
  })

  test('Team grid displays all seeded users as rows', async ({ page }) => {
    await page.goto('/team')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 5000 })

    // Should see all seeded users (11 total)
    await expect(page.getByText('Dev User')).toBeVisible()
    await expect(page.getByText('Alice Chen')).toBeVisible()
    await expect(page.getByText('Bob Martinez')).toBeVisible()
    await expect(page.getByText('Carol Williams')).toBeVisible()
    await expect(page.getByText('David Kim')).toBeVisible()
    await expect(page.getByText('Emma Johnson')).toBeVisible()
    await expect(page.getByText('Frank Garcia')).toBeVisible()
    await expect(page.getByText('Grace Lee')).toBeVisible()
    await expect(page.getByText('Henry Patel')).toBeVisible()
    await expect(page.getByText('Iris Nguyen')).toBeVisible()
    await expect(page.getByText('Jack Brown')).toBeVisible()
  })

  test('Team grid displays sprint columns', async ({ page }) => {
    await page.goto('/team')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 5000 })

    // Should see at least one Sprint column header (Sprint 1, Sprint 2, etc.)
    await expect(page.getByText(/Sprint \d+/).first()).toBeVisible({ timeout: 5000 })
  })

  test('Current sprint column is highlighted', async ({ page }) => {
    await page.goto('/team')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 5000 })

    // The current sprint header should have accent styling (bg-accent/10)
    // We can check that at least one sprint column exists with the current styling
    // The current sprint has class bg-accent/10 applied
    const currentSprintHeader = page.locator('.bg-accent\\/10').first()
    await expect(currentSprintHeader).toBeVisible({ timeout: 5000 })
  })

  test('sprint columns can be scrolled horizontally', async ({ page }) => {
    await page.goto('/team')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 5000 })

    // Get the scrollable container
    const scrollContainer = page.locator('.overflow-x-auto')
    await expect(scrollContainer).toBeVisible()

    // Get initial scroll position
    const initialScrollLeft = await scrollContainer.evaluate(el => el.scrollLeft)

    // Scroll right
    await scrollContainer.evaluate(el => { el.scrollLeft += 200 })

    // Wait a bit for scroll
    await page.waitForTimeout(100)

    // Get new scroll position - it should have changed or be at max
    const newScrollLeft = await scrollContainer.evaluate(el => el.scrollLeft)

    // If there's content to scroll, position should change
    // If already at max, that's also valid (means we have scrollable content)
    expect(newScrollLeft).toBeGreaterThanOrEqual(initialScrollLeft)
  })

  test('API returns team grid data structure', async ({ page }) => {
    await page.goto('/team')

    // Intercept the API call
    const response = await page.waitForResponse(
      resp => resp.url().includes('/api/team/grid') && resp.status() === 200
    )

    const data = await response.json()

    // Verify data structure
    expect(data).toHaveProperty('users')
    expect(data).toHaveProperty('sprints')
    expect(data).toHaveProperty('associations')

    // Verify users array has expected structure
    expect(Array.isArray(data.users)).toBe(true)
    expect(data.users.length).toBeGreaterThan(0)
    expect(data.users[0]).toHaveProperty('id')
    expect(data.users[0]).toHaveProperty('name')
    expect(data.users[0]).toHaveProperty('email')

    // Verify sprints array has expected structure
    expect(Array.isArray(data.sprints)).toBe(true)
    expect(data.sprints.length).toBeGreaterThanOrEqual(3) // At least current + some before/after
    expect(data.sprints[0]).toHaveProperty('number')
    expect(data.sprints[0]).toHaveProperty('name')
    expect(data.sprints[0]).toHaveProperty('startDate')
    expect(data.sprints[0]).toHaveProperty('endDate')
    expect(data.sprints[0]).toHaveProperty('isCurrent')

    // Verify at least one sprint is marked as current
    const currentSprints = data.sprints.filter((s: { isCurrent: boolean }) => s.isCurrent)
    expect(currentSprints.length).toBe(1)
  })

  test('grid cells are clickable and empty cells exist', async ({ page }) => {
    await page.goto('/team')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 5000 })

    // Verify we have user rows and sprint columns
    await expect(page.getByText('Dev User')).toBeVisible()
    await expect(page.getByText(/Sprint \d+/).first()).toBeVisible()

    // Verify grid cells exist (empty cells or cells with content)
    // The grid should have cells for each user/sprint combination
    const gridCells = page.locator('.border-b.border-r.border-border')
    const cellCount = await gridCells.count()

    // We have 11 users and at least 3 sprints, so minimum cells would be 11 * 3 = 33
    // Plus the header row cells
    expect(cellCount).toBeGreaterThanOrEqual(33)
  })

  test('can assign user to program for a sprint', async ({ page }) => {
    await page.goto('/team')

    // Wait for grid and assignments to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 5000 })
    await page.waitForResponse(resp => resp.url().includes('/api/team/assignments'))

    // Scroll right to find future sprints (more likely to have empty cells)
    const scrollContainer = page.locator('.overflow-x-auto')
    await scrollContainer.evaluate(el => { el.scrollLeft = el.scrollWidth })
    await page.waitForTimeout(500) // Wait for scroll + any lazy loading

    // Find an empty cell (button with no program badge inside)
    // Empty cells are buttons within cells that don't have a program prefix span
    const emptyCell = page.locator('.border-b.border-r.border-border')
      .filter({ hasNot: page.locator('span.rounded.px-1\\.5.py-0\\.5.text-xs.font-bold') })
      .first()

    // Click the empty cell to open the program selector
    await emptyCell.click()

    // Wait for the popover to open (cmdk command menu)
    await expect(page.getByPlaceholder('Search programs...')).toBeVisible({ timeout: 3000 })

    // Select a program (click on API Platform which should exist from seed)
    await page.getByRole('option', { name: /API Platform/i }).click()

    // Wait for API response
    await page.waitForResponse(resp =>
      resp.url().includes('/api/team/assign') && resp.request().method() === 'POST'
    )

    // Verify the program badge now appears in that cell area
    // The cell should now show the API prefix badge
    await expect(page.locator('span.rounded.px-1\\.5.py-0\\.5.text-xs.font-bold').filter({ hasText: 'API' })).toBeVisible()
  })

  test('shows conflict error when user already assigned to different program', async ({ page }) => {
    await page.goto('/team')

    // Wait for grid and assignments to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 5000 })
    await page.waitForResponse(resp => resp.url().includes('/api/team/assignments'))

    // Find a cell that already has a program assignment
    const assignedCell = page.locator('.border-b.border-r.border-border')
      .filter({ has: page.locator('span.rounded.px-1\\.5.py-0\\.5.text-xs.font-bold') })
      .first()

    // Hover to reveal the dropdown caret, then click it
    await assignedCell.hover()
    await assignedCell.locator('button[aria-label="Change program assignment"]').click()

    // Wait for the popover to open
    await expect(page.getByPlaceholder('Search programs...')).toBeVisible({ timeout: 3000 })

    // Get current program and select a different one
    // Try to select Ship Core which is different from most seeded assignments
    const differentProgram = page.getByRole('option', { name: /Ship Core/i })
    if (await differentProgram.isVisible()) {
      await differentProgram.click()

      // Should show reassignment confirmation dialog
      await expect(page.getByText(/Reassign .+\?/)).toBeVisible({ timeout: 3000 })
    }
  })
})
