import { test, expect, Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

/**
 * Data Integrity Tests
 *
 * Tests that verify data is correctly saved, persisted, and retrieved:
 * - Complete document saves
 * - Image persistence
 * - Mention preservation
 * - Undo/redo accuracy
 * - Copy/paste structure
 * - Database consistency
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

// Create test image
function createTestImageFile(): string {
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64'
  )
  const tmpPath = path.join(os.tmpdir(), `test-image-${Date.now()}.png`)
  fs.writeFileSync(tmpPath, pngBuffer)
  return tmpPath
}

test.describe('Data Integrity - Document Persistence', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('document saves completely with all formatting', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    const titleInput = page.locator('input[placeholder="Untitled"]')

    // Set title
    await titleInput.click()
    await titleInput.fill('Complete Document Test')

    // Add various formatted content
    await editor.click()

    // Paragraph
    await page.keyboard.type('Regular paragraph text. ')

    // Bold text
    await page.keyboard.press('Control+b')
    await page.keyboard.type('Bold text. ')
    await page.keyboard.press('Control+b')

    // Italic text
    await page.keyboard.press('Control+i')
    await page.keyboard.type('Italic text. ')
    await page.keyboard.press('Control+i')

    // Heading
    await page.keyboard.press('Enter')
    await page.keyboard.type('## Heading 2')
    await page.keyboard.press('Enter')

    // List
    await page.keyboard.type('- List item 1')
    await page.keyboard.press('Enter')
    await page.keyboard.type('List item 2')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    // Code block
    await page.keyboard.type('```javascript')
    await page.keyboard.press('Enter')
    await page.keyboard.type('const test = "code";')
    await page.keyboard.press('Escape')

    // Wait for save
    await page.waitForTimeout(2000)

    // Get document URL
    const docUrl = page.url()

    // Hard reload
    await page.goto(docUrl)
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // Verify all content is preserved
    await expect(titleInput).toHaveValue('Complete Document Test')
    await expect(editor).toContainText('Regular paragraph text')
    await expect(editor).toContainText('Bold text')
    await expect(editor).toContainText('Italic text')
    await expect(editor).toContainText('Heading 2')
    await expect(editor).toContainText('List item 1')
    await expect(editor).toContainText('List item 2')
    await expect(editor).toContainText('const test = "code"')

    // Verify formatting is preserved
    await expect(editor.locator('strong')).toContainText('Bold text')
    await expect(editor.locator('em')).toContainText('Italic text')
    await expect(editor.locator('h2')).toContainText('Heading 2')
    await expect(editor.locator('ul li').first()).toContainText('List item 1')
    await expect(editor.locator('pre code')).toContainText('const test = "code"')
  })

  test('document with complex nested structure persists', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create nested list
    await page.keyboard.type('- Parent item 1')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Nested item 1.1')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Nested item 1.2')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Double nested 1.2.1')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.type('Parent item 2')

    await page.waitForTimeout(2000)

    // Reload
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // Verify nested structure
    await expect(editor).toContainText('Parent item 1')
    await expect(editor).toContainText('Nested item 1.1')
    await expect(editor).toContainText('Nested item 1.2')
    await expect(editor).toContainText('Double nested 1.2.1')
    await expect(editor).toContainText('Parent item 2')
  })

  test('empty document saves correctly', async ({ page }) => {
    await createNewDocument(page)

    const titleInput = page.locator('input[placeholder="Untitled"]')

    // Just set title, leave content empty
    await titleInput.click()
    await titleInput.fill('Empty Document')
    await titleInput.blur()

    await page.waitForTimeout(2000)

    // Reload
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // Title should be saved
    await expect(titleInput).toHaveValue('Empty Document')

    // Editor should be empty
    const editorText = await page.locator('.ProseMirror').textContent()
    expect(editorText?.trim()).toBe('')
  })

  test('document with special characters saves correctly', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    const titleInput = page.locator('input[placeholder="Untitled"]')

    // Title with special characters
    await titleInput.click()
    await titleInput.fill('Doc with "quotes" & <brackets> 中文')

    // Content with special characters
    await editor.click()
    await page.keyboard.type('Special chars: © ® ™ € £ ¥ § ¶ † ‡ • …')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Unicode: 你好世界 مرحبا العالم Здравствуй мир')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Emoji: 🚀 🎉 💻 ✨')

    await page.waitForTimeout(2000)

    // Reload
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // Verify special characters preserved
    await expect(titleInput).toHaveValue('Doc with "quotes" & <brackets> 中文')
    await expect(editor).toContainText('Special chars: © ® ™ € £ ¥')
    await expect(editor).toContainText('Unicode: 你好世界 مرحبا العالم')
    await expect(editor).toContainText('Emoji: 🚀 🎉 💻 ✨')
  })
})

test.describe('Data Integrity - Images', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('images persist after page reload', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Upload image
    await page.keyboard.type('/image')
    await page.waitForTimeout(500)

    const tmpPath = createTestImageFile()
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.keyboard.press('Enter')

    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(tmpPath)

    // Wait for upload
    await expect(editor.locator('img')).toBeVisible({ timeout: 5000 })
    await page.waitForFunction(
      () => {
        const img = document.querySelector('.ProseMirror img')
        if (!img) return false
        const src = img.getAttribute('src') || ''
        return src.startsWith('http') || src.includes('/api/files')
      },
      { timeout: 15000 }
    )

    // Get image src
    const img = editor.locator('img').first()
    const originalSrc = await img.getAttribute('src')

    await page.waitForTimeout(2000)

    // Reload page
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // Image should still be there
    await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 5000 })

    // Src should be the same
    const reloadedImg = page.locator('.ProseMirror img').first()
    const reloadedSrc = await reloadedImg.getAttribute('src')
    expect(reloadedSrc).toBe(originalSrc)

    fs.unlinkSync(tmpPath)
  })

  test('images persist after server restart simulation', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Upload image
    await page.keyboard.type('/image')
    await page.waitForTimeout(500)

    const tmpPath = createTestImageFile()
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.keyboard.press('Enter')

    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(tmpPath)

    await expect(editor.locator('img')).toBeVisible({ timeout: 5000 })
    await page.waitForFunction(
      () => {
        const img = document.querySelector('.ProseMirror img')
        if (!img) return false
        const src = img.getAttribute('src') || ''
        return src.startsWith('http') || src.includes('/api/files')
      },
      { timeout: 15000 }
    )

    const originalSrc = await editor.locator('img').first().getAttribute('src')

    // Wait for sync
    await page.waitForTimeout(3000)

    // Simulate server restart by clearing all caches and reloading
    await page.context().clearCookies()
    await login(page)

    // Navigate back to document
    await page.goto(page.url())
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // Image should still be accessible
    await expect(page.locator('.ProseMirror img')).toBeVisible({ timeout: 5000 })
    const newSrc = await page.locator('.ProseMirror img').first().getAttribute('src')
    expect(newSrc).toBe(originalSrc)

    fs.unlinkSync(tmpPath)
  })

  test('multiple images persist in correct order', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Upload first image
    await page.keyboard.type('Image 1:')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/image')
    await page.waitForTimeout(500)

    const tmpPath1 = createTestImageFile()
    let fileChooserPromise = page.waitForEvent('filechooser')
    await page.keyboard.press('Enter')
    let fileChooser = await fileChooserPromise
    await fileChooser.setFiles(tmpPath1)

    await page.waitForTimeout(2000)

    // Upload second image
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Image 2:')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/image')
    await page.waitForTimeout(500)

    const tmpPath2 = createTestImageFile()
    fileChooserPromise = page.waitForEvent('filechooser')
    await page.keyboard.press('Enter')
    fileChooser = await fileChooserPromise
    await fileChooser.setFiles(tmpPath2)

    await page.waitForTimeout(3000)

    // Get image sources
    const imgs = await editor.locator('img').all()
    expect(imgs.length).toBe(2)

    const src1 = await imgs[0].getAttribute('src')
    const src2 = await imgs[1].getAttribute('src')

    // Reload
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // Verify order preserved
    const reloadedImgs = await page.locator('.ProseMirror img').all()
    expect(reloadedImgs.length).toBe(2)

    const reloadedSrc1 = await reloadedImgs[0].getAttribute('src')
    const reloadedSrc2 = await reloadedImgs[1].getAttribute('src')

    expect(reloadedSrc1).toBe(src1)
    expect(reloadedSrc2).toBe(src2)

    fs.unlinkSync(tmpPath1)
    fs.unlinkSync(tmpPath2)
  })
})

test.describe('Data Integrity - Mentions', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('mentions survive document reload', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Insert mention
    await page.keyboard.type('Mentioned person: ')
    await page.keyboard.type('@')

    await expect(page.locator('[role="listbox"]')).toBeVisible({ timeout: 5000 })

    // Select first result
    const firstOption = page.locator('[role="option"]').first()
    if (await firstOption.isVisible()) {
      const mentionText = await firstOption.textContent()
      await firstOption.click()

      // Wait for mention to be inserted
      await expect(editor.locator('.mention')).toBeVisible({ timeout: 3000 })

      await page.waitForTimeout(2000)

      // Reload
      await page.reload()
      await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

      // Mention should still be there
      await expect(page.locator('.ProseMirror .mention')).toBeVisible({ timeout: 5000 })
      await expect(editor).toContainText('Mentioned person:')
    }
  })

  test('multiple mentions persist correctly', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Insert first mention
    await page.keyboard.type('First: ')
    await page.keyboard.type('@')
    await expect(page.locator('[role="listbox"]')).toBeVisible({ timeout: 5000 })

    let options = await page.locator('[role="option"]').all()
    if (options.length > 0) {
      await options[0].click()
      await page.waitForTimeout(500)
    }

    // Insert second mention
    await page.keyboard.type(' Second: ')
    await page.keyboard.type('@')
    await expect(page.locator('[role="listbox"]')).toBeVisible({ timeout: 5000 })

    options = await page.locator('[role="option"]').all()
    if (options.length > 1) {
      await options[1].click()
      await page.waitForTimeout(500)
    } else if (options.length > 0) {
      await options[0].click()
      await page.waitForTimeout(500)
    }

    // Wait for save
    await page.waitForTimeout(2000)

    const mentionCount = await editor.locator('.mention').count()

    // Reload
    await page.reload()
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    // Same number of mentions should exist
    const reloadedMentionCount = await page.locator('.ProseMirror .mention').count()
    expect(reloadedMentionCount).toBe(mentionCount)
  })
})

test.describe('Data Integrity - Undo/Redo', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('undo/redo preserves formatting', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type formatted text
    await page.keyboard.type('Regular text ')
    await page.keyboard.press('Control+b')
    await page.keyboard.type('bold text ')
    await page.keyboard.press('Control+b')
    await page.keyboard.type('more regular')

    // Verify content
    await expect(editor).toContainText('Regular text bold text more regular')
    await expect(editor.locator('strong')).toContainText('bold text')

    // Undo last part
    await page.keyboard.press('Control+z')
    await expect(editor).not.toContainText('more regular')

    // Redo
    await page.keyboard.press('Control+Shift+z')
    await expect(editor).toContainText('more regular')

    // Bold should still be present
    await expect(editor.locator('strong')).toContainText('bold text')
  })

  test('undo/redo works across multiple operations', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Do multiple operations
    await page.keyboard.type('Line 1')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Line 2')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Line 3')

    // Undo three times
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')

    // Should be back to "Line 1"
    const content = await editor.textContent()
    expect(content).toContain('Line 1')
    expect(content).not.toContain('Line 3')

    // Redo twice
    await page.keyboard.press('Control+Shift+z')
    await page.keyboard.press('Control+Shift+z')

    // Should have Lines 1 and 2
    await expect(editor).toContainText('Line 1')
    await expect(editor).toContainText('Line 2')
  })
})

test.describe('Data Integrity - Copy/Paste', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('copy/paste preserves structure', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create structured content
    await page.keyboard.type('# Heading')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- List item 1')
    await page.keyboard.press('Enter')
    await page.keyboard.type('List item 2')

    // Select all
    await page.keyboard.press('Control+a')

    // Copy
    await page.keyboard.press('Control+c')

    // Move to end and paste
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Control+v')

    await page.waitForTimeout(500)

    // Should have duplicate structure
    const headings = await editor.locator('h1').count()
    expect(headings).toBe(2)

    const listItems = await editor.locator('li').count()
    expect(listItems).toBe(4)
  })

  test('paste from external source preserves basic formatting', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Simulate pasting HTML content
    await page.evaluate(() => {
      const html = '<p><strong>Bold</strong> and <em>italic</em> text</p><ul><li>Item 1</li><li>Item 2</li></ul>'
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/html', html)
      const pasteEvent = new ClipboardEvent('paste', { clipboardData })
      document.querySelector('.ProseMirror')?.dispatchEvent(pasteEvent)
    })

    await page.waitForTimeout(500)

    // Verify formatting preserved
    await expect(editor).toContainText('Bold and italic text')
    await expect(editor.locator('strong')).toContainText('Bold')
    await expect(editor.locator('em')).toContainText('italic')
    await expect(editor.locator('li')).toContainText('Item 1')
  })
})
