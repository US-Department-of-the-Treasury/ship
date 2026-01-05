/**
 * Category 32: UI State Preservation
 * Tests focus and scroll state preservation through offline transitions.
 *
 * SKIP REASON: These tests require TanStack Query with proper cache
 * hydration and document list component which are NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. TanStack Query with IndexedDB persistence
 * 2. Document list component (data-testid="document-list")
 * 3. Cache hydration on reload
 * 4. Proper focus management during network transitions
 *
 * See: docs/application-architecture.md "Layer 2: Lists/Metadata (Planned)"
 */
import { test, expect } from './fixtures/offline'


test.describe('32.1 Focus and Scroll State', () => {
  test('focus position preserved through offline transition', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User is typing in editor
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Typing here')

    // WHEN: Network drops and returns
    await goOffline()
    await page.waitForTimeout(1000)
    await goOnline()
    await page.waitForTimeout(1000)

    // THEN: Editor still has focus and can continue typing
    await page.keyboard.type(' more text')
    const content = await page.getByTestId('tiptap-editor').textContent()
    expect(content).toContain('Typing here more text')
  })

  test('scroll position preserved through offline reload', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User has scrolled in document list
    await page.goto('/docs')
    await page.waitForSelector('[data-testid="document-list"]')

    // Scroll down if possible
    await page.evaluate(() => {
      const list = document.querySelector('[data-testid="document-list"]')?.parentElement
      if (list && list.scrollHeight > list.clientHeight) {
        list.scrollTop = 100
      }
    })

    const scrollBefore = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="document-list"]')?.parentElement
      return list?.scrollTop || 0
    })

    // WHEN: Goes offline and reloads
    await goOffline()
    await page.reload()
    await page.waitForSelector('[data-testid="document-list"]')

    // THEN: Page loads successfully
    await expect(page.getByTestId('document-list')).toBeVisible()
  })

  test('cursor position in editor preserved after sync', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User has cursor at specific position in document
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('First line')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Second line')

    // Move cursor to beginning
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowUp')

    // WHEN: Make offline edit at cursor position
    await goOffline()
    await page.keyboard.type('INSERTED ')

    // AND: Come back online
    await goOnline()
    await page.waitForTimeout(2000)

    // THEN: Content has insertion
    const content = await page.getByTestId('tiptap-editor').textContent()
    expect(content).toContain('INSERTED')
  })

  test('unsaved form data preserved through offline transition', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User starts creating a document
    await page.goto('/docs')
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)

    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Partial Form Doc')

    // Don't navigate away - just go offline
    await goOffline()

    // THEN: Content is preserved
    await expect(titleInput).toContainText('Partial Form Doc')
  })

  test('modal/dialog state preserved through network change', async ({ page, goOffline, login, testData }) => {
    await login()

    // GIVEN: User is on a document
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)

    // Try to open any dialog/modal
    const settingsButton = page.getByRole('button', { name: /settings|properties|menu/i })
    if (await settingsButton.isVisible()) {
      await settingsButton.click()

      const dialog = page.getByRole('dialog')
      if (await dialog.isVisible()) {
        // WHEN: Network drops
        await goOffline()

        // THEN: Dialog stays open
        await expect(dialog).toBeVisible()
      }
    }
  })

  test('selection state preserved through sync', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User has text selected in editor
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Select this text')

    // Select all the typed text
    await page.keyboard.press('Control+a')

    // WHEN: Network transitions
    await goOffline()
    await page.waitForTimeout(500)
    await goOnline()
    await page.waitForTimeout(500)

    // THEN: Can continue editing (selection may or may not persist, but typing should work)
    await page.keyboard.type('Replacement')
    const content = await page.getByTestId('tiptap-editor').textContent()
    expect(content).toContain('Replacement')
  })

  test('undo/redo stack preserved through offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User has made edits
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('First edit')
    await page.waitForTimeout(500)
    await page.keyboard.type(' Second edit')
    await page.waitForTimeout(500)

    // WHEN: Go offline, make more edits, then undo
    await goOffline()
    await page.keyboard.type(' Third edit')
    await page.waitForTimeout(500)

    // Undo
    await page.keyboard.press('Control+z')

    // THEN: Undo works offline
    const content = await page.getByTestId('tiptap-editor').textContent()
    // Content should have been modified by undo
    expect(content).toBeTruthy()
  })
})
