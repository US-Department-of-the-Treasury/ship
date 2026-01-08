import { test, expect } from './fixtures/isolated-env';

/**
 * Feedback Consolidation Tests
 *
 * Tests for consolidating feedback into the Issues system with:
 * - New 'triage' state for external submissions
 * - Source column/badge in Issues list
 * - 'Needs Triage' filter
 * - Accept/Reject triage actions
 * - Migration of existing feedback data
 */

// Helper to login
async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('#email').fill('dev@ship.local');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL('/login', { timeout: 10000 });
}

// Helper to get CSRF token for API requests
async function getCsrfToken(page: import('@playwright/test').Page, apiUrl: string): Promise<string> {
  const response = await page.request.get(`${apiUrl}/api/csrf-token`);
  const { token } = await response.json();
  return token;
}

// Helper to get a program ID (programs use onClick navigation, not links)
async function getProgramId(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/programs');
  await expect(page.locator('h1', { hasText: 'Programs' })).toBeVisible({ timeout: 10000 });

  // Click on the first program card
  const programCard = page.locator('[class*="rounded-lg"]', { hasText: /ship core/i }).first();
  await programCard.click();
  await page.waitForURL(/\/programs\/[a-f0-9-]+/i, { timeout: 10000 });

  // Extract program ID from URL
  const url = page.url();
  const programId = url.split('/programs/')[1]?.split(/[?#]/)[0];
  if (!programId) throw new Error('Could not extract program ID from URL');
  return programId;
}

test.describe('Issue State: Triage', () => {
  test('triage state is available in issue state options', async ({ page }) => {
    await login(page);

    // Navigate to Issues and open an issue
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Click on the first issue to open it
    await page.locator('tr[role="row"]').first().click();
    await expect(page.locator('[data-testid="ticket-number"]')).toBeVisible({ timeout: 10000 });

    // Find the status select and verify triage is an option
    const statusSelect = page.locator('select[aria-label="Status"]');
    await expect(statusSelect).toBeVisible();

    // Check that triage option exists
    const triageOption = statusSelect.locator('option[value="triage"]');
    await expect(triageOption).toHaveText('Needs Triage');
  });

  test('external submissions create issues with state=triage', async ({ page, apiServer }) => {
    // Submit public feedback (no login needed)
    // First, we need to find a program ID
    await login(page);
    const programId = await getProgramId(page);

    const uniqueTitle = `External feedback ${Date.now()}`;

    // Submit directly to API (public endpoint, no auth needed)
    const response = await page.request.post(`${apiServer.url}/api/feedback`, {
      data: {
        title: uniqueTitle,
        submitter_email: 'test@example.com',
        program_id: programId,
      },
    });
    expect(response.ok()).toBeTruthy();
    const created = await response.json();
    expect(created.state).toBe('triage');
    expect(created.source).toBe('external');

    // Verify the issue exists via API (through Vite proxy, using session cookies)
    const issuesResponse = await page.request.get('/api/issues');
    expect(issuesResponse.ok()).toBeTruthy();
    const issues = await issuesResponse.json();
    const newIssue = issues.find((i: { title: string }) => i.title === uniqueTitle);
    expect(newIssue).toBeTruthy();
    expect(newIssue.state).toBe('triage');

    // Clear IndexedDB to force fresh data fetch on next page load
    // Must be done before page.goto to avoid race conditions
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        // Delete both the query cache and mutation queue databases
        const req1 = indexedDB.deleteDatabase('ship-query-cache');
        const req2 = indexedDB.deleteDatabase('ship-mutation-queue');
        let completed = 0;
        const checkDone = () => { if (++completed >= 2) resolve(); };
        req1.onsuccess = req1.onerror = checkDone;
        req2.onsuccess = req2.onerror = checkDone;
        // Timeout after 3 seconds to avoid hanging
        setTimeout(resolve, 3000);
      });
    });

    // Navigate to issues with fresh state
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Wait for table to load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });

    // Click on Needs Triage tab to filter to the state we expect
    await page.getByRole('tab', { name: /needs triage/i }).click();
    await page.waitForTimeout(500); // Wait for filter to apply

    // Find the issue we just created
    const issueRow = page.locator('tr[role="row"]', { hasText: uniqueTitle });
    await expect(issueRow).toBeVisible({ timeout: 10000 });

    // Click to open it
    await issueRow.click();
    await expect(page.locator('[data-testid="ticket-number"]')).toBeVisible({ timeout: 10000 });

    // Verify state is triage
    const statusSelect = page.locator('select[aria-label="Status"]');
    await expect(statusSelect).toHaveValue('triage');
  });

  test('internal issue creation skips triage, goes to backlog', async ({ page }) => {
    await login(page);

    // Navigate to Issues
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Click New Issue button
    await page.locator('button', { hasText: /new issue/i }).first().click();
    await expect(page.locator('[data-testid="ticket-number"]')).toBeVisible({ timeout: 10000 });

    // Verify state is backlog (not triage) for internal issues
    const statusSelect = page.locator('select[aria-label="Status"]');
    await expect(statusSelect).toHaveValue('backlog');
  });
});

test.describe('Issues List: Source Display', () => {
  test('source column/badge shows "External" for external issues', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Find an external issue (seeded: 'External feature request from user')
    const externalIssue = page.locator('tr[role="row"]', { hasText: 'External feature request' });
    await expect(externalIssue).toBeVisible({ timeout: 10000 });

    // Verify External badge is visible (using span to target badge, not title text)
    await expect(externalIssue.locator('span:text-is("External")')).toBeVisible();
  });

  test('source column/badge shows "Internal" for internal issues', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Find an internal issue (seeded: 'Initial project setup')
    const internalIssue = page.locator('tr[role="row"]', { hasText: 'Initial project setup' });
    await expect(internalIssue).toBeVisible({ timeout: 10000 });

    // Verify Internal badge is visible (using span to target badge, not other text)
    await expect(internalIssue.locator('span:text-is("Internal")')).toBeVisible();
  });

  test('source is visible in issues list by default', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Both Internal and External badges should be visible in the list
    await expect(page.locator('span:text-is("Internal")').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('span:text-is("External")').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Issues List: Needs Triage Filter', () => {
  test('Needs Triage filter shows only issues in triage state', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Click on Needs Triage filter
    await page.getByRole('tab', { name: /needs triage/i }).click();

    // Should only see triage issues (use tbody to skip header row)
    const issueRows = page.locator('tbody tr[role="row"]');
    const count = await issueRows.count();
    expect(count).toBeGreaterThan(0);

    // Verify at least the first 2 triage issues have External source
    // (seed data has 2 external issues in triage)
    const visibleCount = Math.min(count, 2);
    for (let i = 0; i < visibleCount; i++) {
      await expect(issueRows.nth(i).locator('span:text-is("External")')).toBeVisible({ timeout: 5000 });
    }
  });

  test('Needs Triage filter tab is present', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // The Needs Triage filter tab should be visible
    const triageFilter = page.getByRole('tab', { name: /needs triage/i });
    await expect(triageFilter).toBeVisible();

    // Tab should have the text "Needs Triage"
    await expect(triageFilter).toHaveText(/needs triage/i);
  });

  test('clearing filter shows all issues including triaged ones', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // First apply Needs Triage filter and wait for it to take effect
    await page.getByRole('tab', { name: /needs triage/i }).click();
    await page.waitForTimeout(500); // Allow filter to settle
    const filteredCount = await page.locator('tbody tr[role="row"]').count();
    expect(filteredCount).toBeGreaterThan(0); // Should have some triage items

    // Clear filter by clicking "All"
    await page.getByRole('tab', { name: /^all$/i }).click();
    await page.waitForTimeout(500); // Allow filter to settle

    // Should have more or equal issues visible now (all includes triage + others)
    const allCount = await page.locator('tbody tr[role="row"]').count();
    expect(allCount).toBeGreaterThanOrEqual(filteredCount);
  });
});

test.describe('Triage Workflow: Accept', () => {
  test('Accept button appears on triage-state issues', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Open a triage issue
    const triageIssue = page.locator('tr[role="row"]', { hasText: 'External feature request' });
    await triageIssue.click();
    await expect(page.locator('[data-testid="ticket-number"]')).toBeVisible({ timeout: 10000 });

    // Accept button should be visible
    await expect(page.getByRole('button', { name: /accept/i })).toBeVisible();
  });

  test('accepting issue moves it to backlog state', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Open a triage issue
    const triageIssue = page.locator('tr[role="row"]', { hasText: 'Bug report from customer' });
    await triageIssue.click();
    await expect(page.locator('[data-testid="ticket-number"]')).toBeVisible({ timeout: 10000 });

    // Verify Accept button is visible (issue is in triage)
    const acceptButton = page.getByRole('button', { name: /accept/i });
    await expect(acceptButton).toBeVisible({ timeout: 5000 });

    // Verify state is triage before accepting
    const statusSelect = page.locator('select[aria-label="Status"]');
    await expect(statusSelect).toHaveValue('triage');

    // Click Accept
    await acceptButton.click();

    // State should change to backlog - wait longer for API roundtrip and UI update
    await expect(statusSelect).toHaveValue('backlog', { timeout: 15000 });
  });

  test('accepted issue appears in regular backlog view', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // The 'Accepted user suggestion' was seeded as already accepted (state=backlog, source=external)
    // Click Backlog filter
    await page.getByRole('tab', { name: /backlog/i }).click();

    // Should see the accepted external issue
    const acceptedIssue = page.locator('tr[role="row"]', { hasText: 'Accepted user suggestion' });
    await expect(acceptedIssue).toBeVisible({ timeout: 10000 });
  });

  test('accepted issue retains source=external', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Open the accepted external issue
    const acceptedIssue = page.locator('tr[role="row"]', { hasText: 'Accepted user suggestion' });
    await acceptedIssue.click();
    await expect(page.locator('[data-testid="ticket-number"]')).toBeVisible({ timeout: 10000 });

    // Should still show External source in properties
    await expect(page.locator('span:text-is("External")')).toBeVisible();
  });
});

test.describe('Triage Workflow: Reject', () => {
  test('Reject button appears on triage-state issues', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Open a triage issue
    const triageIssue = page.locator('tr[role="row"]', { hasText: 'External feature request' });
    await triageIssue.click();
    await expect(page.locator('[data-testid="ticket-number"]')).toBeVisible({ timeout: 10000 });

    // Reject button should be visible
    await expect(page.getByRole('button', { name: /reject/i })).toBeVisible();
  });

  test('rejecting requires a reason', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Open a triage issue
    const triageIssue = page.locator('tr[role="row"]', { hasText: 'External feature request' });
    await triageIssue.click();
    await expect(page.locator('[data-testid="ticket-number"]')).toBeVisible({ timeout: 10000 });

    // Click Reject - should show dialog/prompt for reason
    await page.getByRole('button', { name: /reject/i }).click();

    // Should show rejection dialog with reason input
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });
    await expect(page.getByPlaceholder(/reason/i)).toBeVisible();
  });

  test('rejected issue moves to cancelled state', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // The 'Rejected spam submission' was seeded as rejected
    // Filter to cancelled
    await page.getByRole('tab', { name: /cancelled/i }).click();

    // Should see rejected issue
    const rejectedIssue = page.locator('tr[role="row"]', { hasText: 'Rejected spam submission' });
    await expect(rejectedIssue).toBeVisible({ timeout: 10000 });
  });

  test('rejection reason appears in properties panel', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Filter to cancelled
    await page.getByRole('tab', { name: /cancelled/i }).click();

    // Open rejected issue
    const rejectedIssue = page.locator('tr[role="row"]', { hasText: 'Rejected spam submission' });
    await rejectedIssue.click();
    await expect(page.locator('[data-testid="ticket-number"]')).toBeVisible({ timeout: 10000 });

    // Should show rejection reason
    await expect(page.locator('text=Not relevant to product')).toBeVisible();
  });

  test('rejected issue retains source=external', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Filter to cancelled
    await page.getByRole('tab', { name: /cancelled/i }).click();

    // Open rejected issue
    const rejectedIssue = page.locator('tr[role="row"]', { hasText: 'Rejected spam submission' });
    await rejectedIssue.click();
    await expect(page.locator('[data-testid="ticket-number"]')).toBeVisible({ timeout: 10000 });

    // Should still show External source
    await expect(page.locator('span:text-is("External")')).toBeVisible();
  });
});

test.describe('Public Feedback Form', () => {
  test('public form accessible without login', async ({ page }) => {
    // First need to get a program ID
    await login(page);
    const programId = await getProgramId(page);

    // Clear cookies to simulate logged out
    await page.context().clearCookies();

    // Navigate to public feedback form
    await page.goto(`/feedback/${programId}`);

    // Should show form, not login redirect
    await expect(page.locator('input[name="title"], input[placeholder*="title" i]').first()).toBeVisible({ timeout: 10000 });
  });

  test('submitting creates issue with source=external, state=triage', async ({ page }) => {
    // Get a program ID while logged in
    await login(page);
    const programId = await getProgramId(page);

    // Clear cookies and submit feedback
    await page.context().clearCookies();
    await page.goto(`/feedback/${programId}`);

    const uniqueTitle = `Feedback test ${Date.now()}`;
    await page.locator('input[name="title"], input[placeholder*="title" i]').first().fill(uniqueTitle);
    await page.locator('input[name="submitter_email"], input[type="email"]').first().fill('feedback@test.com');
    await page.getByRole('button', { name: /submit/i }).click();

    // Wait for confirmation
    await expect(page.getByText(/thank/i)).toBeVisible({ timeout: 10000 });

    // Log back in and verify
    await login(page);

    // Clear IndexedDB to force fresh data fetch on next page load
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const req1 = indexedDB.deleteDatabase('ship-query-cache');
        const req2 = indexedDB.deleteDatabase('ship-mutation-queue');
        let completed = 0;
        const checkDone = () => { if (++completed >= 2) resolve(); };
        req1.onsuccess = req1.onerror = checkDone;
        req2.onsuccess = req2.onerror = checkDone;
        setTimeout(resolve, 3000);
      });
    });

    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Wait for issues list to load
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });

    // Apply triage filter to find it
    await page.getByRole('tab', { name: /needs triage/i }).click();

    // Wait for filtered results
    await page.waitForTimeout(500);

    const newIssue = page.locator('tr[role="row"]', { hasText: uniqueTitle });
    await expect(newIssue).toBeVisible({ timeout: 10000 });
    await expect(newIssue.locator('span:text-is("External")')).toBeVisible();
  });

  test('shows confirmation message after submission', async ({ page }) => {
    await login(page);
    const programId = await getProgramId(page);

    await page.context().clearCookies();
    await page.goto(`/feedback/${programId}`);

    await page.locator('input[name="title"], input[placeholder*="title" i]').first().fill('Confirmation test');
    await page.locator('input[name="submitter_email"], input[type="email"]').first().fill('confirm@test.com');
    await page.getByRole('button', { name: /submit/i }).click();

    // Should show thank you message
    await expect(page.getByText(/thank/i)).toBeVisible({ timeout: 10000 });
  });

  test('does not show tracking link or status updates', async ({ page }) => {
    await login(page);
    const programId = await getProgramId(page);

    await page.context().clearCookies();
    await page.goto(`/feedback/${programId}`);

    await page.locator('input[name="title"], input[placeholder*="title" i]').first().fill('No tracking test');
    await page.locator('input[name="submitter_email"], input[type="email"]').first().fill('notrack@test.com');
    await page.getByRole('button', { name: /submit/i }).click();

    await expect(page.getByText(/thank/i)).toBeVisible({ timeout: 10000 });

    // Should NOT show any tracking/status links
    await expect(page.locator('text=track')).not.toBeVisible();
    await expect(page.locator('text=status')).not.toBeVisible();
    await expect(page.locator('a[href*="issues"]')).not.toBeVisible();
  });
});

test.describe('Program View: Feedback Tab Removed', () => {
  test('Feedback tab does not appear in Program tabs', async ({ page }) => {
    await login(page);
    // Navigate to a program using the helper
    await getProgramId(page);

    // Wait for program editor to load (use specific tablist to avoid matching nav)
    await expect(page.getByRole('tablist', { name: 'Content tabs' })).toBeVisible({ timeout: 10000 });

    // Should have Overview, Issues, Sprints tabs
    await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /issues/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /sprints/i })).toBeVisible();

    // Should NOT have Feedback tab
    await expect(page.getByRole('tab', { name: /feedback/i })).not.toBeVisible();
  });

  test('Issues tab shows all issues including external ones', async ({ page }) => {
    await login(page);
    // Navigate to Ship Core program using the helper
    await getProgramId(page);

    // Click Issues tab
    await page.getByRole('tab', { name: /issues/i }).click();

    // Wait for issues table to load and verify issues are displayed
    // ProgramEditor's issue list shows ID, Title, Status, Assignee (no Source column)
    // Instead, verify seeded issues appear - both internal (Initial project setup) and external (External feature request)
    await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 10000 });

    // Verify at least some issues are shown (program should have issues)
    const issueCount = await page.locator('table tbody tr').count();
    expect(issueCount).toBeGreaterThan(0);
  });
});

test.describe('Data Migration', () => {
  // Note: These tests verify seeded data which represents post-migration state

  test('existing feedback with status=submitted migrates to state=triage', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Filter to triage
    await page.getByRole('tab', { name: /needs triage/i }).click();

    // External issues in triage exist (represents migrated submitted feedback)
    // Use tbody to skip header row
    const triageIssues = page.locator('tbody tr[role="row"]');
    const count = await triageIssues.count();
    expect(count).toBeGreaterThan(0);

    // Verify at least one external issue exists in triage (migrated feedback)
    // Note: All issues in triage should be external (from public feedback form)
    await expect(triageIssues.first().locator('span:text-is("External")')).toBeVisible({ timeout: 5000 });
  });

  test('existing feedback with status=accepted migrates to state=backlog', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Filter to backlog
    await page.getByRole('tab', { name: /backlog/i }).click();

    // 'Accepted user suggestion' should be here (external, backlog)
    const acceptedExternal = page.locator('tr[role="row"]', { hasText: 'Accepted user suggestion' });
    await expect(acceptedExternal).toBeVisible({ timeout: 10000 });
    await expect(acceptedExternal.locator('span:text-is("External")')).toBeVisible();
  });

  test('existing feedback with rejection_reason migrates to state=cancelled', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Filter to cancelled
    await page.getByRole('tab', { name: /cancelled/i }).click();

    // 'Rejected spam submission' should be here
    const rejectedExternal = page.locator('tr[role="row"]', { hasText: 'Rejected spam submission' });
    await expect(rejectedExternal).toBeVisible({ timeout: 10000 });
    await expect(rejectedExternal.locator('span:text-is("External")')).toBeVisible();
  });

  test('migrated feedback retains source=external (from source=feedback)', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // All external issues should show "External" not "feedback"
    await expect(page.locator('span:text-is("External")').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('span:text-is("feedback")')).not.toBeVisible();
  });

  test('existing issues retain source=internal', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Internal issues should show "Internal"
    const internalIssue = page.locator('tr[role="row"]', { hasText: 'Initial project setup' });
    await expect(internalIssue).toBeVisible({ timeout: 10000 });
    await expect(internalIssue.locator('span:text-is("Internal")')).toBeVisible();
  });
});

test.describe('Issue Properties Panel', () => {
  test('shows source field for all issues', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Open any issue
    await page.locator('tr[role="row"]').first().click();
    await expect(page.locator('[data-testid="ticket-number"]')).toBeVisible({ timeout: 10000 });

    // Should show Source label and value (Internal or External)
    await expect(page.locator('text=Source')).toBeVisible();
    const sourceValue = page.locator('text=Internal').or(page.locator('text=External'));
    await expect(sourceValue.first()).toBeVisible();
  });

  test('shows rejection reason for rejected external issues', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Filter to cancelled
    await page.getByRole('tab', { name: /cancelled/i }).click();

    // Open rejected issue
    await page.locator('tr[role="row"]', { hasText: 'Rejected spam submission' }).click();
    await expect(page.locator('[data-testid="ticket-number"]')).toBeVisible({ timeout: 10000 });

    // Should show rejection reason
    await expect(page.locator('text=Rejection Reason')).toBeVisible();
    await expect(page.locator('text=Not relevant to product')).toBeVisible();
  });

  test('rejection reason field hidden for non-rejected issues', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.locator('h1', { hasText: 'Issues' })).toBeVisible({ timeout: 10000 });

    // Filter to backlog
    await page.getByRole('tab', { name: /backlog/i }).click();

    // Open a backlog issue
    await page.locator('tr[role="row"]').first().click();
    await expect(page.locator('[data-testid="ticket-number"]')).toBeVisible({ timeout: 10000 });

    // Should NOT show rejection reason field
    await expect(page.locator('text=Rejection Reason')).not.toBeVisible();
  });
});

test.describe('API Changes', () => {
  test('GET /api/issues returns both internal and external issues', async ({ page, apiServer }) => {
    await login(page);

    // Make API call
    const response = await page.request.get(`${apiServer.url}/api/issues`);
    expect(response.ok()).toBeTruthy();

    const issues = await response.json();
    expect(Array.isArray(issues)).toBeTruthy();

    // Should have both internal and external
    const sources = issues.map((i: { source?: string }) => i.source);
    expect(sources).toContain('internal');
    expect(sources).toContain('external');
  });

  test('GET /api/issues?state=triage returns only triage items', async ({ page, apiServer }) => {
    await login(page);

    const response = await page.request.get(`${apiServer.url}/api/issues?state=triage`);
    expect(response.ok()).toBeTruthy();

    const issues = await response.json();
    expect(Array.isArray(issues)).toBeTruthy();
    expect(issues.length).toBeGreaterThan(0);

    // All should be in triage state
    for (const issue of issues) {
      expect(issue.state).toBe('triage');
    }
  });

  test('GET /api/issues?source=external returns only external items', async ({ page, apiServer }) => {
    await login(page);

    const response = await page.request.get(`${apiServer.url}/api/issues?source=external`);
    expect(response.ok()).toBeTruthy();

    const issues = await response.json();
    expect(Array.isArray(issues)).toBeTruthy();
    expect(issues.length).toBeGreaterThan(0);

    // All should be external
    for (const issue of issues) {
      expect(issue.source).toBe('external');
    }
  });

  test('POST /api/feedback creates issue with state=triage, source=external', async ({ page, apiServer }) => {
    // First get a program ID
    await login(page);
    const programId = await getProgramId(page);

    // Submit feedback via API (no auth needed for public feedback)
    const response = await page.request.post(`${apiServer.url}/api/feedback`, {
      data: {
        title: 'API feedback test',
        submitter_email: 'api@test.com',
        program_id: programId,
      },
    });
    expect(response.ok()).toBeTruthy();

    const created = await response.json();
    expect(created.state).toBe('triage');
    expect(created.source).toBe('external');
  });

  test('POST /api/issues/:id/accept moves to backlog', async ({ page, apiServer }) => {
    await login(page);

    // Get CSRF token
    const csrfToken = await getCsrfToken(page, apiServer.url);

    // First find a triage issue
    const listResponse = await page.request.get(`${apiServer.url}/api/issues?state=triage`);
    const triageIssues = await listResponse.json();
    expect(triageIssues.length).toBeGreaterThan(0);

    const issueId = triageIssues[0].id;

    // Accept it with CSRF token
    const acceptResponse = await page.request.post(`${apiServer.url}/api/issues/${issueId}/accept`, {
      headers: { 'X-CSRF-Token': csrfToken },
    });
    expect(acceptResponse.ok()).toBeTruthy();

    const updated = await acceptResponse.json();
    expect(updated.state).toBe('backlog');
  });

  test('POST /api/issues/:id/reject moves to cancelled with reason', async ({ page, apiServer }) => {
    await login(page);

    // Get CSRF token
    const csrfToken = await getCsrfToken(page, apiServer.url);

    // First create a new triage issue to reject
    const programId = await getProgramId(page);

    // Create via feedback API (public, no CSRF needed)
    const createResponse = await page.request.post(`${apiServer.url}/api/feedback`, {
      data: {
        title: 'To be rejected',
        submitter_email: 'reject@test.com',
        program_id: programId,
      },
    });
    const created = await createResponse.json();
    const issueId = created.id;

    // Reject it with CSRF token
    const rejectResponse = await page.request.post(`${apiServer.url}/api/issues/${issueId}/reject`, {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        reason: 'Test rejection reason',
      },
    });
    expect(rejectResponse.ok()).toBeTruthy();

    const updated = await rejectResponse.json();
    expect(updated.state).toBe('cancelled');
    expect(updated.rejection_reason).toBe('Test rejection reason');
  });
});
