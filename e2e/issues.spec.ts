import { test, expect } from '@playwright/test'

test.describe('Issues (Phase 5)', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('can navigate to Issues mode via icon rail', async ({ page }) => {
    // Click Issues icon in the rail
    await page.getByRole('button', { name: /issues/i }).click()

    // Should be in issues mode
    await expect(page).toHaveURL(/\/issues/)

    // Should see Issues heading
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 5000 })
  })

  test('shows issues list or empty state', async ({ page }) => {
    await page.goto('/issues')

    // Should see New Issue button
    await expect(page.getByRole('button', { name: 'New Issue' })).toBeVisible({ timeout: 5000 })
  })

  test('can create a new issue', async ({ page }) => {
    await page.goto('/issues')

    // Click New Issue button
    await page.getByRole('button', { name: 'New Issue' }).click()

    // Should navigate to issue editor (full-page editor)
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 5000 })

    // Editor should be visible
    await expect(page.locator('.ProseMirror, .tiptap, [data-testid="editor"]')).toBeVisible({ timeout: 5000 })
  })

  test('new issue appears with ticket number in list', async ({ page }) => {
    await page.goto('/issues')

    // Create new issue
    await page.getByRole('button', { name: 'New Issue' }).click()
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 5000 })

    // Navigate back to list
    await page.goto('/issues')

    // Should see issue with ticket number (e.g., #1)
    await expect(page.getByText(/#\d+/).first()).toBeVisible({ timeout: 5000 })
  })

  test('issue has filter tabs (All, Active, Backlog, Done)', async ({ page }) => {
    await page.goto('/issues')

    // Should see filter tabs with exact names
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: 'Active' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Backlog' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Done' })).toBeVisible()
  })

  test('can switch between list and kanban view', async ({ page }) => {
    await page.goto('/issues')

    // Should see view toggle buttons (list/kanban icons)
    const viewToggle = page.locator('.flex.rounded-md.border')
    await expect(viewToggle.first()).toBeVisible({ timeout: 5000 })

    // Click kanban view button (second button in toggle)
    const kanbanButton = viewToggle.locator('button').nth(1)
    await kanbanButton.click()

    // Should show kanban columns - column titles are "Backlog", "Todo", "In Progress", "Done"
    await expect(page.getByText('Backlog').first()).toBeVisible({ timeout: 5000 })
  })

  test('issue editor shows full document editor', async ({ page }) => {
    await page.goto('/issues')

    // Create new issue
    await page.getByRole('button', { name: 'New Issue' }).click()
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 5000 })

    // Should see full editor with title area
    await expect(page.locator('.ProseMirror, .tiptap')).toBeVisible({ timeout: 5000 })

    // Should see properties sidebar (status, priority, etc.)
    await expect(page.getByText(/status|state/i)).toBeVisible({ timeout: 5000 })
  })

  test('can edit issue title', async ({ page }) => {
    await page.goto('/issues')

    // Create new issue
    await page.getByRole('button', { name: 'New Issue' }).click()
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 5000 })

    // Find title input (contenteditable or input)
    const titleElement = page.locator('[contenteditable="true"]').first()

    if (await titleElement.isVisible({ timeout: 2000 })) {
      await titleElement.click()
      await page.keyboard.press('Meta+a')
      await page.keyboard.type('My Test Issue Title')

      // Wait for save
      await page.waitForTimeout(500)

      await expect(titleElement).toContainText('My Test Issue Title')
    }
  })

  test('issue list shows status column', async ({ page }) => {
    await page.goto('/issues')

    // Create an issue first
    await page.getByRole('button', { name: 'New Issue' }).click()
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 5000 })

    // Go back to list
    await page.goto('/issues')

    // Should see Status column header in the table
    await expect(page.locator('th').filter({ hasText: 'Status' })).toBeVisible({ timeout: 5000 })
  })

  test('issue list shows priority column', async ({ page }) => {
    await page.goto('/issues')

    // Create an issue first
    await page.getByRole('button', { name: 'New Issue' }).click()
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 5000 })

    // Go back to list
    await page.goto('/issues')

    // Should see Priority column header
    await expect(page.locator('th').filter({ hasText: 'Priority' })).toBeVisible({ timeout: 5000 })
  })

  test('clicking issue row opens editor', async ({ page }) => {
    await page.goto('/issues')

    // Create an issue first
    await page.getByRole('button', { name: 'New Issue' }).click()
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 5000 })

    // Go back to list
    await page.goto('/issues')

    // Click on the issue row
    const issueRow = page.locator('tbody tr').first()
    await expect(issueRow).toBeVisible({ timeout: 5000 })
    await issueRow.click()

    // Should navigate to issue editor
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 5000 })
    await expect(page.locator('.ProseMirror, .tiptap')).toBeVisible({ timeout: 5000 })
  })

  test('filter tabs filter the issues list', async ({ page }) => {
    await page.goto('/issues')

    // Create an issue
    await page.getByRole('button', { name: 'New Issue' }).click()
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 5000 })

    // Go back to list
    await page.goto('/issues')

    // Click Active filter
    await page.getByRole('button', { name: 'Active' }).click()

    // URL should update with filter
    await expect(page).toHaveURL(/state=/)
  })

  test('keyboard shortcut C creates new issue', async ({ page }) => {
    await page.goto('/issues')

    // Wait for page to be fully loaded
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 5000 })

    // Press C to create new issue
    await page.keyboard.press('c')

    // Should navigate to new issue editor
    await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 5000 })
  })
})
