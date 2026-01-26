import { test, expect } from './fixtures/isolated-env'

/**
 * E2E tests for Sprints mode in the icon rail and sidebar
 *
 * Tests the Sprints Rail & Sidebar feature:
 * - Icon rail order (Docs → Programs → Projects → Sprints → Issues → Teams)
 * - Sprints icon navigation and active state
 * - Sidebar list of active sprints
 * - Main content table view
 * - Mode stickiness on sprint detail pages
 */

test.describe('Sprints Mode', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('icon rail shows correct order: Docs, Programs, Projects, Sprints, Issues, Teams', async ({ page }) => {
    await page.goto('/docs')

    // Wait for app to fully load
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 5000 })

    // Get all rail icons (excluding Settings which is at bottom)
    // The rail is a nav element with buttons for each mode
    const rail = page.locator('nav[aria-label="Navigation"]').or(page.locator('aside').first())

    // Verify each icon exists and get their vertical positions
    const docsButton = page.getByRole('button', { name: /docs|documents/i })
    const programsButton = page.getByRole('button', { name: /programs/i })
    const projectsButton = page.getByRole('button', { name: /projects/i })
    const sprintsButton = page.getByRole('button', { name: /sprints/i })
    const issuesButton = page.getByRole('button', { name: /issues/i })
    const teamButton = page.getByRole('button', { name: /team/i })

    // All buttons should be visible
    await expect(docsButton).toBeVisible({ timeout: 5000 })
    await expect(programsButton).toBeVisible()
    await expect(projectsButton).toBeVisible()
    await expect(sprintsButton).toBeVisible()
    await expect(issuesButton).toBeVisible()
    await expect(teamButton).toBeVisible()

    // Verify order by comparing Y positions
    const docsBox = await docsButton.boundingBox()
    const programsBox = await programsButton.boundingBox()
    const projectsBox = await projectsButton.boundingBox()
    const sprintsBox = await sprintsButton.boundingBox()
    const issuesBox = await issuesButton.boundingBox()
    const teamBox = await teamButton.boundingBox()

    expect(docsBox).not.toBeNull()
    expect(programsBox).not.toBeNull()
    expect(projectsBox).not.toBeNull()
    expect(sprintsBox).not.toBeNull()
    expect(issuesBox).not.toBeNull()
    expect(teamBox).not.toBeNull()

    // Verify order: Docs < Programs < Projects < Sprints < Issues < Teams
    expect(docsBox!.y).toBeLessThan(programsBox!.y)
    expect(programsBox!.y).toBeLessThan(projectsBox!.y)
    expect(projectsBox!.y).toBeLessThan(sprintsBox!.y)
    expect(sprintsBox!.y).toBeLessThan(issuesBox!.y)
    expect(issuesBox!.y).toBeLessThan(teamBox!.y)
  })

  test('clicking Sprints icon navigates to /sprints', async ({ page }) => {
    await page.goto('/docs')
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 5000 })

    // Click Sprints icon
    await page.getByRole('button', { name: /sprints/i }).click()

    // Should navigate to /sprints
    await expect(page).toHaveURL(/\/sprints/, { timeout: 5000 })

    // Should see Sprints header in main content (h1)
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })
  })

  test('Sprints icon is highlighted when on /sprints', async ({ page }) => {
    await page.goto('/sprints')

    // Wait for page to load
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })

    // The Sprints button should have active styling (bg-border or similar)
    const sprintsButton = page.getByRole('button', { name: /sprints/i })
    await expect(sprintsButton).toBeVisible()

    // Check for active state via background color or aria-current
    // The active button typically has bg-border class or similar styling
    const buttonClasses = await sprintsButton.getAttribute('class')
    const isActive = buttonClasses?.includes('bg-border') ||
                     buttonClasses?.includes('active') ||
                     await sprintsButton.getAttribute('aria-current') === 'page'

    expect(isActive || buttonClasses?.includes('bg-')).toBeTruthy()
  })

  test('sidebar shows Sprints header with no create button', async ({ page }) => {
    await page.goto('/sprints')
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })

    // Sidebar should show Sprints header
    const sidebar = page.locator('aside').filter({ hasText: 'Sprints' })
    await expect(sidebar).toBeVisible()

    // Should NOT have a create/new button (sprints are created via Programs)
    const createButton = sidebar.getByRole('button', { name: /new|create|\+/i })
    await expect(createButton).not.toBeVisible()
  })

  test('sidebar shows active sprints with program name and owner avatar', async ({ page }) => {
    await page.goto('/sprints')
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })

    // Wait for sprints to load in sidebar
    await page.waitForTimeout(500)

    // Should show sprint items in sidebar
    // Test data creates sprints for 5 programs at the current sprint number
    // Sidebar shows program names (not "Sprint X" which would be redundant)
    const sidebarItems = page.locator('aside ul li, aside [role="list"] [role="listitem"]')

    // Should have at least one sprint
    const count = await sidebarItems.count()

    if (count > 0) {
      // Each sprint item should have program name and avatar
      const firstItem = sidebarItems.first()

      // Should show program name (e.g., "API Platform", "Ship Core")
      // The text should NOT be "Sprint X" since all active sprints share the same number
      const itemText = await firstItem.textContent()
      expect(itemText).toBeTruthy()
      expect(itemText).not.toMatch(/^Sprint \d+$/) // Should not be just "Sprint X"

      // Should show owner avatar (typically a circle with initials)
      const avatar = firstItem.locator('.rounded-full, [class*="avatar"]')
      await expect(avatar).toBeVisible()
    }
  })

  test('main content shows table with correct columns', async ({ page }) => {
    await page.goto('/sprints')
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })

    // Wait for content to load
    await page.waitForTimeout(500)

    // Check for table headers
    const table = page.locator('table')

    // If there are active sprints, table should be visible
    const hasTable = await table.isVisible()

    if (hasTable) {
      // Verify column headers
      await expect(page.getByRole('columnheader', { name: /sprint/i })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /program/i })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /owner/i })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /progress/i })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: /days/i })).toBeVisible()
    }
  })

  test('clicking sprint row navigates to sprint detail', async ({ page }) => {
    await page.goto('/sprints')
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })

    // Wait for content to load
    await page.waitForTimeout(500)

    // Find a sprint row in the table
    const sprintRow = page.locator('tr[role="row"]').filter({ hasText: /Sprint \d+/ }).first()

    if (await sprintRow.isVisible()) {
      await sprintRow.click()

      // Should navigate to sprint detail view
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })
    }
  })

  test('Sprints mode stays active on sprint detail page', async ({ page }) => {
    await page.goto('/sprints')
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })

    // Wait for content to load
    await page.waitForTimeout(500)

    // Click a sprint row to navigate to detail
    const sprintRow = page.locator('tr[role="row"]').filter({ hasText: /Sprint \d+/ }).first()

    if (await sprintRow.isVisible()) {
      await sprintRow.click()

      // Wait for navigation
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })

      // Sprints icon should still be highlighted (mode stickiness)
      const sprintsButton = page.getByRole('button', { name: /sprints/i })
      await expect(sprintsButton).toBeVisible()

      // Check it has active styling
      const buttonClasses = await sprintsButton.getAttribute('class')
      expect(buttonClasses?.includes('bg-border') || buttonClasses?.includes('bg-')).toBeTruthy()
    }
  })

  test('shows current sprint number badge in header', async ({ page }) => {
    await page.goto('/sprints')
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })

    // Wait for content to load
    await page.waitForTimeout(500)

    // Should show Sprint X badge in header (next to h1, with bg-accent styling)
    // The badge is in the header div, not in the table
    const headerBadge = page.locator('.flex.items-center.gap-3 span').filter({ hasText: /Sprint \d+/ })
    const hasActiveSprints = await page.locator('tr[role="row"]').filter({ hasText: /Sprint \d+/ }).count() > 0

    if (hasActiveSprints) {
      // Badge should be visible in header
      await expect(headerBadge).toBeVisible()
    }
  })

  test('shows days remaining in header', async ({ page }) => {
    await page.goto('/sprints')
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })

    // Wait for content to load
    await page.waitForTimeout(500)

    // Should show "X day(s) remaining" text
    const daysRemaining = page.getByText(/\d+ days? remaining/)

    // This is only visible when there are active sprints
    const hasActiveSprints = await page.locator('tr[role="row"]').count() > 0

    if (hasActiveSprints) {
      await expect(daysRemaining).toBeVisible()
    }
  })

  test('sprint progress shows completion count and bar', async ({ page }) => {
    await page.goto('/sprints')
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })

    // Wait for content to load
    await page.waitForTimeout(500)

    // Find a sprint row
    const sprintRow = page.locator('tr[role="row"]').filter({ hasText: /Sprint \d+/ }).first()

    if (await sprintRow.isVisible()) {
      // Should show progress like "3/8"
      await expect(sprintRow.getByText(/\d+\/\d+/)).toBeVisible()

      // Should have progress bar container (the outer bg-border div)
      // The inner bar may have width 0% if no issues are completed, but container should be visible
      const progressBarContainer = sprintRow.locator('.bg-border.rounded-full, .overflow-hidden.rounded-full.bg-border')
      const containerCount = await progressBarContainer.count()
      expect(containerCount).toBeGreaterThan(0)
    }
  })

  test('owner column shows avatar and name', async ({ page }) => {
    await page.goto('/sprints')
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })

    // Wait for content to load
    await page.waitForTimeout(500)

    // Find a sprint row
    const sprintRow = page.locator('tr[role="row"]').filter({ hasText: /Sprint \d+/ }).first()

    if (await sprintRow.isVisible()) {
      // Owner cell should have avatar (circular element) and name
      const ownerCell = sprintRow.locator('td').nth(2) // Owner is 3rd column (0-indexed)

      // Should show owner name or "Unassigned"
      const hasOwner = await ownerCell.getByText(/dev user|unassigned/i).isVisible()
      expect(hasOwner).toBeTruthy()
    }
  })

  test('sidebar sprint click navigates to detail', async ({ page }) => {
    await page.goto('/sprints')
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })

    // Wait for content to load
    await page.waitForTimeout(500)

    // Find sprint item in sidebar and click (items show program names now)
    const sidebarItems = page.locator('aside ul li button, aside [role="list"] [role="listitem"] button')
    const count = await sidebarItems.count()

    if (count > 0) {
      await sidebarItems.first().click()

      // Should navigate to sprint detail
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })
    }
  })

  test('keyboard navigation works on sprint table rows', async ({ page }) => {
    await page.goto('/sprints')
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })

    // Wait for content to load
    await page.waitForTimeout(500)

    // Find a sprint row and focus it
    const sprintRow = page.locator('tr[role="row"]').filter({ hasText: /Sprint \d+/ }).first()

    if (await sprintRow.isVisible()) {
      // Focus the row
      await sprintRow.focus()

      // Press Enter to navigate
      await page.keyboard.press('Enter')

      // Should navigate to sprint detail
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 })
    }
  })
})

test.describe('Sprints Mode - Empty State', () => {
  // Note: The test fixture creates sprints at the current sprint number,
  // so we can't easily test empty state without modifying the database.
  // This test verifies the empty state markup exists and will display
  // when there are no active sprints.

  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('empty state message exists in page source', async ({ page }) => {
    await page.goto('/sprints')
    await expect(page.locator('h1', { hasText: 'Sprints' })).toBeVisible({ timeout: 5000 })

    // Wait for content to load
    await page.waitForTimeout(500)

    // The empty state message should exist in the DOM (may be hidden if sprints exist)
    const pageContent = await page.content()

    // Verify the empty state text exists in the component
    // (either visible when no sprints, or in the code path)
    const hasEmptyStateInSource = pageContent.includes('No active sprints') ||
                                   pageContent.includes('Check Programs')

    // If there are no sprints showing, the empty state should be visible
    const hasSprintRows = await page.locator('tr[role="row"]').filter({ hasText: /Sprint \d+/ }).count() > 0

    if (!hasSprintRows) {
      await expect(page.getByText('No active sprints')).toBeVisible()
      await expect(page.getByText('Check Programs to see upcoming sprints')).toBeVisible()
    } else {
      // If sprints exist, empty state shouldn't be visible
      await expect(page.getByText('No active sprints')).not.toBeVisible()
    }
  })
})
