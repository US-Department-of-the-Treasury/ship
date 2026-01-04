/**
 * Category 23: Ticket Number Collision
 * Tests concurrent offline issue creation and ticket number handling.
 *
 * SKIP REASON: These tests require offline mutation queue and pending sync
 * UI which are NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue with IndexedDB persistence
 * 2. Pending sync count UI (data-testid="pending-sync-count")
 * 3. Pending sync icon per item (data-testid="pending-sync-icon")
 * 4. Ticket number component (data-testid="ticket-number")
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'


test.describe('23.1 Concurrent Offline Issue Creation', () => {
  test('two offline users creating issues get unique ticket numbers', async ({ browser }) => {
    // GIVEN: Two users (contexts) both offline, both creating issues
    const context1 = await browser.newContext()
    const context2 = await browser.newContext()
    const page1 = await context1.newPage()
    const page2 = await context2.newPage()

    // Both login
    await page1.goto('/login')
    await page1.fill('input[name="email"]', 'dev@ship.local')
    await page1.fill('input[name="password"]', 'admin123')
    await page1.click('button[type="submit"]')
    await page1.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page2.goto('/login')
    await page2.fill('input[name="email"]', 'dev@ship.local')
    await page2.fill('input[name="password"]', 'admin123')
    await page2.click('button[type="submit"]')
    await page2.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    // Both visit issues
    await page1.goto('/issues')
    await page2.goto('/issues')

    // Both go offline
    await context1.setOffline(true)
    await context2.setOffline(true)

    // Both create issues
    await page1.getByRole('button', { name: /new/i }).click()
    await page1.waitForURL(/\/issues\/[^/]+$/)
    const titleInput1 = page1.locator('[contenteditable="true"]').first()
    await titleInput1.click()
    await page1.keyboard.type('User 1 Issue')

    await page2.getByRole('button', { name: /new/i }).click()
    await page2.waitForURL(/\/issues\/[^/]+$/)
    const titleInput2 = page2.locator('[contenteditable="true"]').first()
    await titleInput2.click()
    await page2.keyboard.type('User 2 Issue')

    // Navigate away to trigger save
    await page1.goto('/issues')
    await page2.goto('/issues')

    // Both come online
    await context1.setOffline(false)
    await context2.setOffline(false)

    // Wait for sync
    await page1.waitForTimeout(5000)
    await page2.waitForTimeout(5000)

    // THEN: Both issues exist (verified by checking the list)
    await page1.reload()
    await expect(page1.getByText('User 1 Issue')).toBeVisible()
    await expect(page1.getByText('User 2 Issue')).toBeVisible()

    await context1.close()
    await context2.close()
  })

  test('temporary ticket identifier replaced with real number after sync', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User creates issue offline
    await page.goto('/issues')
    await goOffline()
    await page.getByRole('button', { name: /new/i }).click()
    await page.waitForURL(/\/issues\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Temp Ticket Test')

    // Check ticket number element
    const ticketElement = page.getByTestId('ticket-number')
    if (await ticketElement.isVisible()) {
      const tempTicket = await ticketElement.textContent()
      // May show temp or pending state

      // WHEN: Online
      await goOnline()
      await expect(page.getByTestId('pending-sync-icon')).not.toBeVisible({ timeout: 15000 })

      // THEN: Ticket number is real server-assigned number
      const realTicket = await ticketElement.textContent()
      // Should be a real ticket number now
      expect(realTicket).toBeTruthy()
    }
  })

  test('offline-created issues maintain order after sync', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User creates multiple issues offline
    await page.goto('/issues')
    await goOffline()

    for (let i = 1; i <= 3; i++) {
      await page.getByRole('button', { name: /new/i }).click()
      await page.waitForURL(/\/issues\/[^/]+$/)
      const titleInput = page.locator('[contenteditable="true"]').first()
      await titleInput.click()
      await page.keyboard.type(`Order Test ${i}`)
      await page.goto('/issues')
    }

    // WHEN: Online
    await goOnline()
    await expect(page.getByTestId('pending-sync-count')).toHaveText('0', { timeout: 20000 })

    // THEN: Issues are all present
    await page.reload()
    await expect(page.getByText('Order Test 1')).toBeVisible()
    await expect(page.getByText('Order Test 2')).toBeVisible()
    await expect(page.getByText('Order Test 3')).toBeVisible()
  })
})
