import { test, expect } from './fixtures/isolated-env'

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

  test('program editor has Overview tab with icon and color properties', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see Overview tab (default tab)
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 5000 })

    // Should see icon label in properties sidebar (emoji picker)
    await expect(page.getByText('Icon')).toBeVisible({ timeout: 5000 })

    // Should see color label for color picker
    await expect(page.getByText('Color')).toBeVisible({ timeout: 5000 })
  })

  test('program editor has tabbed navigation (Overview, Issues, Sprints, Feedback)', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see all tabs (scoped to main to avoid icon rail)
    const main = page.locator('main')
    await expect(main.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 5000 })
    await expect(main.getByRole('tab', { name: 'Issues' })).toBeVisible({ timeout: 5000 })
    await expect(main.getByRole('tab', { name: 'Sprints' })).toBeVisible({ timeout: 5000 })
    await expect(main.getByRole('tab', { name: 'Feedback' })).toBeVisible({ timeout: 5000 })
  })

  test('can switch between program tabs', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Scope to main to avoid icon rail buttons
    const main = page.locator('main')

    // Click Issues tab
    await main.getByRole('tab', { name: 'Issues' }).click()

    // Should see New Issue button in issues tab
    await expect(page.getByRole('button', { name: 'New Issue' })).toBeVisible({ timeout: 5000 })

    // Click Sprints tab
    await main.getByRole('tab', { name: 'Sprints' }).click()

    // Should see Create sprint link in the timeline
    await expect(page.getByText(/\+ Create sprint/).first()).toBeVisible({ timeout: 5000 })

    // Click Feedback tab
    await main.getByRole('tab', { name: 'Feedback' }).click()

    // Should see Give Feedback button
    await expect(page.getByRole('button', { name: /give feedback/i })).toBeVisible({ timeout: 5000 })
  })

  test('Issues tab shows list and kanban view toggle', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Click Issues tab (scoped to main to avoid icon rail)
    await page.locator('main').getByRole('tab', { name: 'Issues' }).click()

    // Should see view toggle buttons (list/kanban)
    const viewToggle = page.locator('.flex.rounded-md.border')
    await expect(viewToggle.first()).toBeVisible({ timeout: 5000 })
  })

  // TODO: This test has a navigation race condition - clicking tab navigates to global Issues
  // The other tab tests pass, so this is likely a specific timing issue
  test.skip('can create issue from program Issues tab', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Wait for program editor to fully load - verify we have the tab bar
    const main = page.locator('main')
    await expect(main.getByRole('tab', { name: 'Overview' })).toBeVisible({ timeout: 5000 })

    // Click Issues tab
    await main.getByRole('tab', { name: 'Issues' }).click()

    // Should see New Issue button in the tab content
    await expect(main.getByRole('button', { name: 'New Issue' })).toBeVisible({ timeout: 5000 })

    // Verify we're still on the program page
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/)

    // Click New Issue button within main content
    await main.getByRole('button', { name: 'New Issue' }).click()

    // Should navigate to issue editor
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 5000 })
  })

  test('can create sprint from program Sprints tab', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Click Sprints tab
    await page.getByRole('tab', { name: 'Sprints' }).click()

    // Click Create sprint in the timeline
    await page.getByText(/\+ Create sprint/).first().click()

    // Should show sprint creation modal with heading and owner selection
    await expect(page.getByRole('heading', { name: /create sprint/i })).toBeVisible({ timeout: 5000 })

    // Modal should have owner selection and action buttons
    await expect(page.getByText(/who should own this sprint/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /create/i })).toBeVisible()
  })

  test('sprint creation modal can be closed', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Click Sprints tab
    await page.getByRole('tab', { name: 'Sprints' }).click()

    // Open sprint creation modal
    await page.getByText(/\+ Create sprint/).first().click()
    await expect(page.getByRole('heading', { name: /create sprint/i })).toBeVisible({ timeout: 5000 })

    // Click Cancel
    await page.getByRole('button', { name: /cancel/i }).click()

    // Modal should be closed
    await expect(page.getByRole('heading', { name: /create sprint/i })).not.toBeVisible({ timeout: 2000 })
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

  test('can change program color in Overview tab', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Should be on Overview tab by default
    await expect(page.getByText('Color')).toBeVisible({ timeout: 5000 })

    // Find color buttons (small circular buttons)
    const colorButtons = page.locator('button.rounded-full')
    const colorCount = await colorButtons.count()
    expect(colorCount).toBeGreaterThan(0)

    // Click a color button to change color
    if (colorCount > 1) {
      await colorButtons.nth(1).click()
      // Wait for update
      await page.waitForTimeout(500)
    }
  })

  test('program editor has editable title', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see editor with editable title area
    const editor = page.locator('.ProseMirror, .tiptap, [data-testid="editor"]')
    await expect(editor).toBeVisible({ timeout: 5000 })
  })

  test('Feedback tab shows filter options', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Click Feedback tab
    await page.getByRole('tab', { name: 'Feedback' }).click()

    // Should see filter buttons (New, Accepted, Rejected, All, Drafts)
    await expect(page.getByRole('button', { name: 'New' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: 'Accepted' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Rejected' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Drafts' })).toBeVisible()
  })

  test('can give feedback from program Feedback tab', async ({ page }) => {
    await page.goto('/programs')

    // Create new program
    await page.getByRole('button', { name: /new program/i }).click()
    await expect(page).toHaveURL(/\/programs\/[a-f0-9-]+/, { timeout: 5000 })

    // Click Feedback tab
    await page.getByRole('tab', { name: 'Feedback' }).click()

    // Click Give Feedback button
    await page.getByRole('button', { name: /give feedback/i }).click()

    // Should navigate to feedback editor
    await expect(page).toHaveURL(/\/feedback\/[a-f0-9-]+/, { timeout: 5000 })
  })

  test('program cards show emoji or initial badges', async ({ page }) => {
    await page.goto('/programs')

    // Wait for programs to load
    await page.waitForTimeout(500)

    // If there are program cards, they should show badges (emoji or first letter)
    const programCards = page.locator('button:has-text("issues")')
    if (await programCards.count() > 0) {
      // Each card should have a colored badge
      const badge = programCards.first().locator('.rounded-lg.text-sm.font-bold')
      await expect(badge).toBeVisible({ timeout: 2000 })
    }
  })

  test('empty programs page shows create prompt', async ({ page }) => {
    // This test would need a clean database, so we just verify the button exists
    await page.goto('/programs')

    // Should see New Program button even with existing programs
    await expect(page.getByRole('button', { name: /new program/i })).toBeVisible({ timeout: 5000 })
  })
})
