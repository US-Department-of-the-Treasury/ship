import { test, expect } from '@playwright/test'

test.describe('Documents', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('can view document list', async ({ page }) => {
    // Navigate to docs
    await page.goto('/docs')

    // Should see Documents heading in the main content area
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 5000 })
  })

  test('can create a new document', async ({ page }) => {
    await page.goto('/docs')

    // Click New Document button in header (not sidebar)
    const newButton = page.getByRole('button', { name: 'New Document', exact: true })
    await expect(newButton).toBeVisible({ timeout: 5000 })
    await newButton.click()

    // Should navigate to editor
    await expect(page).toHaveURL(/\/docs\/[a-f0-9-]+/, { timeout: 10000 })
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
  })

  test('can edit document title', async ({ page }) => {
    await page.goto('/docs')

    // Create a new document first - use exact match for header button
    const newButton = page.getByRole('button', { name: 'New Document', exact: true })
    await expect(newButton).toBeVisible({ timeout: 5000 })
    await newButton.click()

    // Wait for editor
    await expect(page).toHaveURL(/\/docs\/[a-f0-9-]+/, { timeout: 10000 })
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // Find title input (large title input in editor) and enter text
    const titleInput = page.getByPlaceholder('Untitled')
    await expect(titleInput).toBeVisible({ timeout: 5000 })
    await titleInput.fill('Test Document Title')

    // Wait for save
    await page.waitForResponse(resp => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH')

    // Verify title was entered
    await expect(titleInput).toHaveValue('Test Document Title')
  })

  test('document list updates when new document created', async ({ page }) => {
    await page.goto('/docs')

    // Wait for main content to load
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 5000 })

    // Create new document - use exact match for header button
    const newButton = page.getByRole('button', { name: 'New Document', exact: true })
    await newButton.click()

    // Wait for editor
    await expect(page).toHaveURL(/\/docs\/[a-f0-9-]+/, { timeout: 10000 })

    // Give title so it shows in sidebar - use unique timestamp to avoid conflicts
    const uniqueTitle = `Test Doc ${Date.now()}`
    const titleInput = page.getByPlaceholder('Untitled')
    await titleInput.fill(uniqueTitle)

    // Wait for save to complete
    await page.waitForResponse(resp => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH')

    // The new document should now appear in sidebar - use longer timeout for context update
    await expect(page.getByText(uniqueTitle).first()).toBeVisible({ timeout: 10000 })
  })
})
