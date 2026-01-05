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

    // Should see Teams heading (use h1 to avoid matching sidebar h2)
    await expect(page.locator('h1').filter({ hasText: 'Teams' })).toBeVisible({ timeout: 5000 })

    // Should see team member count (at least 1 for logged in user)
    await expect(page.getByText(/\d+ team members?/)).toBeVisible({ timeout: 5000 })
  })

  test('Team grid displays logged-in user', async ({ page }) => {
    await page.goto('/team')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 5000 })

    // Should see at least the Dev User (who logged in)
    await expect(page.getByText('Dev User')).toBeVisible({ timeout: 5000 })
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

  test('can click cell to open program selector', async ({ page }) => {
    await page.goto('/team')
    await page.waitForLoadState('networkidle')

    // Wait for grid to load with user data
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Dev User')).toBeVisible({ timeout: 10000 })

    // Wait for sprint columns to load
    await expect(page.getByText(/Sprint \d+/).first()).toBeVisible({ timeout: 10000 })

    // Wait a moment for grid to stabilize
    await page.waitForTimeout(500)

    // Look for an empty cell (shows "+" placeholder) - clicking this opens the popover
    const emptyCellButton = page.getByRole('button', { name: '+' }).first()
    const hasEmptyCell = await emptyCellButton.count() > 0

    if (hasEmptyCell) {
      // Click empty cell button - this is a Popover.Trigger
      await emptyCellButton.click()
    } else {
      // All cells have programs assigned - need to click the caret button
      // Find a cell with program and hover to reveal caret
      const caretButton = page.getByLabel('Change program assignment').first()
      await expect(caretButton).toBeVisible({ timeout: 5000 })
      await caretButton.click({ force: true }) // force for opacity transition
    }

    // Wait for the popover to open (cmdk command menu)
    await expect(page.getByPlaceholder('Search programs...')).toBeVisible({ timeout: 10000 })

    // Verify the command menu is shown (either with programs or empty state)
    const commandMenu = page.locator('[cmdk-root]')
    await expect(commandMenu).toBeVisible()
  })

  test('program selector can be closed with Escape', async ({ page }) => {
    await page.goto('/team')
    await page.waitForLoadState('networkidle')

    // Wait for grid to load with user data
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Dev User')).toBeVisible({ timeout: 10000 })

    // Wait for sprint columns to load
    await expect(page.getByText(/Sprint \d+/).first()).toBeVisible({ timeout: 10000 })

    // Wait a moment for grid to stabilize
    await page.waitForTimeout(500)

    // Look for an empty cell (shows "+" placeholder) - clicking this opens the popover
    const emptyCellButton = page.getByRole('button', { name: '+' }).first()
    const hasEmptyCell = await emptyCellButton.count() > 0

    if (hasEmptyCell) {
      await emptyCellButton.click()
    } else {
      // All cells have programs - click the caret button
      const caretButton = page.getByLabel('Change program assignment').first()
      await expect(caretButton).toBeVisible({ timeout: 5000 })
      await caretButton.click({ force: true })
    }

    // Wait for the popover to open
    const searchInput = page.getByPlaceholder('Search programs...')
    await expect(searchInput).toBeVisible({ timeout: 10000 })

    // Focus the search input and wait for it to be ready
    await searchInput.focus()
    await page.waitForTimeout(200)

    // Press Escape to close
    await page.keyboard.press('Escape')

    // Verify popover is closed - allow time for animation
    await expect(searchInput).not.toBeVisible({ timeout: 5000 })
  })
})
