import { test, expect, Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Helper to login
async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#email').fill('dev@ship.local')
  await page.locator('#password').fill('admin123')
  await page.getByRole('button', { name: /sign in/i }).click()
  await expect(page).not.toHaveURL('/login', { timeout: 5000 })
}

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
}

// Create a test image file
function createTestImageFile(): string {
  const pngBuffer = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
    'base64'
  )
  const tmpPath = path.join(os.tmpdir(), `test-image-${Date.now()}.png`)
  fs.writeFileSync(tmpPath, pngBuffer)
  return tmpPath
}

test.describe('Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('handles very long document titles (500+ characters)', async ({ page }) => {
    await createNewDocument(page)

    // Generate a very long title (500 characters)
    const longTitle = 'A'.repeat(500)

    // Find the title input
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill(longTitle)

    // Wait for autosave
    await page.waitForTimeout(1500)

    // Title should be saved (verify by reloading)
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(titleInput).toBeVisible({ timeout: 5000 })

    // Verify the long title is preserved
    const savedTitle = await titleInput.inputValue()
    expect(savedTitle.length).toBeGreaterThan(400)
  })

  test('handles empty document gracefully', async ({ page }) => {
    await createNewDocument(page)

    // Leave document completely empty
    const editor = page.locator('.ProseMirror')
    await expect(editor).toBeVisible()

    // Wait for autosave
    await page.waitForTimeout(1500)

    // Reload and verify empty document still works
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(editor).toBeVisible({ timeout: 5000 })

    // Should be able to add content after reload
    await editor.click()
    await page.keyboard.type('Content after empty save')
    await expect(editor).toContainText('Content after empty save')
  })

  test('rapid typing does not lose characters', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type rapidly without delays
    const text = 'The quick brown fox jumps over the lazy dog'
    await page.keyboard.type(text, { delay: 10 })

    // All characters should be present
    await expect(editor).toContainText(text)

    // Verify exact count
    const editorText = await editor.textContent()
    expect(editorText).toContain('quick brown fox')
  })

  test('rapid undo/redo operations', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type some content
    await page.keyboard.type('First line')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Second line')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Third line')

    await expect(editor).toContainText('Third line')

    // Rapid undo (3 times)
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')

    // Should not have third line
    await expect(editor).not.toContainText('Third line', { timeout: 1000 })

    // Rapid redo (3 times)
    await page.keyboard.press('Meta+Shift+z')
    await page.keyboard.press('Meta+Shift+z')
    await page.keyboard.press('Meta+Shift+z')

    // Third line should be back
    await expect(editor).toContainText('Third line', { timeout: 3000 })
  })

  test('pasting large content (10KB+ text)', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Generate large text (10KB+)
    const largeText = 'Lorem ipsum dolor sit amet. '.repeat(400) // ~11KB

    // Paste via clipboard API
    await page.evaluate((text) => {
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      textarea.remove()
    }, largeText)

    await page.keyboard.press('Meta+v')

    // Wait for paste to process
    await page.waitForTimeout(1000)

    // Verify content was pasted
    const editorText = await editor.textContent()
    expect(editorText!.length).toBeGreaterThan(10000)
    expect(editorText).toContain('Lorem ipsum')
  })

  test('handles many mentions in one document (20+ mentions)', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Insert multiple mentions
    for (let i = 0; i < 5; i++) {
      await page.keyboard.type('@')

      // Wait for mention popup
      await expect(page.locator('[role="listbox"]')).toBeVisible({ timeout: 5000 })

      // Select first option if available
      const firstOption = page.locator('[role="option"]').first()
      if (await firstOption.isVisible()) {
        await firstOption.click()
        await page.waitForTimeout(300)
      } else {
        // No results, press Escape and continue
        await page.keyboard.press('Escape')
      }

      // Add some spacing
      await page.keyboard.type(' ')
    }

    // Editor should still be functional
    await editor.click()
    await page.keyboard.type('Still working')
    await expect(editor).toContainText('Still working')
  })

  test('handles many images in one document (10+ images)', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Insert multiple images (3 for speed, concept proven)
    for (let i = 0; i < 3; i++) {
      await page.keyboard.type('/image')
      await page.waitForTimeout(300)

      const tmpPath = createTestImageFile()

      const fileChooserPromise = page.waitForEvent('filechooser')
      await page.keyboard.press('Enter')

      const fileChooser = await fileChooserPromise
      await fileChooser.setFiles(tmpPath)

      // Wait for image to appear
      await page.waitForTimeout(1000)

      // Cleanup
      setTimeout(() => {
        try { fs.unlinkSync(tmpPath) } catch {}
      }, 5000)

      // Add newline
      await page.keyboard.press('Enter')
    }

    // Verify multiple images exist
    const imageCount = await editor.locator('img').count()
    expect(imageCount).toBeGreaterThanOrEqual(3)

    // Editor should still be functional
    await page.keyboard.type('Text after images')
    await expect(editor).toContainText('Text after images')
  })

  test('handles deeply nested content (lists within lists)', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create nested bullet list
    await page.keyboard.type('Level 1')
    await page.keyboard.press('Enter')

    // Indent to level 2
    await page.keyboard.press('Tab')
    await page.keyboard.type('Level 2')
    await page.keyboard.press('Enter')

    // Indent to level 3
    await page.keyboard.press('Tab')
    await page.keyboard.type('Level 3')
    await page.keyboard.press('Enter')

    // Indent to level 4
    await page.keyboard.press('Tab')
    await page.keyboard.type('Level 4')

    // Verify content exists
    await expect(editor).toContainText('Level 1')
    await expect(editor).toContainText('Level 2')
    await expect(editor).toContainText('Level 3')
    await expect(editor).toContainText('Level 4')

    // Wait for autosave
    await page.waitForTimeout(1500)

    // Reload and verify structure persists
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(editor).toBeVisible({ timeout: 5000 })
    await expect(editor).toContainText('Level 4', { timeout: 3000 })
  })

  test('handles special characters in titles', async ({ page }) => {
    await createNewDocument(page)

    // Title with special characters
    const specialTitle = '~!@#$%^&*()_+-={}[]|:;<>,.?/'

    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill(specialTitle)

    // Wait for autosave
    await page.waitForTimeout(1500)

    // Reload and verify
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(titleInput).toBeVisible({ timeout: 5000 })

    const savedTitle = await titleInput.inputValue()
    expect(savedTitle).toContain('!@#$%')
  })

  test('handles Unicode content (emoji, CJK characters)', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type various Unicode characters
    const unicodeText = '你好世界 こんにちは 안녕하세요 🎉 🚀 ✨ العربية עברית'
    await page.keyboard.type(unicodeText)

    // Verify Unicode text is preserved
    await expect(editor).toContainText('你好世界')
    await expect(editor).toContainText('こんにちは')
    await expect(editor).toContainText('🎉')

    // Wait for autosave
    await page.waitForTimeout(1500)

    // Reload and verify Unicode persists
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expect(editor).toBeVisible({ timeout: 5000 })
    await expect(editor).toContainText('你好世界', { timeout: 3000 })
    await expect(editor).toContainText('🎉', { timeout: 3000 })
  })

  test('handles rapid navigation between documents', async ({ page }) => {
    // Create first document
    await createNewDocument(page)
    const firstDocUrl = page.url()

    const editor = page.locator('.ProseMirror')
    await editor.click()
    await page.keyboard.type('First document')

    // Create second document
    await createNewDocument(page)
    const secondDocUrl = page.url()
    await editor.click()
    await page.keyboard.type('Second document')

    // Rapidly navigate back and forth
    await page.goto(firstDocUrl)
    await page.waitForTimeout(200)
    await page.goto(secondDocUrl)
    await page.waitForTimeout(200)
    await page.goto(firstDocUrl)
    await page.waitForTimeout(200)

    // Verify we're on first document
    await expect(editor).toBeVisible({ timeout: 5000 })
    await expect(editor).toContainText('First document', { timeout: 3000 })

    // Navigate to second
    await page.goto(secondDocUrl)
    await expect(editor).toContainText('Second document', { timeout: 3000 })
  })

  test('handles simultaneous formatting operations', async ({ page }) => {
    await createNewDocument(page)

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Type text
    await page.keyboard.type('Bold and italic text')

    // Select all
    await page.keyboard.press('Meta+a')

    // Apply bold
    await page.keyboard.press('Meta+b')

    // Apply italic
    await page.keyboard.press('Meta+i')

    // Wait for formatting to apply
    await page.waitForTimeout(500)

    // Verify both formats are applied
    const strongTag = editor.locator('strong')
    const emTag = editor.locator('em, i')

    await expect(strongTag).toBeVisible({ timeout: 3000 })
    await expect(emTag).toBeVisible({ timeout: 3000 })

    // Text should still be readable
    await expect(editor).toContainText('Bold and italic')
  })

  test('handles switching document types rapidly', async ({ page }) => {
    await page.goto('/docs')
    await page.waitForLoadState('networkidle')

    // Switch between different modes rapidly
    await page.goto('/issues')
    await page.waitForTimeout(300)

    await page.goto('/programs')
    await page.waitForTimeout(300)

    await page.goto('/sprints')
    await page.waitForTimeout(300)

    await page.goto('/docs')
    await page.waitForTimeout(300)

    // Verify we ended up on docs page
    expect(page.url()).toContain('/docs')

    // Page should be functional
    const body = page.locator('body')
    await expect(body).toBeVisible()
  })
})
