import { test, expect } from './fixtures/isolated-env'

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Start fresh - ensure logged out
    await page.context().clearCookies()
  })

  test('shows login page when not authenticated', async ({ page }) => {
    await page.goto('/')

    // Should redirect to login (may have query params like ?expired=true&returnTo=...)
    await expect(page).toHaveURL(/\/login/)

    // Should show login form
    await expect(page.locator('#email')).toBeVisible()
    await expect(page.locator('#password')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('shows validation error with empty credentials', async ({ page }) => {
    await page.goto('/login')

    // HTML5 validation prevents empty submission - verify fields are required
    const emailField = page.locator('#email')
    const passwordField = page.locator('#password')

    await expect(emailField).toHaveAttribute('required', '')
    await expect(passwordField).toHaveAttribute('required', '')
  })

  test('shows error with invalid credentials', async ({ page }) => {
    await page.goto('/login')

    // Enter invalid credentials
    await page.locator('#email').fill('invalid@test.com')
    await page.locator('#password').fill('wrongpassword')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Should show error message (role="alert")
    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 5000 })
  })

  test('successful login redirects to app', async ({ page }) => {
    await page.goto('/login')

    // Enter valid credentials (from seed data)
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Should redirect to app (not /login)
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })

    // Should show Documents page (default landing after login)
    await expect(page.locator('h1', { hasText: 'Documents' })).toBeVisible({ timeout: 5000 })
  })

  test('logout returns to login page', async ({ page }) => {
    // First login
    await page.goto('/login')
    await page.locator('#email').fill('dev@ship.local')
    await page.locator('#password').fill('admin123')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })

    // Click user avatar (logout button) - it's the button with user's initial
    const logoutButton = page.locator('button').filter({ hasText: /^[A-Z]$/ }).last()
    await logoutButton.click()

    // Should redirect to login
    await expect(page).toHaveURL('/login', { timeout: 5000 })
  })

  test('protected route redirects to login when not authenticated', async ({ page }) => {
    // Try to access protected route directly
    await page.goto('/docs')

    // Should redirect to login (may have query params like ?expired=true&returnTo=...)
    await expect(page).toHaveURL(/\/login/)
  })
})
