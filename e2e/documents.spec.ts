import { test, expect } from '@playwright/test'

test.describe('Documents', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login')
    await page.getByRole('textbox', { name: /email/i }).fill('dev@ship.local')
    await page.getByRole('textbox', { name: /password/i }).fill('password')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })
  })

  test('can view document list', async ({ page }) => {
    // Navigate to documents (might be default or need to click)
    await page.goto('/documents')

    // Should see documents section
    await expect(page.getByRole('heading', { name: /documents|docs/i })).toBeVisible({ timeout: 5000 })
  })

  test('can create a new document', async ({ page }) => {
    await page.goto('/documents')

    // Click new document button
    const newButton = page.getByRole('button', { name: /new|create|add/i })
    await expect(newButton).toBeVisible({ timeout: 5000 })
    await newButton.click()

    // Should navigate to editor or show editor
    await expect(page.locator('[data-testid="editor"], .ProseMirror, .tiptap')).toBeVisible({ timeout: 5000 })
  })

  test('can edit document title', async ({ page }) => {
    await page.goto('/documents')

    // Create a new document first
    const newButton = page.getByRole('button', { name: /new|create|add/i })
    await expect(newButton).toBeVisible({ timeout: 5000 })
    await newButton.click()

    // Wait for editor
    await expect(page.locator('[data-testid="editor"], .ProseMirror, .tiptap')).toBeVisible({ timeout: 5000 })

    // Find title input and enter text
    const titleInput = page.locator('[data-testid="document-title"], input[name="title"], .document-title')
    if (await titleInput.isVisible()) {
      await titleInput.fill('Test Document Title')

      // Verify title was entered
      await expect(titleInput).toHaveValue('Test Document Title')
    }
  })

  test('document list updates when new document created', async ({ page }) => {
    await page.goto('/documents')

    // Count existing documents
    const initialDocs = await page.locator('[data-testid="document-item"], .document-item').count()

    // Create new document
    const newButton = page.getByRole('button', { name: /new|create|add/i })
    await expect(newButton).toBeVisible({ timeout: 5000 })
    await newButton.click()

    // Wait for editor and go back
    await expect(page.locator('[data-testid="editor"], .ProseMirror, .tiptap')).toBeVisible({ timeout: 5000 })

    // Navigate back to list
    await page.goto('/documents')

    // Should have one more document
    await expect(page.locator('[data-testid="document-item"], .document-item')).toHaveCount(initialDocs + 1, { timeout: 5000 })
  })
})
