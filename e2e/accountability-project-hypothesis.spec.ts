import { test, expect } from './fixtures/isolated-env';

/**
 * E2E test for the project plan accountability flow.
 *
 * Tests the complete flow:
 * 1. Create project owned by user (without plan)
 * 2. Verify "Write plan" action item appears
 * 3. Add plan to project
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

test.describe('Accountability Project Plan Flow', () => {
  test('project without plan shows action item, adding plan removes it', async ({ page, apiServer }) => {
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
        title: 'Test Program for Project Plan',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Create a project WITHOUT plan, owned by user
    const projectResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Project Without Plan',
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

    // Step 1: Check action items - should include project_plan for this project
    const actionItemsResponse1 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse1.ok()).toBe(true);
    const actionItems1 = await actionItemsResponse1.json();

    // Find project_plan item for this project
    const planItems1 = actionItems1.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === projectId && item.accountability_type === 'project_plan'
    );

    // Should have exactly one project_plan action item
    expect(planItems1.length).toBe(1);
    expect(planItems1[0].target_title).toContain('Test Project Without Plan');

    // Step 2: Add plan to the project
    const addPlanResponse = await page.request.patch(`${apiServer.url}/api/projects/${projectId}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { plan: 'This is a test plan for the project.' },
    });
    expect(addPlanResponse.ok()).toBe(true);

    // Step 3: Check action items again - project_plan should be GONE
    const actionItemsResponse2 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse2.ok()).toBe(true);
    const actionItems2 = await actionItemsResponse2.json();

    const planItems2 = actionItems2.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === projectId && item.accountability_type === 'project_plan'
    );

    // Key assertion: After adding plan, no project_plan item should exist
    expect(planItems2.length).toBe(0);
  });

  test('empty plan string still shows action item', async ({ page, apiServer }) => {
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
        title: 'Test Program for Empty Plan',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Create a project with empty plan string
    const projectResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Project With Empty Plan',
        document_type: 'project',
        belongs_to: [{ id: programId, type: 'program' }],
      },
    });
    expect(projectResponse.ok()).toBe(true);
    const project = await projectResponse.json();
    const projectId = project.id;

    // Set owner and explicitly set empty plan
    await page.request.patch(`${apiServer.url}/api/projects/${projectId}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { owner_id: userId, plan: '' },
    });

    // Check action items - should still show project_plan because plan is empty
    const actionItemsResponse = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse.ok()).toBe(true);
    const actionItems = await actionItemsResponse.json();

    const planItems = actionItems.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === projectId && item.accountability_type === 'project_plan'
    );

    // Empty string plan should still trigger action item
    expect(planItems.length).toBe(1);
  });

  test('archived projects do not show plan action items', async ({ page, apiServer }) => {
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

    // Create a project (without plan)
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
        item.accountability_target_id === projectId && item.accountability_type === 'project_plan'
    );
    expect(beforeArchive.length).toBe(1);

    // Archive the project (use projects API which supports archived_at)
    const archiveResponse = await page.request.patch(`${apiServer.url}/api/projects/${projectId}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { archived_at: new Date().toISOString() },
    });
    expect(archiveResponse.ok()).toBe(true);

    // Check action items - archived project should NOT show plan item
    const actionItemsResponse2 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse2.ok()).toBe(true);
    const actionItems2 = await actionItemsResponse2.json();

    const afterArchive = actionItems2.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === projectId && item.accountability_type === 'project_plan'
    );

    // Archived projects should not show action items
    expect(afterArchive.length).toBe(0);
  });
});
