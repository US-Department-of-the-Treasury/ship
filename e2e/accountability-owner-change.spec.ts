import { test, expect } from './fixtures/isolated-env';

/**
 * Critical E2E test for the accountability refactor.
 *
 * This test proves that the inference-based approach works correctly:
 * when the owner of a project/sprint changes, the action item should
 * disappear immediately because items are computed dynamically.
 *
 * The old issue-based system had a bug where action items persisted
 * after owner changes because the issues were already created.
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

test.describe('Accountability Owner Change', () => {
  // project_plan accountability type was removed in commit e611139
  // This test expects project_plan action items which no longer exist
  // Needs rewrite for weekly_plan system
  test.fixme('project owner change immediately removes action item from inference', async ({ page, apiServer }) => {
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

    // Create a program via documents API (everything is a document)
    const programResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Program for Accountability',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Create a project via documents API with belongs_to for program association
    const projectResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Project',
        document_type: 'project',
        belongs_to: [{ id: programId, type: 'program' }],
      },
    });
    expect(projectResponse.ok()).toBe(true);
    const project = await projectResponse.json();
    const projectId = project.id;

    // Step 1: Set current user as project owner
    const setOwnerResponse = await page.request.patch(`${apiServer.url}/api/projects/${projectId}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { owner_id: userId },
    });
    expect(setOwnerResponse.ok()).toBe(true);

    // Step 2: Check action items - should include project_plan for this project
    const actionItemsResponse = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse.ok()).toBe(true);
    const actionItems = await actionItemsResponse.json();

    // Find items for this project
    const projectItems = actionItems.items.filter(
      (item: { accountability_target_id: string }) => item.accountability_target_id === projectId
    );

    // Should have at least project_plan action item
    expect(projectItems.length).toBeGreaterThan(0);
    expect(projectItems.some((i: { accountability_type: string }) => i.accountability_type === 'project_plan')).toBe(true);

    // Step 3: Remove owner from the project
    const removeOwnerResponse = await page.request.patch(`${apiServer.url}/api/projects/${projectId}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { owner_id: null },
    });
    expect(removeOwnerResponse.ok()).toBe(true);

    // Step 4: Check action items again - should have NO items for this project
    const actionItemsResponse2 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse2.ok()).toBe(true);
    const actionItems2 = await actionItemsResponse2.json();

    const projectItems2 = actionItems2.items.filter(
      (item: { accountability_target_id: string }) => item.accountability_target_id === projectId
    );

    // Key assertion: After removing owner, no action items should exist for this project
    // This proves the inference-based approach works - items aren't persisted as issues
    expect(projectItems2.length).toBe(0);
  });

  test('sprint owner change immediately removes action items from inference', async ({ page, apiServer }) => {
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

    // Create a program via documents API
    const programResponse = await page.request.post(`${apiServer.url}/api/documents`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Program for Sprint Accountability',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Create a sprint via sprints API (requires sprint_number for accountability to work)
    // Use sprint_number: 1 which has already started (workspace sprint_start_date is 3 months ago)
    const sprintResponse = await page.request.post(`${apiServer.url}/api/weeks`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Sprint',
        program_id: programId,
        sprint_number: 1,
        owner_id: userId, // Set owner at creation time
      },
    });
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await sprintResponse.json();
    const sprintId = sprint.id;

    // Step 2: Check action items - should include sprint items for this sprint
    const actionItemsResponse = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse.ok()).toBe(true);
    const actionItems = await actionItemsResponse.json();

    const sprintItems = actionItems.items.filter(
      (item: { accountability_target_id: string }) => item.accountability_target_id === sprintId
    );

    // Should have at least weekly_plan action item (new sprint without plan)
    expect(sprintItems.length).toBeGreaterThan(0);

    // Step 3: Remove owner from the sprint
    const removeOwnerResponse = await page.request.patch(`${apiServer.url}/api/weeks/${sprintId}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { owner_id: null },
    });
    expect(removeOwnerResponse.ok()).toBe(true);

    // Step 4: Check action items again - should have NO items for this sprint
    const actionItemsResponse2 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse2.ok()).toBe(true);
    const actionItems2 = await actionItemsResponse2.json();

    const sprintItems2 = actionItems2.items.filter(
      (item: { accountability_target_id: string }) => item.accountability_target_id === sprintId
    );

    // Key assertion: After removing owner, no action items should exist for this sprint
    expect(sprintItems2.length).toBe(0);
  });

  test('action items API returns valid response shape', async ({ page, apiServer }) => {
    // Login to get auth cookies
    await page.goto('/login');
    await page.locator('#email').fill('dev@ship.local');
    await page.locator('#password').fill('admin123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).not.toHaveURL('/login', { timeout: 5000 });

    const response = await page.request.get(`${apiServer.url}/api/accountability/action-items`);

    expect(response.ok()).toBe(true);
    const data = await response.json();

    // Verify response shape
    expect(data).toHaveProperty('items');
    expect(Array.isArray(data.items)).toBe(true);

    // If there are items, verify each has required fields
    for (const item of data.items) {
      expect(item).toHaveProperty('accountability_type');
      expect(item).toHaveProperty('accountability_target_id');
      expect(item).toHaveProperty('target_title');
    }
  });
});
