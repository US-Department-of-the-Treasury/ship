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
  const newDocButton = page.locator('button[title="New document"]')
  await expect(newDocButton).toBeVisible({ timeout: 5000 })
  await newDocButton.click()

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
  await page.getByRole('button', { name: /sign in/i }).click()
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
  test('concurrent edits from two users merge correctly', async ({ page, browser }) => {
    await login(page)
    await createNewDocument(page)

    const docUrl = page.url()
    const editor1 = page.locator('.ProseMirror')

    // User 1 types
    await editor1.click()
    await page.keyboard.type('User 1 writes this. ')

    // Wait for sync
    await page.waitForTimeout(1000)

    // Open second tab as different user
    const page2 = await browser.newPage()
    await login(page2)
    await page2.goto(docUrl)

    const editor2 = page2.locator('.ProseMirror')
    await expect(editor2).toBeVisible({ timeout: 5000 })

    // Wait for sync to second user
    await page2.waitForTimeout(1500)

    // User 2 should see User 1's content
    await expect(editor2).toContainText('User 1 writes this')

    // Both users type simultaneously
    await editor1.click()
    await page.keyboard.type('More from user 1.')

    await editor2.click()
    await page2.keyboard.type('User 2 adds this.')

    // Wait for Yjs to sync
    await page.waitForTimeout(2000)
    await page2.waitForTimeout(2000)

    // Both users should see all content (order may vary due to CRDT)
    const content1 = await editor1.textContent()
    const content2 = await editor2.textContent()

    expect(content1).toContain('User 1 writes this')
    expect(content1).toContain('More from user 1')
    expect(content1).toContain('User 2 adds this')

    expect(content2).toContain('User 1 writes this')
    expect(content2).toContain('More from user 1')
    expect(content2).toContain('User 2 adds this')

    await page2.close()
  })

  test('concurrent edits in same location converge', async ({ page, browser }) => {
    await login(page)
    await createNewDocument(page)

    const docUrl = page.url()
    const editor1 = page.locator('.ProseMirror')

    // Set initial content
    await editor1.click()
    await page.keyboard.type('Initial text.')
    await page.waitForTimeout(1000)

    // Open second tab
    const page2 = await browser.newPage()
    await login(page2)
    await page2.goto(docUrl)

    const editor2 = page2.locator('.ProseMirror')
    await expect(editor2).toBeVisible({ timeout: 5000 })
    await page2.waitForTimeout(1500)

    // Both users position cursor at end
    await editor1.click()
    await page.keyboard.press('End')
    await editor2.click()
    await page2.keyboard.press('End')

    // Both type at the same position simultaneously
    await page.keyboard.type(' A')
    await page2.keyboard.type(' B')

    // Wait for sync
    await page.waitForTimeout(2500)
    await page2.waitForTimeout(2500)

    // Content should converge (both edits present)
    const content1 = await editor1.textContent()
    const content2 = await editor2.textContent()

    // Should be identical after sync
    expect(content1).toBe(content2)

    // Should contain both edits
    expect(content1).toContain('Initial text')
    expect(content1).toContain('A')
    expect(content1).toContain('B')

    await page2.close()
  })

  test('delete during collaboration is handled', async ({ page, browser }) => {
    await login(page)
    await createNewDocument(page)

    const docUrl = page.url()
    const editor1 = page.locator('.ProseMirror')

    // Add content
    await editor1.click()
    await page.keyboard.type('This is important content that someone might delete.')
    await page.waitForTimeout(1000)

    // Open second tab
    const page2 = await browser.newPage()
    await login(page2)
    await page2.goto(docUrl)

    const editor2 = page2.locator('.ProseMirror')
    await expect(editor2).toBeVisible({ timeout: 5000 })
    await page2.waitForTimeout(1500)

    // User 2 starts typing
    await editor2.click()
    await page2.keyboard.press('End')
    await page2.keyboard.type(' Additional content.')

    // User 1 selects all and deletes
    await editor1.click()
    await page.keyboard.press('Control+A')
    await page.keyboard.press('Backspace')

    // Wait for sync
    await page.waitForTimeout(2500)
    await page2.waitForTimeout(2500)

    // Content should eventually converge
    const content1 = await editor1.textContent()
    const content2 = await editor2.textContent()

    // Should be identical after sync
    expect(content1?.trim()).toBe(content2?.trim())

    await page2.close()
  })

  test('multiple tabs editing same document stay in sync', async ({ page, browser }) => {
    await login(page)
    await createNewDocument(page)

    const docUrl = page.url()

    // Open two more tabs with same document
    const page2 = await browser.newPage()
    await login(page2)
    await page2.goto(docUrl)

    const page3 = await browser.newPage()
    await login(page3)
    await page3.goto(docUrl)

    // Wait for all editors to load
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await expect(page2.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await expect(page3.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    await page.waitForTimeout(1500)
    await page2.waitForTimeout(1500)
    await page3.waitForTimeout(1500)

    // Each tab types different content
    await page.locator('.ProseMirror').click()
    await page.keyboard.type('Tab 1 content. ')

    await page2.locator('.ProseMirror').click()
    await page2.keyboard.press('End')
    await page2.keyboard.type('Tab 2 content. ')

    await page3.locator('.ProseMirror').click()
    await page3.keyboard.press('End')
    await page3.keyboard.type('Tab 3 content.')

    // Wait for sync
    await page.waitForTimeout(3000)
    await page2.waitForTimeout(3000)
    await page3.waitForTimeout(3000)

    // All tabs should have all content
    const content1 = await page.locator('.ProseMirror').textContent()
    const content2 = await page2.locator('.ProseMirror').textContent()
    const content3 = await page3.locator('.ProseMirror').textContent()

    expect(content1).toContain('Tab 1 content')
    expect(content1).toContain('Tab 2 content')
    expect(content1).toContain('Tab 3 content')

    expect(content2).toContain('Tab 1 content')
    expect(content2).toContain('Tab 2 content')
    expect(content2).toContain('Tab 3 content')

    expect(content3).toContain('Tab 1 content')
    expect(content3).toContain('Tab 2 content')
    expect(content3).toContain('Tab 3 content')

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

    // Get initial document count
    const initialCount = await page.locator('button[class*="rounded"]').count()

    // Rapidly create documents
    const newDocButton = page.locator('button[title="New document"]')

    for (let i = 0; i < 3; i++) {
      await newDocButton.click()
      await page.waitForURL(/\/docs\/[a-f0-9-]+/, { timeout: 5000 })
      await page.goBack()
      await page.waitForTimeout(500)
    }

    // Wait for list to update
    await page.waitForTimeout(1000)

    // Count should increase by exactly 3
    const finalCount = await page.locator('button[class*="rounded"]').count()
    expect(finalCount).toBe(initialCount + 3)
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

    // Trigger image upload
    await page.keyboard.type('/image')
    await page.waitForTimeout(500)

    const tmpPath = createTestImageFile()
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.keyboard.press('Enter')

    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(tmpPath)

    // Continue typing immediately
    await page.keyboard.type(' After image')

    await page.waitForTimeout(1000)

    // Both text and image should be present
    await expect(editor).toContainText('Before image')
    await expect(editor).toContainText('After image')
    await expect(editor.locator('img')).toBeVisible()

    fs.unlinkSync(tmpPath)
  })

  test('multiple image uploads in parallel', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Upload three images rapidly
    const tmpPaths: string[] = []

    for (let i = 0; i < 3; i++) {
      await page.keyboard.type('/image')
      await page.waitForTimeout(300)

      const tmpPath = createTestImageFile()
      tmpPaths.push(tmpPath)

      const fileChooserPromise = page.waitForEvent('filechooser')
      await page.keyboard.press('Enter')

      const fileChooser = await fileChooserPromise
      await fileChooser.setFiles(tmpPath)

      await page.waitForTimeout(500)
    }

    // Wait for all uploads to complete
    await page.waitForTimeout(5000)

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
