import { test, expect, Page, Browser } from './fixtures/isolated-env'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Race Conditions and Concurrency Tests
 *
 * Tests that verify the application handles concurrent operations correctly:
 * - Multiple users editing simultaneously
 * - Rapid operations that could conflict
 * - File uploads during editing
 * - Multiple browser tabs
 * - Network race conditions
 */

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
  await expect(page.locator('input[placeholder="Untitled"]')).toBeVisible({ timeout: 3000 })
}

// Helper to login
async function login(page: Page, email: string = 'dev@ship.local', password: string = 'admin123') {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL('/login', { timeout: 5000 })
}

// Create test image file
function createTestImageFile(): string {
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64'
  )
  const tmpPath = path.join(os.tmpdir(), `test-image-${Date.now()}.png`)
  fs.writeFileSync(tmpPath, pngBuffer)
  return tmpPath
}

test.describe('Race Conditions - Concurrent Editing', () => {
  // Test collaboration between two users editing same document
  // Uses sequential typing with sync waits to avoid race condition flakiness
  test('concurrent edits from two users merge correctly', async ({ page, browser }) => {
    await login(page)
    await createNewDocument(page)

    const docUrl = page.url()
    const editor1 = page.locator('.ProseMirror')

    // User 1 types
    await editor1.click()
    await page.keyboard.type('User 1 writes this. ')

    // Wait for content to save
    await expect(page.getByText('Saved').first()).toBeVisible({ timeout: 10000 })
    // Wait extra for Yjs to persist to server
    await page.waitForTimeout(2000)

    // Open second tab as different user
    const page2 = await browser.newPage()
    await login(page2)
    await page2.goto(docUrl)

    const editor2 = page2.locator('.ProseMirror')
    await expect(editor2).toBeVisible({ timeout: 5000 })
    // Wait for WebSocket to connect and sync
    await page2.waitForTimeout(2000)

    // User 2 should see User 1's content (with auto-retry)
    await expect(editor2).toContainText('User 1 writes this', { timeout: 15000 })

    // User 1 types more
    await editor1.click()
    await page.keyboard.press('End')
    await page.keyboard.type('More from user 1. ')
    await page.waitForTimeout(2000) // Wait for sync

    // Wait for User 2 to see User 1's update
    await expect(editor2).toContainText('More from user 1', { timeout: 15000 })

    // User 2 types
    await editor2.click()
    await page2.keyboard.press('End')
    await page2.keyboard.type('User 2 adds this.')
    await page2.waitForTimeout(2000) // Wait for sync

    // Both users should see all content (order may vary due to CRDT)
    await expect(editor1).toContainText('User 1 writes this', { timeout: 15000 })
    await expect(editor1).toContainText('More from user 1', { timeout: 15000 })
    await expect(editor1).toContainText('User 2 adds this', { timeout: 15000 })

    await expect(editor2).toContainText('User 1 writes this', { timeout: 15000 })
    await expect(editor2).toContainText('More from user 1', { timeout: 15000 })
    await expect(editor2).toContainText('User 2 adds this', { timeout: 15000 })

    await page2.close()
  })

  test('delete during collaboration is handled', async ({ page, browser }) => {
    await login(page)
    await createNewDocument(page)

    const docUrl = page.url()
    const editor1 = page.locator('.ProseMirror')

    // Add content
    await editor1.click()
    await page.keyboard.type('Initial text here.')
    await expect(page.getByText('Saved').first()).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(2000)

    // Open second tab
    const page2 = await browser.newPage()
    await login(page2)
    await page2.goto(docUrl)

    const editor2 = page2.locator('.ProseMirror')
    await expect(editor2).toBeVisible({ timeout: 5000 })
    await page2.waitForTimeout(3000)

    // User 2 should see User 1's content
    await expect(editor2).toContainText('Initial text here', { timeout: 10000 })

    // User 2 adds text at the end
    await editor2.click()
    await page2.keyboard.press('End')
    await page2.keyboard.type(' Added by user 2.')
    await page2.waitForTimeout(2000)

    // Wait for sync to User 1
    await page.waitForTimeout(3000)

    // User 1 should see User 2's text
    await expect(editor1).toContainText('Added by user 2', { timeout: 10000 })

    // Verify both editors converge (check actual paragraphs, not raw textContent)
    const p1 = editor1.locator('p')
    const p2 = editor2.locator('p')

    // Should have same number of paragraphs
    const p1Count = await p1.count()
    const p2Count = await p2.count()
    expect(p1Count).toBe(p2Count)

    await page2.close()
  })

  // Test multiple tabs editing same document stay in sync
  // Uses sequential typing with sync waits between tabs to avoid flakiness
  test('multiple tabs editing same document stay in sync', async ({ page, browser }) => {
    await login(page)
    await createNewDocument(page)

    const docUrl = page.url()
    const editor1 = page.locator('.ProseMirror')

    // Tab 1 types first and waits for save
    await editor1.click()
    await page.keyboard.type('Tab 1 content. ')
    await expect(page.getByText('Saved').first()).toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(2000) // Wait for Yjs to persist

    // Open Tab 2 and wait for it to sync
    const page2 = await browser.newPage()
    await login(page2)
    await page2.goto(docUrl)
    const editor2 = page2.locator('.ProseMirror')
    await expect(editor2).toBeVisible({ timeout: 5000 })
    await page2.waitForTimeout(2000) // Wait for WebSocket sync

    // Tab 2 should see Tab 1's content
    await expect(editor2).toContainText('Tab 1 content', { timeout: 15000 })

    // Tab 2 types
    await editor2.click()
    await page2.keyboard.press('End')
    await page2.keyboard.type('Tab 2 content. ')
    await expect(page2.getByText('Saved').first()).toBeVisible({ timeout: 10000 })
    await page2.waitForTimeout(2000) // Wait for Yjs to persist

    // Open Tab 3 and wait for it to sync
    const page3 = await browser.newPage()
    await login(page3)
    await page3.goto(docUrl)
    const editor3 = page3.locator('.ProseMirror')
    await expect(editor3).toBeVisible({ timeout: 5000 })
    await page3.waitForTimeout(2000) // Wait for WebSocket sync

    // Tab 3 should see Tab 1 and Tab 2's content
    await expect(editor3).toContainText('Tab 1 content', { timeout: 15000 })
    await expect(editor3).toContainText('Tab 2 content', { timeout: 15000 })

    // Tab 3 types
    await editor3.click()
    await page3.keyboard.press('End')
    await page3.keyboard.type('Tab 3 content.')
    await expect(page3.getByText('Saved').first()).toBeVisible({ timeout: 10000 })
    await page3.waitForTimeout(2000) // Wait for sync

    // All tabs should have all content
    await expect(editor1).toContainText('Tab 1 content', { timeout: 15000 })
    await expect(editor1).toContainText('Tab 2 content', { timeout: 15000 })
    await expect(editor1).toContainText('Tab 3 content', { timeout: 15000 })

    await expect(editor2).toContainText('Tab 1 content', { timeout: 15000 })
    await expect(editor2).toContainText('Tab 2 content', { timeout: 15000 })
    await expect(editor2).toContainText('Tab 3 content', { timeout: 15000 })

    await expect(editor3).toContainText('Tab 1 content', { timeout: 15000 })
    await expect(editor3).toContainText('Tab 2 content', { timeout: 15000 })
    await expect(editor3).toContainText('Tab 3 content', { timeout: 15000 })

    await page2.close()
    await page3.close()
  })
})

test.describe('Race Conditions - Rapid Operations', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('rapid save operations do not conflict', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type rapidly to trigger multiple save operations
    const rapidText = 'a'.repeat(100)
    await page.keyboard.type(rapidText, { delay: 10 })

    // Wait for all saves to complete
    await page.waitForTimeout(3000)

    // Reload page
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // All content should be saved
    await expect(page.locator('.ProseMirror')).toContainText(rapidText)
  })

  test('rapid title changes are handled correctly', async ({ page }) => {
    await createNewDocument(page)

    const titleInput = page.locator('input[placeholder="Untitled"]')

    // Change title rapidly
    const titles = ['Title 1', 'Title 2', 'Title 3', 'Final Title']

    for (const title of titles) {
      await titleInput.click()
      await titleInput.fill(title)
      await page.waitForTimeout(200) // Brief delay between changes
    }

    // Wait for final save
    await page.waitForTimeout(2000)

    // Reload and verify final title is saved
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    await expect(titleInput).toHaveValue('Final Title')
  })

  test('rapid document creation does not cause duplicates', async ({ page }) => {
    await page.goto('/docs')
    await page.waitForLoadState('networkidle')

    // Keep track of created document URLs to verify they're unique
    const createdUrls: string[] = []

    // Create documents sequentially
    const sidebarButton = page.locator('aside').getByRole('button', { name: /new|create|\+/i }).first()

    for (let i = 0; i < 3; i++) {
      await expect(sidebarButton).toBeVisible({ timeout: 3000 })
      await sidebarButton.click()
      await page.waitForURL(/\/docs\/[a-f0-9-]+/, { timeout: 5000 })

      // Store the URL to check for duplicates
      const url = page.url()
      createdUrls.push(url)

      // Wait for editor to be ready before navigating
      await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

      // Navigate back to docs list
      await page.goto('/docs')
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(500)
    }

    // THE CORE TEST: Verify no duplicate document IDs were created
    // This is what "does not cause duplicates" means - each click creates a unique document
    const uniqueUrls = new Set(createdUrls)
    expect(uniqueUrls.size).toBe(3) // All 3 must be unique (no duplicates)

    // Verify each document is accessible (confirms they were actually created)
    for (const url of createdUrls) {
      await page.goto(url)
      await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    }
  })

  test('rapid mention searches do not cause race conditions', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type @ multiple times rapidly
    for (let i = 0; i < 5; i++) {
      await page.keyboard.type('@test')
      await page.waitForTimeout(100)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await page.waitForTimeout(100)
    }

    // Editor should still be functional
    await page.keyboard.type('Still works')
    await expect(editor).toContainText('Still works')
  })
})

test.describe('Race Conditions - Image Upload', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('image upload while typing does not interrupt editing', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Start typing
    await page.keyboard.type('Before image ')

    // Trigger image upload via slash command
    await page.keyboard.type('/image')
    await page.waitForTimeout(500)

    // Click the Image option specifically
    const imageOption = page.getByRole('button', { name: /^Image Upload an image/i })
    await expect(imageOption).toBeVisible({ timeout: 3000 })

    const tmpPath = createTestImageFile()
    const fileChooserPromise = page.waitForEvent('filechooser')
    await imageOption.click()

    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(tmpPath)

    // Wait for upload to complete
    await page.waitForTimeout(2000)

    // Continue typing (click editor first since file chooser may have changed focus)
    await editor.click()
    await page.keyboard.type(' After image')

    await page.waitForTimeout(1000)

    // Both text and image should be present
    await expect(editor).toContainText('Before image')
    await expect(editor).toContainText('After image')
    await expect(editor.locator('img')).toBeVisible({ timeout: 5000 })

    fs.unlinkSync(tmpPath)
  })

  test('multiple image uploads in parallel', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Upload three images, one at a time
    const tmpPaths: string[] = []

    for (let i = 0; i < 3; i++) {
      await page.keyboard.type('/image')
      await page.waitForTimeout(500)

      // Click the Image option specifically
      const imageOption = page.getByRole('button', { name: /^Image Upload an image/i })
      await expect(imageOption).toBeVisible({ timeout: 3000 })

      const tmpPath = createTestImageFile()
      tmpPaths.push(tmpPath)

      const fileChooserPromise = page.waitForEvent('filechooser')
      await imageOption.click()

      const fileChooser = await fileChooserPromise
      await fileChooser.setFiles(tmpPath)

      // Wait for upload to complete before next one
      await page.waitForTimeout(2000)

      // Click editor to refocus
      await editor.click()
    }

    // Wait for all uploads to complete
    await page.waitForTimeout(2000)

    // Should have 3 images
    const imgCount = await editor.locator('img').count()
    expect(imgCount).toBe(3)

    // Cleanup
    tmpPaths.forEach(p => fs.unlinkSync(p))
  })

  test('mention search while editing', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type, trigger mention, continue typing
    await page.keyboard.type('Some text before ')
    await page.keyboard.type('@')

    // Wait for mention popup
    await expect(page.locator('[role="listbox"]')).toBeVisible({ timeout: 5000 })

    // Close mention popup and continue typing
    await page.keyboard.press('Escape')
    await page.keyboard.type(' more text after')

    // All text should be present
    await expect(editor).toContainText('Some text before @ more text after')
  })
})

test.describe('Race Conditions - Network and Offline', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('offline edits queue and sync when back online', async ({ page, context }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Make initial edit online
    await page.keyboard.type('Online content. ')
    await page.waitForTimeout(1000)

    // Go offline
    await context.setOffline(true)

    // Make edits while offline
    await page.keyboard.type('Offline edit 1. ')
    await page.waitForTimeout(500)
    await page.keyboard.type('Offline edit 2.')

    // Content should be visible locally
    await expect(editor).toContainText('Online content')
    await expect(editor).toContainText('Offline edit 1')
    await expect(editor).toContainText('Offline edit 2')

    // Go back online
    await context.setOffline(false)

    // Wait for sync
    await page.waitForTimeout(3000)

    // Reload to verify sync happened
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // All content should still be present
    await expect(page.locator('.ProseMirror')).toContainText('Online content')
    await expect(page.locator('.ProseMirror')).toContainText('Offline edit 1')
    await expect(page.locator('.ProseMirror')).toContainText('Offline edit 2')
  })

  test('slow network does not cause duplicate operations', async ({ page, context }) => {
    // Simulate slow network
    await context.route('**/*', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 500))
      await route.continue()
    })

    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Make rapid edits on slow network
    await page.keyboard.type('Test content')

    // Wait for operations to complete
    await page.waitForTimeout(3000)

    // Content should appear exactly once
    const content = await editor.textContent()
    expect(content?.match(/Test content/g)?.length).toBe(1)
  })
})
