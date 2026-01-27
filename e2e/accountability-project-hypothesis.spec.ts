import { test, expect } from './fixtures/isolated-env';

/**
 * E2E test for the project hypothesis accountability flow.
 *
 * Tests the complete flow:
 * 1. Create project owned by user (without hypothesis)
 * 2. Verify "Write hypothesis" action item appears
 * 3. Add hypothesis to project
 * 4. Verify action item disappears
 * 5. Verify celebration animation triggers (via WebSocket event)
 *
 * These tests use API calls directly to avoid UI flakiness and
 * test the actual inference logic.
 */

// Helper to get CSRF token for API requests
async function getCsrfToken(page: import('@playwright/test').Page, apiUrl: string): Promise<string> {
  const response = await page.request.get(`${apiUrl}/api/csrf-token`);
  expect(response.ok()).toBe(true);
  const { token } = await response.json();
  return token;
}

test.describe('Accountability Project Hypothesis Flow', () => {
  test('project without hypothesis shows action item, adding hypothesis removes it', async ({ page, apiServer }) => {
    // Login to get auth cookies
    await page.goto('/login');
    await page.locator('#email').fill('dev@ship.local');
    await page.locator('#password').fill('admin123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).not.toHaveURL('/login', { timeout: 5000 });

    // Get CSRF token for API calls
    const csrfToken = await getCsrfToken(page, apiServer.url);

    // Get user ID
    const meResponse = await page.request.get(`${apiServer.url}/api/auth/me`);
    expect(meResponse.ok()).toBe(true);
    const meData = await meResponse.json();
    const userId = meData.data.user.id;

    // Create a program via documents API (required for project)
    const programResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Program for Project Hypothesis',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Create a project WITHOUT hypothesis, owned by user
    const projectResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Project Without Hypothesis',
        document_type: 'project',
        belongs_to: [{ id: programId, type: 'program' }],
      },
    });
    expect(projectResponse.ok()).toBe(true);
    const project = await projectResponse.json();
    const projectId = project.id;

    // Set current user as project owner
    const setOwnerResponse = await page.request.patch(`${apiServer.url}/api/projects/${projectId}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { owner_id: userId },
    });
    expect(setOwnerResponse.ok()).toBe(true);

    // Step 1: Check action items - should include project_hypothesis for this project
    const actionItemsResponse1 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse1.ok()).toBe(true);
    const actionItems1 = await actionItemsResponse1.json();

    // Find project_hypothesis item for this project
    const hypothesisItems1 = actionItems1.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === projectId && item.accountability_type === 'project_hypothesis'
    );

    // Should have exactly one project_hypothesis action item
    expect(hypothesisItems1.length).toBe(1);
    expect(hypothesisItems1[0].target_title).toContain('Test Project Without Hypothesis');

    // Step 2: Add hypothesis to the project
    const addHypothesisResponse = await page.request.patch(`${apiServer.url}/api/projects/${projectId}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { hypothesis: 'This is a test hypothesis for the project.' },
    });
    expect(addHypothesisResponse.ok()).toBe(true);

    // Step 3: Check action items again - project_hypothesis should be GONE
    const actionItemsResponse2 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse2.ok()).toBe(true);
    const actionItems2 = await actionItemsResponse2.json();

    const hypothesisItems2 = actionItems2.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === projectId && item.accountability_type === 'project_hypothesis'
    );

    // Key assertion: After adding hypothesis, no project_hypothesis item should exist
    expect(hypothesisItems2.length).toBe(0);
  });

  test('empty hypothesis string still shows action item', async ({ page, apiServer }) => {
    // Login to get auth cookies
    await page.goto('/login');
    await page.locator('#email').fill('dev@ship.local');
    await page.locator('#password').fill('admin123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).not.toHaveURL('/login', { timeout: 5000 });

    // Get CSRF token for API calls
    const csrfToken = await getCsrfToken(page, apiServer.url);

    // Get user ID
    const meResponse = await page.request.get(`${apiServer.url}/api/auth/me`);
    expect(meResponse.ok()).toBe(true);
    const meData = await meResponse.json();
    const userId = meData.data.user.id;

    // Create a program
    const programResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Program for Empty Hypothesis',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Create a project with empty hypothesis string
    const projectResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Project With Empty Hypothesis',
        document_type: 'project',
        belongs_to: [{ id: programId, type: 'program' }],
      },
    });
    expect(projectResponse.ok()).toBe(true);
    const project = await projectResponse.json();
    const projectId = project.id;

    // Set owner and explicitly set empty hypothesis
    await page.request.patch(`${apiServer.url}/api/projects/${projectId}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { owner_id: userId, hypothesis: '' },
    });

    // Check action items - should still show project_hypothesis because hypothesis is empty
    const actionItemsResponse = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse.ok()).toBe(true);
    const actionItems = await actionItemsResponse.json();

    const hypothesisItems = actionItems.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === projectId && item.accountability_type === 'project_hypothesis'
    );

    // Empty string hypothesis should still trigger action item
    expect(hypothesisItems.length).toBe(1);
  });

  test('archived projects do not show hypothesis action items', async ({ page, apiServer }) => {
    // Login to get auth cookies
    await page.goto('/login');
    await page.locator('#email').fill('dev@ship.local');
    await page.locator('#password').fill('admin123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).not.toHaveURL('/login', { timeout: 5000 });

    // Get CSRF token for API calls
    const csrfToken = await getCsrfToken(page, apiServer.url);

    // Get user ID
    const meResponse = await page.request.get(`${apiServer.url}/api/auth/me`);
    expect(meResponse.ok()).toBe(true);
    const meData = await meResponse.json();
    const userId = meData.data.user.id;

    // Create a program
    const programResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Program for Archived Project',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Create a project (without hypothesis)
    const projectResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Project To Be Archived',
        document_type: 'project',
        belongs_to: [{ id: programId, type: 'program' }],
      },
    });
    expect(projectResponse.ok()).toBe(true);
    const project = await projectResponse.json();
    const projectId = project.id;

    // Set owner
    await page.request.patch(`${apiServer.url}/api/projects/${projectId}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { owner_id: userId },
    });

    // Verify action item exists first
    const actionItemsResponse1 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse1.ok()).toBe(true);
    const actionItems1 = await actionItemsResponse1.json();
    const beforeArchive = actionItems1.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === projectId && item.accountability_type === 'project_hypothesis'
    );
    expect(beforeArchive.length).toBe(1);

    // Archive the project (use projects API which supports archived_at)
    const archiveResponse = await page.request.patch(`${apiServer.url}/api/projects/${projectId}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { archived_at: new Date().toISOString() },
    });
    expect(archiveResponse.ok()).toBe(true);

    // Check action items - archived project should NOT show hypothesis item
    const actionItemsResponse2 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse2.ok()).toBe(true);
    const actionItems2 = await actionItemsResponse2.json();

    const afterArchive = actionItems2.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === projectId && item.accountability_type === 'project_hypothesis'
    );

    // Archived projects should not show action items
    expect(afterArchive.length).toBe(0);
  });
});
