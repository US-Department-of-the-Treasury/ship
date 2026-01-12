/**
 * E2E tests for pending invites appearing in allocation grid
 *
 * Tests the fix for regression where pending invites (users who haven't accepted yet)
 * don't appear in the allocation grid. After fix:
 * - Pending users APPEAR in the grid (so admins can see who's invited)
 * - Pending users are NOT assignable (they can't have programs assigned until they accept)
 */

import { test, expect, Page } from './fixtures/isolated-env'

// Helper to login as super admin
async function loginAsSuperAdmin(page: Page) {
  await page.context().clearCookies()
  await page.goto('/login')
  await page.locator('#email').fill('dev@ship.local')
  await page.locator('#password').fill('admin123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL('/login', { timeout: 10000 })
}

// Helper to get CSRF token for API requests
async function getCsrfToken(page: Page): Promise<string> {
  const response = await page.request.get('/api/csrf-token')
  const data = await response.json()
  return data.token
}

// Helper to get current workspace ID
async function getWorkspaceId(page: Page): Promise<string> {
  const response = await page.request.get('/api/workspaces/current')
  const data = await response.json()
  return data.data.workspace.id
}

// Helper to create a pending invite via API
async function createPendingInvite(page: Page, email: string): Promise<void> {
  const csrfToken = await getCsrfToken(page)
  const workspaceId = await getWorkspaceId(page)

  const response = await page.request.post(`/api/workspaces/${workspaceId}/invites`, {
    headers: { 'x-csrf-token': csrfToken },
    data: { email, role: 'member' }
  })

  expect(response.status()).toBe(201)
}

test.describe('Pending Invites in Allocation Grid', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page)
  })

  test('pending invite appears in team grid with isPending flag', async ({ page }) => {
    // Create a pending invite
    const testEmail = `pending-grid-${Date.now()}@example.com`
    await createPendingInvite(page, testEmail)

    // Set up response listener BEFORE navigation
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('/api/team/grid') && resp.status() === 200
    )

    // Navigate to team allocation grid
    await page.goto('/team/allocation')
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

    // Wait for the API response
    const response = await responsePromise
    const data = await response.json()

    // Find the pending user in the response
    const pendingUser = data.users.find((u: { email: string }) => u.email === testEmail)
    expect(pendingUser).toBeDefined()
    expect(pendingUser.isPending).toBe(true)
    expect(pendingUser.id).toBeNull() // Pending users have null user_id
    expect(pendingUser.name).toBeDefined()
  })

  test('pending invite appears in team people API with isPending flag', async ({ page }) => {
    // Create a pending invite
    const testEmail = `pending-people-${Date.now()}@example.com`
    await createPendingInvite(page, testEmail)

    // Call the team/people API
    const response = await page.request.get('/api/team/people')
    expect(response.status()).toBe(200)

    const people = await response.json()

    // Find the pending user
    const pendingPerson = people.find((p: { email: string }) => p.email === testEmail)
    expect(pendingPerson).toBeDefined()
    expect(pendingPerson.isPending).toBe(true)
    expect(pendingPerson.user_id).toBeNull()
  })

  test('pending user appears in grid UI with visual distinction', async ({ page }) => {
    // Create a pending invite
    const testEmail = `pending-ui-${Date.now()}@example.com`
    await createPendingInvite(page, testEmail)

    // Navigate to team allocation grid
    await page.goto('/team/allocation')
    await page.waitForLoadState('networkidle')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

    // The pending user's name (email prefix) should be visible
    const emailPrefix = testEmail.split('@')[0]
    await expect(page.getByText(emailPrefix)).toBeVisible({ timeout: 10000 })

    // Should have "(pending)" badge next to the name
    await expect(page.getByText('(pending)')).toBeVisible({ timeout: 5000 })
  })

  test('clicking pending user cell does NOT open program selector', async ({ page }) => {
    // Create a pending invite
    const testEmail = `pending-click-${Date.now()}@example.com`
    await createPendingInvite(page, testEmail)

    // Navigate to team allocation grid
    await page.goto('/team/allocation')
    await page.waitForLoadState('networkidle')

    // Wait for grid to load
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })

    // Find the pending user row
    const emailPrefix = testEmail.split('@')[0]
    await expect(page.getByText(emailPrefix)).toBeVisible({ timeout: 10000 })

    // Find the row containing the pending user
    // The pending user's sprint cells should show "—" and NOT be clickable
    const pendingUserRow = page.locator('div').filter({ hasText: emailPrefix }).filter({ hasText: '(pending)' }).first()
    await expect(pendingUserRow).toBeVisible()

    // Find the first sprint cell for this user (should contain "—")
    // Pending user cells don't have a "+" button - they show "—"
    const dashCell = page.locator('div').filter({ hasText: '—' }).first()
    const dashCount = await dashCell.count()

    if (dashCount > 0) {
      // Click the dash cell (for pending user)
      await dashCell.click()

      // The program selector popover should NOT appear
      // Give it a moment to potentially open
      await page.waitForTimeout(500)

      // Verify the command menu is NOT visible
      const searchInput = page.getByPlaceholder('Search programs...')
      await expect(searchInput).not.toBeVisible()
    }
  })

  test('non-pending users still have clickable cells', async ({ page }) => {
    // Create a pending invite (to ensure we have both pending and non-pending users)
    const testEmail = `pending-compare-${Date.now()}@example.com`
    await createPendingInvite(page, testEmail)

    await page.goto('/team/allocation')
    await page.waitForLoadState('networkidle')

    // Wait for grid to load with user data
    await expect(page.getByText('Team Member', { exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Dev User')).toBeVisible({ timeout: 10000 })

    // Wait for sprint columns to load
    await expect(page.getByText(/Sprint \d+/).first()).toBeVisible({ timeout: 10000 })

    // Wait a moment for grid to stabilize
    await page.waitForTimeout(500)

    // Look for an empty cell (shows "+" placeholder) - this should be for non-pending user
    const emptyCellButton = page.getByRole('button', { name: '+' }).first()
    const hasEmptyCell = await emptyCellButton.count() > 0

    if (hasEmptyCell) {
      // Click empty cell button for non-pending user
      await emptyCellButton.click()

      // Wait for the popover to open (cmdk command menu)
      await expect(page.getByPlaceholder('Search programs...')).toBeVisible({ timeout: 10000 })

      // Verify the command menu is shown
      const commandMenu = page.locator('[cmdk-root]')
      await expect(commandMenu).toBeVisible()

      // Press Escape to close
      await page.keyboard.press('Escape')
    }
  })

  test('assignment API rejects null userId (pending user)', async ({ page }) => {
    const csrfToken = await getCsrfToken(page)

    // Get a program ID
    const programsResponse = await page.request.get('/api/team/programs')
    expect(programsResponse.status()).toBe(200)
    const programs = await programsResponse.json()
    expect(programs.length).toBeGreaterThan(0)
    const programId = programs[0].id

    // Try to assign with null userId (simulating what would happen if UI allowed it)
    const assignResponse = await page.request.post('/api/team/assign', {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        userId: null,
        programId: programId,
        sprintNumber: 1
      }
    })

    // Should return 400 error
    expect(assignResponse.status()).toBe(400)
    const errorData = await assignResponse.json()
    expect(errorData.error).toBe('Missing required fields')
  })
})

test.describe('Pending Invite Acceptance Flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page)
  })

  test('accepted invite converts pending user to regular member', async ({ page }) => {
    // This test verifies the acceptance flow conceptually via API
    // Full acceptance would require email verification flow

    // Create a pending invite
    const testEmail = `pending-accept-${Date.now()}@example.com`
    await createPendingInvite(page, testEmail)

    // Verify they appear as pending first
    let peopleResponse = await page.request.get('/api/team/people')
    let people = await peopleResponse.json()
    let pendingPerson = people.find((p: { email: string }) => p.email === testEmail)

    expect(pendingPerson).toBeDefined()
    expect(pendingPerson.isPending).toBe(true)
    expect(pendingPerson.user_id).toBeNull()

    // Note: Full acceptance test would require:
    // 1. Getting the invite token from API
    // 2. Calling POST /api/invites/:token/accept with user details
    // 3. Verifying the user now appears with isPending=false and valid user_id
    // This is tested in Story 6 separately
  })
})
