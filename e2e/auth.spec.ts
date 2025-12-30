import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    // Start fresh - ensure logged out
    await page.context().clearCookies()
  })

  test('shows login page when not authenticated', async ({ page }) => {
    await page.goto('/')

    // Should redirect to login
    await expect(page).toHaveURL('/login')

    // Should show login form
    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible()
    await expect(page.getByRole('textbox', { name: /password/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('shows validation error with empty credentials', async ({ page }) => {
    await page.goto('/login')

    // Click login without entering credentials
    await page.getByRole('button', { name: /sign in/i }).click()

    // Should show validation error
    await expect(page.getByText(/email.*required|invalid/i)).toBeVisible()
  })

  test('shows error with invalid credentials', async ({ page }) => {
    await page.goto('/login')

    // Enter invalid credentials
    await page.getByRole('textbox', { name: /email/i }).fill('invalid@test.com')
    await page.getByRole('textbox', { name: /password/i }).fill('wrongpassword')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Should show error message
    await expect(page.getByText(/invalid.*email|password/i)).toBeVisible({ timeout: 5000 })
  })

  test('successful login redirects to app', async ({ page }) => {
    await page.goto('/login')

    // Enter valid credentials (from seed data)
    await page.getByRole('textbox', { name: /email/i }).fill('dev@ship.local')
    await page.getByRole('textbox', { name: /password/i }).fill('password')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Should redirect to app (not /login)
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })

    // Should show app shell with user info
    await expect(page.getByText('dev@ship.local')).toBeVisible({ timeout: 5000 })
  })

  test('logout returns to login page', async ({ page }) => {
    // First login
    await page.goto('/login')
    await page.getByRole('textbox', { name: /email/i }).fill('dev@ship.local')
    await page.getByRole('textbox', { name: /password/i }).fill('password')
    await page.getByRole('button', { name: /sign in/i }).click()

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 })

    // Click logout
    await page.getByRole('button', { name: /logout|sign out/i }).click()

    // Should redirect to login
    await expect(page).toHaveURL('/login', { timeout: 5000 })
  })

  test('protected route redirects to login when not authenticated', async ({ page }) => {
    // Try to access protected route directly
    await page.goto('/documents')

    // Should redirect to login
    await expect(page).toHaveURL('/login')
  })
})
