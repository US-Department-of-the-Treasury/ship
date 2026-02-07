import { test, expect } from './fixtures/isolated-env';

/**
 * E2E test for standup accountability flow.
 *
 * Standups are different from other accountability types:
 * - They're based on ASSIGNED issues, not ownership
 * - They only appear on business days (Mon-Fri)
 * - They show issue count in the message
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

test.describe('Standup Accountability Flow', () => {
  // Mock date to always be a Wednesday (business day) to avoid weekend skips
  test.beforeEach(async ({ page }) => {
    // Set a fixed Wednesday date for all tests
    await page.addInitScript(() => {
      const mockDate = new Date('2025-01-15T10:00:00'); // Wednesday
      const OriginalDate = Date;
      // @ts-ignore
      globalThis.Date = class extends OriginalDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) {
            super(mockDate.getTime());
          } else {
            // @ts-ignore
            super(...args);
          }
        }
        static now() {
          return mockDate.getTime();
        }
      };
    });
  });

  test.fixme('user with assigned issues in current sprint sees standup action item', async ({ page, apiServer }) => {
    // FIXME: Standup accountability inference uses server-side date while the test
    // mocks the date only on the browser side. The sprint_number computation and
    // isBusinessDay check happen on the server, making this test unreliable.
    // Needs rewrite to either mock server date or use a different testing approach.
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
        title: 'Test Program for Standup',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Get current sprint number from server to ensure it matches the accountability
    // service's computation (avoids timezone/date-normalization mismatches)
    const gridResponse = await page.request.get(`${apiServer.url}/api/team/grid`);
    expect(gridResponse.ok()).toBe(true);
    const gridData = await gridResponse.json();
    const currentSprintNumber = gridData.currentSprintNumber;

    // Create a sprint that's current (should be started)
    const sprintResponse = await page.request.post(`${apiServer.url}/api/weeks`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Current Sprint for Standup',
        program_id: programId,
        sprint_number: currentSprintNumber,
        owner_id: userId,
      },
    });
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await sprintResponse.json();
    const sprintId = sprint.id;

    // Create an issue assigned to current user in this sprint
    const issueResponse = await page.request.post(`${apiServer.url}/api/issues`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Issue Assigned to User',
        assignee_id: userId,
        belongs_to: [{ id: sprintId, type: 'sprint' }],
      },
    });
    expect(issueResponse.ok()).toBe(true);

    // Check action items - should include standup for this sprint
    const actionItemsResponse = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse.ok()).toBe(true);
    const actionItems = await actionItemsResponse.json();

    const standupItems = actionItems.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'standup'
    );

    // Should have a standup action item for this sprint
    expect(standupItems.length).toBe(1);
    // Title should mention issue count
    expect(standupItems[0].title).toContain('1 issue');
  });

  test.fixme('creating standup removes action item', async ({ page, apiServer }) => {
    // FIXME: Same server-side date issue as the test above.
    // Date is mocked to Wednesday in beforeEach, but only on browser side.

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
        title: 'Test Program for Standup Creation',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Get current sprint number from server to ensure it matches the accountability
    // service's computation (avoids timezone/date-normalization mismatches)
    const gridResponse = await page.request.get(`${apiServer.url}/api/team/grid`);
    expect(gridResponse.ok()).toBe(true);
    const gridData = await gridResponse.json();
    const currentSprintNumber = gridData.currentSprintNumber;

    // Create current sprint
    const sprintResponse = await page.request.post(`${apiServer.url}/api/weeks`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Current Sprint for Standup Creation',
        program_id: programId,
        sprint_number: currentSprintNumber,
        owner_id: userId,
      },
    });
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await sprintResponse.json();
    const sprintId = sprint.id;

    // Create an issue assigned to current user in this sprint
    await page.request.post(`${apiServer.url}/api/issues`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Test Issue for Standup',
        assignee_id: userId,
        belongs_to: [{ id: sprintId, type: 'sprint' }],
      },
    });

    // Step 1: Verify standup item exists
    const actionItemsResponse1 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse1.ok()).toBe(true);
    const actionItems1 = await actionItemsResponse1.json();

    const standupItems1 = actionItems1.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'standup'
    );
    expect(standupItems1.length).toBe(1);

    // Step 2: Create a standup for this sprint (via sprint standups endpoint)
    const standupResponse = await page.request.post(`${apiServer.url}/api/weeks/${sprintId}/standups`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Daily Standup',
        content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My standup update' }] }] },
      },
    });
    expect(standupResponse.ok()).toBe(true);

    // Step 3: Verify standup item is now GONE
    const actionItemsResponse2 = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse2.ok()).toBe(true);
    const actionItems2 = await actionItemsResponse2.json();

    const standupItems2 = actionItems2.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'standup'
    );

    // After creating standup, no standup action item should exist
    expect(standupItems2.length).toBe(0);
  });

  test('user without assigned issues does not see standup action item', async ({ page, apiServer }) => {
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
        title: 'Test Program for Empty Sprint',
        document_type: 'program',
      },
    });
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json();
    const programId = program.id;

    // Get current sprint number from server to ensure it matches the accountability
    // service's computation (avoids timezone/date-normalization mismatches)
    const gridResponse = await page.request.get(`${apiServer.url}/api/team/grid`);
    expect(gridResponse.ok()).toBe(true);
    const gridData = await gridResponse.json();
    const currentSprintNumber = gridData.currentSprintNumber;

    // Create current sprint with user as owner
    const sprintResponse = await page.request.post(`${apiServer.url}/api/weeks`, {
      headers: { 'x-csrf-token': csrfToken },
      data: {
        title: 'Empty Sprint No Assigned Issues',
        program_id: programId,
        sprint_number: currentSprintNumber,
        owner_id: userId,
      },
    });
    expect(sprintResponse.ok()).toBe(true);
    const sprint = await sprintResponse.json();
    const sprintId = sprint.id;

    // DON'T create any issues assigned to this user

    // Check action items - should NOT have standup item (no assigned issues)
    const actionItemsResponse = await page.request.get(`${apiServer.url}/api/accountability/action-items`);
    expect(actionItemsResponse.ok()).toBe(true);
    const actionItems = await actionItemsResponse.json();

    const standupItems = actionItems.items.filter(
      (item: { accountability_target_id: string; accountability_type: string }) =>
        item.accountability_target_id === sprintId && item.accountability_type === 'standup'
    );

    // No assigned issues = no standup action item
    expect(standupItems.length).toBe(0);
  });
});
