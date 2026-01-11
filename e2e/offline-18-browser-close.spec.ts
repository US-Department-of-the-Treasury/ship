/**
 * Category 18: Browser Close During Sync
 * Tests data persistence when browser closes during sync.
 *
 * Infrastructure implemented:
 * 1. IndexedDB-backed mutation queue (ship-mutation-queue)
 * 2. Pending sync count UI (data-testid="pending-sync-count")
 *
 * Note: Cross-session persistence test is skipped because Playwright
 * contexts don't share IndexedDB state. The partial sync test verifies
 * that mutations persist correctly within a session.
 */
import { test, expect } from './fixtures/offline'


test.describe('18.1 Incomplete Sync Recovery', () => {
  // Skip: Playwright contexts don't share IndexedDB state
  test.skip('pending mutations persist when browser closes during sync', async ({ browser }) => {
    // GIVEN: User has pending changes and sync starts
    const context1 = await browser.newContext()
    const page1 = await context1.newPage()

    // Login
    await page1.goto('/login')
    await page1.fill('input[name="email"]', 'dev@ship.local')
    await page1.fill('input[name="password"]', 'admin123')
    await page1.click('button[type="submit"]')
    await page1.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page1.goto('/docs')
    await context1.setOffline(true)
    await page1.getByRole('button', { name: 'New Document', exact: true }).click()
    await page1.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page1.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page1.keyboard.type('Browser Close Test')
    await page1.goto('/docs')

    // Slow down network to catch mid-sync
    await page1.route('**/api/documents', async (route) => {
      await new Promise(r => setTimeout(r, 5000)) // 5 second delay
      route.continue()
    })
    await context1.setOffline(false)

    // WHEN: Browser closes mid-sync (simulate by closing context)
    await context1.close()

    // AND: User reopens browser
    const context2 = await browser.newContext()
    const page2 = await context2.newPage()

    // Login again
    await page2.goto('/login')
    await page2.fill('input[name="email"]', 'dev@ship.local')
    await page2.fill('input[name="password"]', 'admin123')
    await page2.click('button[type="submit"]')
    await page2.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page2.goto('/docs')

    // THEN: Pending mutation is still there (persisted in IndexedDB)
    // Note: This depends on IndexedDB persistence
    await expect(page2.getByText('Browser Close Test')).toBeVisible()

    await context2.close()
  })

  test('pending mutations persist across page reload', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User creates documents offline
    await page.goto('/docs')
    await goOffline()

    // Create 2 documents offline
    for (let i = 1; i <= 2; i++) {
      await page.getByRole('button', { name: 'New Document', exact: true }).click()
      await page.waitForURL(/\/docs\/[^/]+$/)
      const titleInput = page.locator('input[placeholder="Untitled"]')
      await titleInput.click()
      await titleInput.fill(`Persist Test ${i}`)
      await page.waitForTimeout(1000) // Wait for throttled save
      await page.goto('/docs')
    }

    // Get initial pending count
    const pendingCount = page.getByTestId('pending-sync-count')
    await expect(pendingCount).toBeVisible()
    const initialCount = Number(await pendingCount.textContent())
    expect(initialCount).toBeGreaterThan(0)

    // WHEN: User reloads page while still offline
    await page.reload()

    // THEN: Mutations are preserved (count is same or similar)
    await expect(pendingCount).toBeVisible()
    const countAfterReload = Number(await pendingCount.textContent())
    // Should have same mutations still pending
    expect(countAfterReload).toBeGreaterThan(0)
    // Documents should still be visible
    await expect(page.getByRole('link', { name: 'Persist Test 1' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Persist Test 2' }).first()).toBeVisible()
  })
})
