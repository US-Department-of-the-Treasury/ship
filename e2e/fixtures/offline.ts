import { test as base, expect, Page, APIRequestContext } from '@playwright/test'

// API base URL (matches playwright.config.ts)
const API_URL = process.env.API_URL || 'http://localhost:3000'

// Test user credentials (from seed data)
const TEST_USER = {
  email: 'dev@ship.local',
  password: 'admin123'
}

// Helper to get CSRF token
async function getCsrfToken(request: APIRequestContext, cookies: string): Promise<string> {
  const response = await request.get(`${API_URL}/api/csrf-token`, {
    headers: { Cookie: cookies }
  })
  if (!response.ok()) {
    throw new Error(`Failed to get CSRF token: ${response.status()}`)
  }
  const data = await response.json()
  return data.token
}

// Helper to login via the UI (idempotent - skips if already logged in)
async function loginViaUI(page: Page) {
  // Check if already logged in by looking at current URL
  const currentUrl = page.url()
  if (currentUrl.includes('/docs') || currentUrl.includes('/programs') || currentUrl.includes('/team') || currentUrl.includes('/issues')) {
    // Already logged in, nothing to do
    return
  }

  await page.goto('/login')

  // Check if we got redirected (already logged in)
  const afterGotoUrl = page.url()
  if (!afterGotoUrl.includes('/login')) {
    // Was redirected, already logged in
    return
  }

  // Wait for the email input to be visible
  const emailInput = page.locator('input[name="email"]')
  try {
    await emailInput.waitFor({ state: 'visible', timeout: 5000 })
  } catch {
    // Login form not visible - might already be logged in
    const finalUrl = page.url()
    if (finalUrl.includes('/docs') || finalUrl.includes('/programs') || finalUrl.includes('/team')) {
      return
    }
    throw new Error(`Login form not visible and not on authenticated page. Current URL: ${finalUrl}`)
  }

  await page.fill('input[name="email"]', TEST_USER.email)
  await page.fill('input[name="password"]', TEST_USER.password)
  await page.click('button[type="submit"]')
  // Wait for redirect to docs page
  await page.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })
}

// Helper to create a document via API
async function createDocument(
  request: APIRequestContext,
  cookies: string,
  data: {
    title: string
    document_type: 'wiki' | 'issue' | 'program' | 'project' | 'sprint' | 'person'
    content?: object
    properties?: object
    program_id?: string
    project_id?: string
    sprint_id?: string
  }
) {
  const csrfToken = await getCsrfToken(request, cookies)
  const response = await request.post(`${API_URL}/api/documents`, {
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookies,
      'X-CSRF-Token': csrfToken
    },
    data
  })
  if (!response.ok()) {
    throw new Error(`Failed to create document: ${response.status()} ${await response.text()}`)
  }
  return response.json()
}

// Helper to update a document via API
async function updateDocument(
  request: APIRequestContext,
  cookies: string,
  id: string,
  data: {
    title?: string
    content?: object
    properties?: object
  }
) {
  const csrfToken = await getCsrfToken(request, cookies)
  const response = await request.patch(`${API_URL}/api/documents/${id}`, {
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookies,
      'X-CSRF-Token': csrfToken
    },
    data
  })
  if (!response.ok()) {
    throw new Error(`Failed to update document: ${response.status()} ${await response.text()}`)
  }
  return response.json()
}

// Helper to delete a document via API
async function deleteDocument(
  request: APIRequestContext,
  cookies: string,
  id: string
) {
  const csrfToken = await getCsrfToken(request, cookies)
  const response = await request.delete(`${API_URL}/api/documents/${id}`, {
    headers: {
      Cookie: cookies,
      'X-CSRF-Token': csrfToken
    }
  })
  if (!response.ok()) {
    throw new Error(`Failed to delete document: ${response.status()} ${await response.text()}`)
  }
}

// Helper to get session cookies after login
async function getSessionCookies(page: Page): Promise<string> {
  const cookies = await page.context().cookies()
  return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

// Interface for test data created by seedOfflineTestData
interface OfflineTestData {
  wikis: Array<{ id: string; title: string }>
  programs: Array<{ id: string; title: string }>
  issues: Array<{ id: string; title: string; ticket_number: number }>
}

// Extend the base test with offline helpers
export const test = base.extend<{
  goOffline: () => Promise<void>
  goOnline: () => Promise<void>
  isOnline: () => Promise<boolean>
  login: () => Promise<void>
  getCookies: () => Promise<string>
  createDoc: (data: Parameters<typeof createDocument>[2]) => Promise<{ id: string }>
  updateDoc: (id: string, data: Parameters<typeof updateDocument>[3]) => Promise<void>
  deleteDoc: (id: string) => Promise<void>
  testData: OfflineTestData
}>({
  // Network control fixtures
  goOffline: async ({ context, page }, use) => {
    await use(async () => {
      await context.setOffline(true)
      // Dispatch offline event so TanStack Query's onlineManager knows
      await page.evaluate(() => {
        window.dispatchEvent(new Event('offline'))
      })
    })
  },

  goOnline: async ({ context, page }, use) => {
    await use(async () => {
      await context.setOffline(false)
      // Dispatch online event so TanStack Query's onlineManager knows
      // and resumes paused mutations
      await page.evaluate(() => {
        window.dispatchEvent(new Event('online'))
      })
      // Wait a moment for mutations to start processing
      await page.waitForTimeout(100)
    })
  },

  isOnline: async ({ page }, use) => {
    await use(async () => {
      return page.evaluate(() => navigator.onLine)
    })
  },

  // Authentication fixture
  login: async ({ page }, use) => {
    await use(async () => {
      await loginViaUI(page)
    })
  },

  // Get cookies for API calls
  getCookies: async ({ page }, use) => {
    await use(async () => {
      return getSessionCookies(page)
    })
  },

  // Document creation helper
  createDoc: async ({ page, request }, use) => {
    const createdDocs: string[] = []

    await use(async (data) => {
      const cookies = await getSessionCookies(page)
      const result = await createDocument(request, cookies, data)
      createdDocs.push(result.id)
      return result
    })

    // Cleanup: delete created documents after test
    const cookies = await getSessionCookies(page)
    for (const id of createdDocs) {
      try {
        await deleteDocument(request, cookies, id)
      } catch {
        // Ignore cleanup errors (doc may already be deleted by test)
      }
    }
  },

  // Document update helper
  updateDoc: async ({ page, request }, use) => {
    await use(async (id, data) => {
      const cookies = await getSessionCookies(page)
      await updateDocument(request, cookies, id, data)
    })
  },

  // Document delete helper
  deleteDoc: async ({ page, request }, use) => {
    await use(async (id) => {
      const cookies = await getSessionCookies(page)
      await deleteDocument(request, cookies, id)
    })
  },

  // Pre-seeded test data (fetched from existing seed data)
  testData: async ({ page, request }, use) => {
    // Login first
    await loginViaUI(page)

    // Get session cookies
    const cookies = await getSessionCookies(page)

    // Fetch existing wikis
    const wikiResponse = await request.get(`${API_URL}/api/documents?type=wiki`, {
      headers: { Cookie: cookies }
    })
    const wikis = wikiResponse.ok() ? await wikiResponse.json() : []

    // Fetch existing programs
    const programResponse = await request.get(`${API_URL}/api/documents?type=program`, {
      headers: { Cookie: cookies }
    })
    const programs = programResponse.ok() ? await programResponse.json() : []

    // Fetch existing issues
    const issueResponse = await request.get(`${API_URL}/api/issues`, {
      headers: { Cookie: cookies }
    })
    const issues = issueResponse.ok() ? await issueResponse.json() : []

    await use({
      wikis: wikis.slice(0, 5), // First 5 wikis
      programs: programs.slice(0, 5), // First 5 programs
      issues: issues.slice(0, 10) // First 10 issues
    })
  }
})

export { expect }
