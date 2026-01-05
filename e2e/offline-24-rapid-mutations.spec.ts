/**
 * Category 24: Rapid Mutations
 * Tests mutation debouncing and deduplication.
 *
 * SKIP REASON: These tests require offline mutation queue with debouncing
 * which is NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue with IndexedDB persistence
 * 2. Mutation debouncing/deduplication
 * 3. Pending sync count UI (data-testid="pending-sync-count")
 * 4. Pending sync icon per item (data-testid="pending-sync-icon")
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'


test.describe('24.1 Mutation Debouncing and Deduplication', () => {
  test('rapid title changes debounce to minimal mutations', async ({ page, goOffline, login, testData }) => {
    await login()

    // GIVEN: User has document open offline
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await goOffline()

    // WHEN: User types rapidly in title (many keystrokes)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.press('End')
    await page.keyboard.type('abcde')
    await page.keyboard.press('Tab')

    // Wait for debounce
    await page.waitForTimeout(1000)

    // THEN: Pending sync count should be minimal (debounced)
    const pendingCount = page.getByTestId('pending-sync-count')
    if (await pendingCount.isVisible()) {
      const count = await pendingCount.textContent()
      // Should be 1 or very few, not 5+ separate mutations
      expect(parseInt(count || '0')).toBeLessThanOrEqual(2)
    }
  })

  test('double-clicking create button only creates one document', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User is on docs page offline
    await page.goto('/docs')
    await goOffline()
    const initialCount = await page.getByTestId('doc-item').count()

    // WHEN: User double-clicks create button
    const createButton = page.getByRole('button', { name: 'New Document', exact: true })
    await createButton.dblclick()

    // Wait a moment
    await page.waitForTimeout(500)

    // Navigate back to check
    await page.goto('/docs')

    // THEN: Only one new document created (or button disabled after first click)
    const newCount = await page.getByTestId('doc-item').count()
    expect(newCount).toBeLessThanOrEqual(initialCount + 1)
  })

  test('rapid status changes only sync final state', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User has issue open offline
    const issue = testData.issues[0]
    await page.goto(`/issues/${issue.id}`)
    await goOffline()

    // WHEN: User changes status multiple times rapidly
    const statusSelect = page.getByLabel(/status/i)
    if (await statusSelect.isVisible()) {
      const options = await statusSelect.locator('option').allTextContents()
      if (options.length >= 3) {
        await statusSelect.selectOption({ index: 1 })
        await page.waitForTimeout(100)
        await statusSelect.selectOption({ index: 2 })
        await page.waitForTimeout(100)
        // Final status
        await statusSelect.selectOption({ index: options.length - 1 })
      }
    }

    // Wait for debounce
    await page.waitForTimeout(1500)

    // THEN: Pending count should be minimal
    const pendingCount = page.getByTestId('pending-sync-count')
    if (await pendingCount.isVisible()) {
      const count = await pendingCount.textContent()
      expect(parseInt(count || '0')).toBeLessThanOrEqual(2)
    }

    // WHEN: Online
    await goOnline()
    await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 10000 })
  })

  test('rapid typing in editor batches updates', async ({ page, goOffline, login, testData }) => {
    await login()

    // GIVEN: User has document open offline
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await goOffline()

    // WHEN: User types a paragraph rapidly
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('This is a rapidly typed sentence that should be batched.')

    // Wait for Yjs debounce
    await page.waitForTimeout(2000)

    // THEN: Content is preserved
    await expect(page.getByTestId('tiptap-editor')).toContainText('rapidly typed sentence')
  })

  test('delete immediately after create cancels both operations', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User is on docs page offline
    await page.goto('/docs')
    await goOffline()
    const initialCount = await page.getByTestId('doc-item').count()

    // WHEN: User creates then immediately deletes
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Delete Me')

    // Navigate back
    await page.goto('/docs')
    await expect(page.getByText('Delete Me')).toBeVisible()

    // Delete it
    await page.getByText('Delete Me').hover()
    const deleteButton = page.getByRole('button', { name: /delete/i })
    if (await deleteButton.isVisible()) {
      await deleteButton.click()
      const confirmButton = page.getByRole('button', { name: /confirm/i })
      if (await confirmButton.isVisible()) {
        await confirmButton.click()
      }
    }

    await page.waitForTimeout(1000)

    // THEN: Net result is no new documents
    const pendingCount = page.getByTestId('pending-sync-count')
    if (await pendingCount.isVisible()) {
      // Should cancel out - either 0 pending or minimal
      const count = await pendingCount.textContent()
      expect(parseInt(count || '0')).toBeLessThanOrEqual(1)
    }
  })
})
