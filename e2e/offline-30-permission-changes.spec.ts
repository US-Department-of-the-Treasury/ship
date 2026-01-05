/**
 * Category 30: Permission/Authorization Changes While Offline
 * Tests handling when access is revoked during offline period.
 *
 * SKIP REASON: These tests require offline mutation queue with error handling
 * UI which is NOT YET IMPLEMENTED.
 *
 * INFRASTRUCTURE NEEDED:
 * 1. Offline mutation queue with IndexedDB persistence
 * 2. Permission error UI (403/401/409 handling)
 * 3. Session expiry detection and re-auth prompt
 * 4. Content preservation when sync fails
 *
 * See: docs/application-architecture.md "Offline Mutation Queue"
 */
import { test, expect } from './fixtures/offline'


test.describe('30.1 Access Revoked During Offline Period', () => {
  test('handles 403 Forbidden when syncing document user lost access to', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User edits document offline
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await goOffline()
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Offline edit to shared doc')
    await page.waitForTimeout(1000)

    // WHEN: Server returns 403 (access revoked)
    await page.route('**/api/documents/**', (route) => {
      if (route.request().method() === 'PATCH' || route.request().method() === 'PUT') {
        route.fulfill({
          status: 403,
          body: JSON.stringify({ error: 'Access denied - you no longer have permission' }),
        })
      } else {
        route.continue()
      }
    })
    await goOnline()
    await page.waitForTimeout(5000)

    // THEN: Shows clear error explaining access issue
    await expect(page.getByText(/access.*denied|permission.*denied|forbidden/i)).toBeVisible({ timeout: 10000 })
  })

  test('handles 401 Unauthorized (session invalid)', async ({ page, goOffline, goOnline, login }) => {
    await login()

    // GIVEN: User has pending changes
    await page.goto('/docs')
    await goOffline()
    await page.getByRole('button', { name: 'New Document', exact: true }).click()
    await page.waitForURL(/\/docs\/[^/]+$/)
    const titleInput = page.locator('[contenteditable="true"]').first()
    await titleInput.click()
    await page.keyboard.type('Session Test')
    await page.goto('/docs')

    // WHEN: Session expired (401)
    await page.route('**/api/documents', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 401,
          body: JSON.stringify({ error: 'Session expired' }),
        })
      } else {
        route.continue()
      }
    })
    await goOnline()
    await page.waitForTimeout(3000)

    // THEN: Prompts to re-authenticate or shows session error
    await expect(page.getByText(/session.*expired|log.*in|unauthorized/i)).toBeVisible({ timeout: 10000 })
  })

  test('handles document ownership transfer while offline', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User editing document
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await goOffline()
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('My offline edit')
    await page.waitForTimeout(1000)

    // WHEN: Document was transferred (409 Conflict)
    await page.route('**/api/documents/**', (route) => {
      if (route.request().method() === 'PATCH' || route.request().method() === 'PUT') {
        route.fulfill({
          status: 409,
          body: JSON.stringify({ error: 'Document ownership changed' }),
        })
      } else {
        route.continue()
      }
    })
    await goOnline()
    await page.waitForTimeout(3000)

    // THEN: Shows conflict or ownership change message
    await expect(page.getByText(/conflict|ownership|changed/i)).toBeVisible({ timeout: 10000 })
  })

  test('preserves offline content when permission denied', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User makes substantial edits offline
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    const originalContent = await page.getByTestId('tiptap-editor').textContent()
    await goOffline()
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Important offline content that should not be lost')
    await page.waitForTimeout(1000)

    // WHEN: Sync fails with permission error
    await page.route('**/api/documents/**', (route) => {
      if (route.request().method() === 'PATCH' || route.request().method() === 'PUT') {
        route.fulfill({
          status: 403,
          body: JSON.stringify({ error: 'Permission denied' }),
        })
      } else {
        route.continue()
      }
    })
    await goOnline()
    await page.waitForTimeout(3000)

    // THEN: User's offline edits are still visible in editor
    await expect(page.getByTestId('tiptap-editor')).toContainText('Important offline content')
  })

  test('handles role downgrade during offline period', async ({ page, goOffline, goOnline, login, testData }) => {
    await login()

    // GIVEN: User edits document
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)
    await goOffline()
    await page.getByTestId('tiptap-editor').click()
    await page.keyboard.type('Edit with old permissions')
    await page.waitForTimeout(1000)

    // WHEN: User's role was downgraded (can read but not write)
    let isFirstRequest = true
    await page.route('**/api/documents/**', (route) => {
      if ((route.request().method() === 'PATCH' || route.request().method() === 'PUT') && isFirstRequest) {
        isFirstRequest = false
        route.fulfill({
          status: 403,
          body: JSON.stringify({
            error: 'Read-only access',
            code: 'PERMISSION_DOWNGRADED'
          }),
        })
      } else {
        route.continue()
      }
    })
    await goOnline()
    await page.waitForTimeout(3000)

    // THEN: Shows appropriate error about reduced permissions
    await expect(page.getByText(/read.*only|permission|access/i)).toBeVisible({ timeout: 10000 })
  })
})
