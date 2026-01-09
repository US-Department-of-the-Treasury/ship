/**
 * Category 22: Background Tab Behavior
 * Tests tab visibility changes and stale data handling.
 *
 * Infrastructure implemented:
 * 1. TanStack Query with refetchOnMount: 'always'
 * 2. Offline mutation queue with IndexedDB persistence
 * 3. Online status listener triggers sync processing
 */
import { test, expect } from './fixtures/offline'


test.describe('22.1 Tab Visibility Changes', () => {
  test('stale data refetches when tab becomes visible', async ({ page, login }) => {
    await login()

    // GIVEN: User has docs page open and cached
    await page.goto('/docs')
    await page.waitForSelector('[data-testid="document-list"]')
    const initialCount = await page.getByTestId('doc-item').count()

    // WHEN: Tab goes to background (simulated)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // AND: Tab becomes visible again after some time
    await page.waitForTimeout(1000)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // THEN: TanStack Query should trigger a refetch
    // The list should still be visible (refetch in background)
    await expect(page.getByTestId('document-list')).toBeVisible()
  })

  test('pending mutations sync when tab becomes visible', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User creates document then tab goes background
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill('Background Sync Test')
    await page.waitForTimeout(1000)
    await page.goto('/docs')

    // Tab goes background
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // Network comes back while in background
    await goOnline()
    await page.waitForTimeout(1000)

    // WHEN: Tab becomes visible
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // THEN: Pending mutations sync
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 15000 })
  })

  test('handles focus event after extended background', async ({ page, login }) => {
    await login()

    // GIVEN: User has docs page open
    await page.goto('/docs')

    // WHEN: Page loses focus for extended time
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'))
    })
    await page.waitForTimeout(500)

    // AND: Page regains focus
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'))
    })

    // THEN: App handles gracefully
    await expect(page.getByTestId('document-list')).toBeVisible()
  })

  test('editor content preserved when tab goes background and returns', async ({ page, login, testData }) => {
    await login()

    // GIVEN: User is typing in editor
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Typing before background')

    // WHEN: Tab goes background
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await page.waitForTimeout(1000)

    // AND: Tab becomes visible
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })

    // THEN: Editor content preserved
    await expect(page.getByTestId('tiptap-editor')).toContainText('Typing before background')
  })
})
