import { test, expect } from './fixtures/isolated-env';

/**
 * E2E test for sprint accountability items flow.
 *
 * Tests sprint-related accountability types:
 * 1. weekly_plan - Sprint without plan shows action item
 * 2. week_start - Sprint not started (but should be) shows item
 * 3. week_issues - Sprint without issues shows action item
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

test.describe('Week Accountability Flow', () => {
  test('sprint without plan shows action item, adding plan removes it', async ({ page, apiServer }) => {
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
        title: 'Test Program for Sprint Plan',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Create a sprint without plan, owned by user
    // Use sprint_number: 1 which has already started (workspace week_start_date is 3 months ago)
    const sprintResponse = await page.request.post(`${apiServer.url}/api/weeks`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Sprint Without Plan',
        program_id: programId,
        sprint_number: 1,
        owner_id: userId,
      },
    });
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await sprintResponse.json();
    const sprintId = sprint.id;

    // Step 1: Check action items - should include weekly_plan for this sprint
    const actionItemsResponse1 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse1.ok()).toBe(true);
    const actionItems1 = await actionItemsResponse1.json();

    const planItems1 = actionItems1.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'weekly_plan'
    );

    // Should have weekly_plan action item
    expect(planItems1.length).toBe(1);

    // Step 2: Add plan to the sprint (uses separate /plan endpoint)
    const addPlanResponse = await page.request.patch(`${apiServer.url}/api/weeks/${sprintId}/plan`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { plan: 'This is a test plan for the sprint.' },
    });
    expect(addPlanResponse.ok()).toBe(true);

    // Step 3: Check action items again - weekly_plan should be GONE
    const actionItemsResponse2 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse2.ok()).toBe(true);
    const actionItems2 = await actionItemsResponse2.json();

    const planItems2 = actionItems2.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'weekly_plan'
    );

    // After adding plan, no weekly_plan item should exist
    expect(planItems2.length).toBe(0);
  });

  test('sprint not started shows action item, starting sprint removes it', async ({ page, apiServer }) => {
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
        title: 'Test Program for Sprint Start',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Create a sprint in planning status (default)
    // Sprint 1 has started per workspace dates, so it should show week_start action
    const sprintResponse = await page.request.post(`${apiServer.url}/api/weeks`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Sprint Not Started',
        program_id: programId,
        sprint_number: 1,
        owner_id: userId,
      },
    });
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await sprintResponse.json();
    const sprintId = sprint.id;

    // Step 1: Check for week_start action item (sprint should be started but isn't)
    const actionItemsResponse1 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse1.ok()).toBe(true);
    const actionItems1 = await actionItemsResponse1.json();

    const startItems1 = actionItems1.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'week_start'
    );

    // Should have week_start action item
    expect(startItems1.length).toBe(1);

    // Step 2: Start the sprint
    const startSprintResponse = await page.request.patch(`${apiServer.url}/api/weeks/${sprintId}`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { status: 'active' },
    });
    expect(startSprintResponse.ok()).toBe(true);

    // Step 3: Check action items again - week_start should be GONE
    const actionItemsResponse2 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse2.ok()).toBe(true);
    const actionItems2 = await actionItemsResponse2.json();

    const startItems2 = actionItems2.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'week_start'
    );

    // After starting sprint, no week_start item should exist
    expect(startItems2.length).toBe(0);
  });

  test('sprint without issues shows action item, adding issue removes it', async ({ page, apiServer }) => {
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
        title: 'Test Program for Sprint Issues',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Create a sprint (sprint 1 has started)
    const sprintResponse = await page.request.post(`${apiServer.url}/api/weeks`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Sprint Without Issues',
        program_id: programId,
        sprint_number: 1,
        owner_id: userId,
      },
    });
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await sprintResponse.json();
    const sprintId = sprint.id;

    // Step 1: Check for week_issues action item (no issues in sprint)
    const actionItemsResponse1 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse1.ok()).toBe(true);
    const actionItems1 = await actionItemsResponse1.json();

    const issuesItems1 = actionItems1.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'week_issues'
    );

    // Should have week_issues action item
    expect(issuesItems1.length).toBe(1);

    // Step 2: Create an issue and associate it with the sprint via belongs_to
    const issueResponse = await page.request.post(`${apiServer.url}/api/issues`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Issue for Sprint',
        belongs_to: [{ id: sprintId, type: 'sprint' }],
      },
    });
    expect(issueResponse.ok()).toBe(true);

    // Step 3: Check action items again - week_issues should be GONE
    const actionItemsResponse2 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse2.ok()).toBe(true);
    const actionItems2 = await actionItemsResponse2.json();

    const issuesItems2 = actionItems2.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'week_issues'
    );

    // After adding issue, no week_issues item should exist
    expect(issuesItems2.length).toBe(0);
  });

  test('sprint in future does not show action items', async ({ page, apiServer }) => {
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
        title: 'Test Program for Future Sprint',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Create a sprint very far in future (sprint 1000 - about 19 years from workspace start)
    const sprintResponse = await page.request.post(`${apiServer.url}/api/weeks`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Future Sprint',
        program_id: programId,
        sprint_number: 1000,
        owner_id: userId,
      },
    });
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await sprintResponse.json();
    const sprintId = sprint.id;

    // Check action items - future sprint should NOT show any accountability items
    const actionItemsResponse = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse.ok()).toBe(true);
    const actionItems = await actionItemsResponse.json();

    const futureSprintItems = actionItems.items.filter(
      (item: { accountability_target_id: string }) => item.accountability_target_id === sprintId
    );

    // Future sprints should not trigger accountability items
    expect(futureSprintItems.length).toBe(0);
  });
});
