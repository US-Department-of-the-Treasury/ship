/**
 * Category 7: Session/Auth During Offline
 * Tests session expiry handling during offline periods.
 *
 * SKIP REASON: These tests require offline mutation queue and session expiry
 * handling UI which are NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue with IndexedDB persistence
 * 2. Session expiry detection while offline
 * 3. Re-authentication flow that preserves pending mutations
 * 4. Cached data access after session expiry
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'


// Skipping until infrastructure is implemented (see file header)
test.describe.skip('7.1 Session Expiry While Offline', () => {
  test('session expiry during offline does not lose local changes', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User is authenticated and editing offline
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await goOffline()
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Important offline work')

    // WHEN: Session expires (simulated by clearing session cookie)
    await page.context().clearCookies()

    // AND: User comes back online
    await goOnline()

    // THEN: User is prompted to re-authenticate
    await expect(page.getByText(/session expired|sign in/i)).toBeVisible()
    // AND: Local changes should be preserved for re-sync after auth
  })

  test('app remains usable offline even with expired session', async ({ page, goOffline, login }) => {
    await login()

    // GIVEN: User is on the app with valid session
    await page.goto('/docs')
    // Wait for document list to load
    await expect(page.getByTestId('document-list')).toBeVisible()

    // WHEN: User goes offline and then session expires
    // (In real life, session expires while already offline)
    await goOffline()
    await page.context().clearCookies() // Simulate expired session while offline

    // THEN: User can still view cached content
    await expect(page.getByTestId('document-list')).toBeVisible()
    // AND: Can make local changes (even if they won't sync until re-auth)
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Offline While Expired')
    await page.goto('/docs')
    await expect(page.getByText('Offline While Expired')).toBeVisible()
  })
})
