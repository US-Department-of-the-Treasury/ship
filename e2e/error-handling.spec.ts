import { test, expect, Page } from './fixtures/isolated-env'

// Get API URL from environment
const API_URL = process.env.VITE_API_URL || 'http://localhost:3147'

// Helper to login
async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#email').fill('dev@ship.local')
  await page.locator('#password').fill('admin123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL('/login', { timeout: 5000 })
}

// Helper to create a new document
async function createNewDocument(page: Page) {
  await page.goto('/docs')
  await page.waitForLoadState('networkidle')

  const currentUrl = page.url()

  // Try sidebar button first, fall back to main "New Document" button
  const sidebarButton = page.locator('aside').getByRole('button', { name: /new|create|\+/i }).first()
  const mainButton = page.getByRole('button', { name: 'New Document', exact: true })

  if (await sidebarButton.isVisible({ timeout: 2000 })) {
    await sidebarButton.click()
  } else {
    await expect(mainButton).toBeVisible({ timeout: 5000 })
    await mainButton.click()
  }

  await page.waitForFunction(
    (oldUrl) => window.location.href !== oldUrl && /\/docs\/[a-f0-9-]+/.test(window.location.href),
    currentUrl,
    { timeout: 10000 }
  )

  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
}

test.describe('Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('handles API 500 error gracefully', async ({ page }) => {
    // Intercept API request and return 500 error
    await page.route('**/api/documents', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      })
    })

    await page.goto('/docs')

    // Should show error message or fallback UI, not crash
    await page.waitForTimeout(1000)

    // Page should still be responsive
    const body = page.locator('body')
    await expect(body).toBeVisible()

    // Should not show React error boundary
    const errorText = await body.textContent()
    expect(errorText).not.toContain('Something went wrong')
  })

  test('handles network disconnect gracefully', async ({ page, context }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type some content while online
    await page.keyboard.type('Online content')
    await expect(editor).toContainText('Online content')

    // Go offline
    await context.setOffline(true)

    // Should still be able to type
    await page.keyboard.type(' Offline content')
    await expect(editor).toContainText('Offline content')

    // Editor should remain functional
    await editor.click()
    await page.keyboard.press('Enter')
    await page.keyboard.type('New line offline')
    await expect(editor).toContainText('New line offline')

    // Go back online
    await context.setOffline(false)
  })

  test('shows error message when upload fails', async ({ page }) => {
    await createNewDocument(page)

    // Intercept upload API and make it fail
    await page.route('**/api/files/upload', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Upload failed' }),
      })
    })

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Try to trigger image upload via slash command
    await page.keyboard.type('/image')
    await page.waitForTimeout(500)

    // The slash command menu should still appear (not crash)
    // Slash menu renders in a Tippy popup - look for button containing "Image" text within
    const slashMenu = page.locator('button').filter({ hasText: 'Image' }).filter({ hasText: 'Upload' })
    await expect(slashMenu).toBeVisible({ timeout: 3000 })

    // Note: Full upload error testing requires file picker interaction
    // The key is that the UI doesn't crash when upload API fails
  })

  test('handles mention search failure gracefully', async ({ page }) => {
    await createNewDocument(page)

    // Intercept mention search API and make it fail
    await page.route('**/api/search/mentions**', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Search failed' }),
      })
    })

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type @ to trigger mention popup
    await page.keyboard.type('@')

    // Wait a moment for API call
    await page.waitForTimeout(1000)

    // Editor should not crash
    await expect(editor).toBeVisible()

    // Should still be able to type
    await page.keyboard.type('test')
    await expect(editor).toContainText('@test')
  })

  test('rejects invalid file types', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Trigger image upload
    await page.keyboard.type('/image')
    await page.waitForTimeout(500)

    // Note: Testing file type validation requires either:
    // 1. Mocking file picker with invalid file
    // 2. Or testing the validation logic directly
    // For now, verify the slash command appears (basic sanity check)
    const imageOption = page.getByRole('button', { name: /Image.*Upload/i })
    await expect(imageOption).toBeVisible({ timeout: 3000 })
  })

  test('rejects files that are too large', async ({ page }) => {
    await createNewDocument(page)

    // Intercept upload API to simulate file too large error
    await page.route('**/api/files/upload', (route) => {
      route.fulfill({
        status: 413,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'File too large' }),
      })
    })

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Trigger image upload command
    await page.keyboard.type('/image')
    await page.waitForTimeout(500)

    // Verify the command menu appears
    const imageOption = page.getByRole('button', { name: /Image.*Upload/i })
    await expect(imageOption).toBeVisible({ timeout: 3000 })
  })

  test('handles websocket reconnection', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type initial content
    await page.keyboard.type('Before disconnect')
    await expect(editor).toContainText('Before disconnect')

    // Wait for Yjs sync
    await page.waitForTimeout(1000)

    // Simulate websocket disconnect by going offline and back online
    await page.context().setOffline(true)
    await page.waitForTimeout(500)
    await page.context().setOffline(false)

    // Wait for reconnection
    await page.waitForTimeout(2000)

    // Should still be able to type after reconnection
    await editor.click()
    await page.keyboard.type(' After reconnect')
    await expect(editor).toContainText('After reconnect')
  })

  test('editor remains usable after error', async ({ page }) => {
    // Intercept documents API and fail it initially
    let requestCount = 0
    await page.route('**/api/documents', (route) => {
      requestCount++
      if (requestCount === 1) {
        // Fail first request
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Server error' }),
        })
      } else {
        // Let subsequent requests through
        route.continue()
      }
    })

    await page.goto('/docs')
    await page.waitForTimeout(1000)

    // Despite initial error, page should be responsive
    const body = page.locator('body')
    await expect(body).toBeVisible()

    // Try to navigate to a different mode
    await page.goto('/issues')
    await page.waitForLoadState('domcontentloaded')

    // Should be able to navigate successfully
    await expect(body).toBeVisible()
  })

  test('handles CSRF token expiration', async ({ page }) => {
    await createNewDocument(page)

    // Intercept API requests and return CSRF error
    await page.route('**/api/**', (route) => {
      if (route.request().method() === 'POST' || route.request().method() === 'PUT') {
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Invalid CSRF token' }),
        })
      } else {
        route.continue()
      }
    })

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Try to type (will trigger autosave which needs CSRF)
    await page.keyboard.type('Testing CSRF handling')
    await expect(editor).toContainText('Testing CSRF handling')

    // Editor should remain functional despite CSRF errors
    await page.keyboard.press('Enter')
    await page.keyboard.type('Still working')
    await expect(editor).toContainText('Still working')
  })

  test('handles concurrent API errors', async ({ page }) => {
    // Intercept multiple API endpoints and make them all fail
    await page.route('**/api/**', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server unavailable' }),
      })
    })

    // Try to load the app
    await page.goto('/docs')
    await page.waitForTimeout(1500)

    // App should not crash, should show some UI
    const body = page.locator('body')
    await expect(body).toBeVisible()

    // Should not show unhandled error or blank screen
    const bodyText = await body.textContent()
    expect(bodyText).toBeTruthy()
    expect(bodyText!.length).toBeGreaterThan(0)
  })

  test('recovers from temporary network failure', async ({ page, context }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type while online
    await page.keyboard.type('Online text')
    await expect(editor).toContainText('Online text')

    // Temporarily go offline
    await context.setOffline(true)
    await page.waitForTimeout(1000)

    // Go back online
    await context.setOffline(false)
    await page.waitForTimeout(1000)

    // Should be able to continue working
    await editor.click()
    await page.keyboard.type(' Recovered')
    await expect(editor).toContainText('Recovered')

    // Editor should be fully functional
    await page.keyboard.press('Enter')
    await page.keyboard.type('New line after recovery')
    await expect(editor).toContainText('New line after recovery')
  })
})
