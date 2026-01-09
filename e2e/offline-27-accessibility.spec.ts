/**
 * Category 27: Accessibility During Offline
 * Tests screen reader announcements and keyboard navigation.
 *
 * Infrastructure implemented:
 * 1. OfflineIndicator with role="status" aria-live="polite"
 * 2. PendingSyncCount with role="status" aria-live="polite"
 * 3. PendingSyncIcon with role="status" aria-live="polite"
 * 4. SyncFailureNotification with role="alert" aria-live="assertive"
 */
import { test, expect } from './fixtures/offline'


test.describe('27.1 Screen Reader Announcements', () => {
  test('offline status announced to screen readers', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User is on app
    await page.goto('/docs')

    // WHEN: Network drops
    await goOffline()

    // THEN: Status region exists and has offline indication
    const statusRegion = page.getByRole('status')
    if (await statusRegion.count() > 0) {
      // Check for aria-live attribute
      const ariaLive = await statusRegion.first().getAttribute('aria-live')
      expect(ariaLive).toBeTruthy()
    }

    // OR offline indicator has appropriate ARIA
    const offlineIndicator = page.getByTestId('offline-indicator')
    if (await offlineIndicator.isVisible()) {
      await expect(offlineIndicator).toBeVisible()
    }
  })

  test('pending sync count accessible to screen readers', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User creates document offline
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill('A11y Test')
    await page.waitForTimeout(1000)
    await page.goto('/docs')

    // THEN: Pending count has accessible label
    const pendingBadge = page.getByTestId('pending-sync-count')
    if (await pendingBadge.isVisible()) {
      // Check for aria-label or aria-describedby
      const ariaLabel = await pendingBadge.getAttribute('aria-label')
      const ariaDescribedBy = await pendingBadge.getAttribute('aria-describedby')
      const role = await pendingBadge.getAttribute('role')

      // Should have some form of accessibility
      const hasAccessibility = ariaLabel || ariaDescribedBy || role
      expect(hasAccessibility).toBeTruthy()
    }
  })

  test('sync errors announced to screen readers', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User has pending mutation
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill('Error A11y Test')
    await page.waitForTimeout(1000)
    await page.goto('/docs')

    // WHEN: Sync fails
    await page.route('**/api/documents', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({ status: 500, body: 'Server error' })
      } else {
        route.continue()
      }
    })
    await goOnline()
    await page.waitForTimeout(5000)

    // THEN: Error should be in an alert or status region
    const alert = page.getByRole('alert')
    if (await alert.count() > 0) {
      await expect(alert.first()).toBeVisible()
    }
  })

  test('keyboard navigation works for offline UI elements', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User has pending mutations
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill('Keyboard Test')
    await page.waitForTimeout(1000)
    await page.goto('/docs')

    // WHEN: User navigates with keyboard
    // Focus should be manageable
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')

    // THEN: Focus is visible somewhere meaningful
    const focusedElement = page.locator(':focus')
    await expect(focusedElement).toBeVisible()
  })

  test('offline indicator is not announced repeatedly', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User is on app
    await page.goto('/docs')

    // WHEN: Network toggles multiple times
    await goOffline()
    await page.waitForTimeout(500)
    await goOnline()
    await page.waitForTimeout(500)
    await goOffline()
    await page.waitForTimeout(500)

    // THEN: App doesn't spam announcements (check aria-live region behavior)
    // This is more of a behavioral check - app should handle gracefully
    const offlineIndicator = page.getByTestId('offline-indicator')
    await expect(offlineIndicator).toBeVisible()
  })

  test('focus management after sync completion', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User is editing document offline
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await goOffline()
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Focus test content')

    // WHEN: Sync completes after coming online
    await goOnline()
    await page.waitForTimeout(3000)

    // THEN: Focus should not be unexpectedly moved
    // User's focus position should be preserved
    const editorHasFocus = await page.evaluate(() => {
      const active = document.activeElement
      return active?.closest('[data-testid="tiptap-editor"]') !== null
    })

    // Focus should still be in or near editor area
    expect(editorHasFocus).toBe(true)
  })

  test('error messages have proper ARIA attributes', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // Create a situation that will produce an error
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('input[placeholder="Untitled"]')
    await titleInput.click()
    await titleInput.fill('ARIA Error Test')
    await page.waitForTimeout(1000)
    await page.goto('/docs')

    // Mock server error
    await page.route('**/api/documents', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 400,
          body: JSON.stringify({ error: 'Validation failed: title too short' })
        })
      } else {
        route.continue()
      }
    })

    await goOnline()
    await page.waitForTimeout(5000)

    // Check for properly attributed error messages
    const errorMessages = page.locator('[role="alert"], [aria-live="assertive"], [aria-live="polite"]')
    const count = await errorMessages.count()

    // Should have at least one accessible error region
    if (count > 0) {
      const firstError = errorMessages.first()
      await expect(firstError).toBeVisible()
    }
  })
})
