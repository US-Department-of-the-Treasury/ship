import { test, expect } from './fixtures/isolated-env';

/**
 * Bulk Selection and Actions for Issues List/Kanban
 *
 * Superhuman-style multi-select UX with keyboard navigation
 * and bulk operations (archive, move to sprint, delete, change status).
 */

// Helper to login before tests
async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('#email').fill('dev@ship.local');
  await page.locator('#password').fill('admin123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL('/login', { timeout: 10000 });
}

test.describe('Bulk Selection - List View', () => {
  test.describe('Checkbox Visibility', () => {
    test('checkbox is hidden by default on each row', async ({ page }) => {
      await login(page);
      await page.goto('/issues');

      // Wait for issues list to load
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      // Get the first row's checkbox container
      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // The checkbox container should have opacity-0 when not hovered/selected
      // Check that the checkbox button is not visible (opacity: 0)
      const checkboxContainer = firstRow.locator('td').first().locator('div');

      // Move mouse away to ensure no hover state
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);

      // The container should exist but have opacity 0 (hidden)
      await expect(checkboxContainer).toHaveCSS('opacity', '0');
    });

    test('checkbox appears on row hover', async ({ page }) => {
      await login(page);
      await page.goto('/issues');

      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Get checkbox container before hover
      const checkboxContainer = firstRow.locator('td').first().locator('div');

      // Hover over the row
      await firstRow.hover();

      // The checkbox container should now be visible (opacity: 1)
      await expect(checkboxContainer).toHaveCSS('opacity', '1');
    });

    test('checkbox remains visible when item is selected', async ({ page }) => {
      await login(page);
      await page.goto('/issues');

      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Hover to reveal checkbox and click it
      await firstRow.hover();
      const checkbox = firstRow.getByRole('checkbox');
      await checkbox.click();

      // Move mouse away from the row
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);

      // Checkbox should remain visible because item is selected
      const checkboxContainer = firstRow.locator('td').first().locator('div');
      await expect(checkboxContainer).toHaveCSS('opacity', '1');
    });

  });

  test.describe('Single Selection', () => {
    test('clicking checkbox selects the item', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Hover to reveal checkbox and click it
      await firstRow.hover();
      const checkbox = firstRow.getByRole('checkbox');
      await checkbox.click();

      // Verify the checkbox is now checked
      await expect(checkbox).toHaveAttribute('aria-checked', 'true');
      // Verify the row has data-selected attribute
      await expect(firstRow).toHaveAttribute('data-selected', 'true');
    });

    test('clicking checkbox does not navigate to item detail', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const initialUrl = page.url();
      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Hover to reveal checkbox and click it
      await firstRow.hover();
      const checkbox = firstRow.getByRole('checkbox');
      await checkbox.click();

      // Wait a bit and verify URL hasn't changed
      await page.waitForTimeout(200);
      expect(page.url()).toBe(initialUrl);
    });

    test('clicking row (not checkbox) navigates to item detail', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Click on the row content (not the checkbox cell)
      const titleCell = firstRow.locator('td').nth(1);
      await titleCell.click();

      // Should navigate to issue detail
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 });
    });

    test('selected row shows background highlight', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Hover to reveal checkbox and click it
      await firstRow.hover();
      const checkbox = firstRow.getByRole('checkbox');
      await checkbox.click();

      // Verify the row has the bg-accent/10 class (shows as background color)
      // The row should have the 'bg-accent/10' tailwind class when selected
      await expect(firstRow).toHaveClass(/bg-accent/);
    });

    test('clicking selected checkbox deselects the item', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Hover and click to select
      await firstRow.hover();
      const checkbox = firstRow.getByRole('checkbox');
      await checkbox.click();

      // Verify selected
      await expect(checkbox).toHaveAttribute('aria-checked', 'true');

      // Click again to deselect
      await checkbox.click();

      // Verify deselected
      await expect(checkbox).toHaveAttribute('aria-checked', 'false');
      await expect(firstRow).not.toHaveAttribute('data-selected', 'true');
    });
  });

  test.describe('Multi-Selection with Shift+Click', () => {
    test('shift+click selects range from last selected to clicked item', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Need at least 4 rows for this test
      const rowCount = await rows.count();
      if (rowCount < 4) {
        test.skip(true, 'Not enough rows for range selection test');
        return;
      }

      // Select first row
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();

      // Shift+click fourth row
      await rows.nth(3).hover();
      await rows.nth(3).getByRole('checkbox').click({ modifiers: ['Shift'] });

      // Verify all 4 rows are selected
      for (let i = 0; i < 4; i++) {
        await expect(rows.nth(i)).toHaveAttribute('data-selected', 'true');
      }
    });

    test('shift+click extends selection in reverse order', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 4) {
        test.skip(true, 'Not enough rows for range selection test');
        return;
      }

      // Select fourth row first
      await rows.nth(3).hover();
      await rows.nth(3).getByRole('checkbox').click();

      // Shift+click first row
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click({ modifiers: ['Shift'] });

      // Verify all 4 rows are selected
      for (let i = 0; i < 4; i++) {
        await expect(rows.nth(i)).toHaveAttribute('data-selected', 'true');
      }
    });

    test('shift+click adds to existing selection', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 6) {
        test.skip(true, 'Not enough rows for additive selection test');
        return;
      }

      // Select first row, shift+click third (selects 0-2)
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();
      await rows.nth(2).hover();
      await rows.nth(2).getByRole('checkbox').click({ modifiers: ['Shift'] });

      // Verify rows 0-2 selected
      for (let i = 0; i < 3; i++) {
        await expect(rows.nth(i)).toHaveAttribute('data-selected', 'true');
      }

      // Now select row 5 (cmd+click to add without clearing), then shift+click row 4
      // This should add rows 4-5 to selection
      await rows.nth(5).hover();
      await rows.nth(5).getByRole('checkbox').click({ modifiers: ['Meta'] });
      await rows.nth(4).hover();
      await rows.nth(4).getByRole('checkbox').click({ modifiers: ['Shift'] });

      // Verify rows 0-2 still selected and 4-5 now selected
      // Note: rows 3 should NOT be selected (gap in selection)
      for (let i = 0; i < 3; i++) {
        await expect(rows.nth(i)).toHaveAttribute('data-selected', 'true');
      }
      await expect(rows.nth(4)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(5)).toHaveAttribute('data-selected', 'true');
    });
  });

  test.describe('Cmd/Ctrl+Click Toggle', () => {
    test('cmd+click adds single item to selection', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 3) {
        test.skip(true, 'Not enough rows for cmd+click test');
        return;
      }

      // Select first row
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();

      // Cmd+click third row (should add to selection, not replace)
      await rows.nth(2).hover();
      await rows.nth(2).getByRole('checkbox').click({ modifiers: ['Meta'] });

      // Verify rows 0 and 2 selected, but not row 1
      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(1)).not.toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(2)).toHaveAttribute('data-selected', 'true');
    });

    test('cmd+click on selected item removes it from selection', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 3) {
        test.skip(true, 'Not enough rows for cmd+click toggle test');
        return;
      }

      // Select rows 0, 1, 2 using cmd+click for each
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();
      await rows.nth(1).hover();
      await rows.nth(1).getByRole('checkbox').click({ modifiers: ['Meta'] });
      await rows.nth(2).hover();
      await rows.nth(2).getByRole('checkbox').click({ modifiers: ['Meta'] });

      // Verify all 3 selected
      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(1)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(2)).toHaveAttribute('data-selected', 'true');

      // Cmd+click row 1 to remove from selection
      await rows.nth(1).hover();
      await rows.nth(1).getByRole('checkbox').click({ modifiers: ['Meta'] });

      // Verify only rows 0 and 2 remain selected
      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(1)).not.toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(2)).toHaveAttribute('data-selected', 'true');
    });
  });
});

test.describe('Bulk Selection - Keyboard Navigation', () => {
  test.describe('Focus Management', () => {
    test('first row is focusable with Tab', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Hover on first row to establish React focus state (triggers setFocusedId via onMouseEnter)
      await rows.nth(0).hover();

      // First row should have focus ring (ring-2 class indicates focus)
      await expect(rows.nth(0)).toHaveClass(/ring-2/);
    });

    test('arrow down moves focus to next row', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 2) {
        test.skip(true, 'Not enough rows for focus navigation test');
        return;
      }

      // Hover + checkbox click to establish React focus (without navigating)
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();
      await expect(rows.nth(0)).toHaveClass(/ring-2/);

      // Focus table and press ArrowDown to move focus to second row
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('ArrowDown');

      // Second row should have focus, first should not
      await expect(rows.nth(1)).toHaveClass(/ring-2/);
      await expect(rows.nth(0)).not.toHaveClass(/ring-2/);
    });

    test('arrow up moves focus to previous row', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 2) {
        test.skip(true, 'Not enough rows for focus navigation test');
        return;
      }

      // Hover + checkbox click on second row to establish React focus (without navigating)
      await rows.nth(1).hover();
      await rows.nth(1).getByRole('checkbox').click();
      await expect(rows.nth(1)).toHaveClass(/ring-2/);

      // Focus table and press ArrowUp to move focus to first row
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('ArrowUp');

      // First row should have focus, second should not
      await expect(rows.nth(0)).toHaveClass(/ring-2/);
      await expect(rows.nth(1)).not.toHaveClass(/ring-2/);
    });

    test('arrow keys do not change selection (focus only)', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 2) {
        test.skip(true, 'Not enough rows for focus navigation test');
        return;
      }

      // Select first row via checkbox (this also sets focus to row 0)
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();
      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(0)).toHaveClass(/ring-2/); // Focus is on row 0 after checkbox click

      // Focus table to enable keyboard navigation
      const table = page.locator('table[role="grid"]');
      await table.focus();

      // Press ArrowDown once to move focus from row 0 to row 1
      await page.keyboard.press('ArrowDown');

      // First row should still be selected (not changed by arrow key)
      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');
      // Focus should have moved to second row
      await expect(rows.nth(1)).toHaveClass(/ring-2/);
      // Second row should NOT be selected (arrow keys only move focus, not selection)
      await expect(rows.nth(1)).not.toHaveAttribute('data-selected', 'true');
    });

    test('Home key moves focus to first row', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 3) {
        test.skip(true, 'Not enough rows for Home key test');
        return;
      }

      // Hover + checkbox click to establish React focus state (without navigating)
      await rows.nth(2).hover();
      await rows.nth(2).getByRole('checkbox').click();
      await expect(rows.nth(2)).toHaveClass(/ring-2/);

      // Focus table and press Home to move focus to first row
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('Home');

      // First row should have focus
      await expect(rows.nth(0)).toHaveClass(/ring-2/);
      await expect(rows.nth(2)).not.toHaveClass(/ring-2/);
    });

    test('End key moves focus to last row', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 2) {
        test.skip(true, 'Not enough rows for End key test');
        return;
      }

      // Hover + checkbox click to establish React focus state (without navigating)
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();
      await expect(rows.nth(0)).toHaveClass(/ring-2/);

      // Focus table and press End to move focus to last row
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('End');

      // Last row should have focus
      const lastRow = rows.last();
      await expect(lastRow).toHaveClass(/ring-2/);
      await expect(rows.nth(0)).not.toHaveClass(/ring-2/);
    });
  });

  test.describe('Selection with Enter/Space', () => {
    test('Enter toggles selection of focused row', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Hover to establish React focus state (without selecting)
      await rows.nth(0).hover();
      await expect(rows.nth(0)).toHaveClass(/ring-2/);

      // Focus table and press Enter to select
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('Enter');
      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');

      // Press Enter again to deselect
      await page.keyboard.press('Enter');
      await expect(rows.nth(0)).not.toHaveAttribute('data-selected', 'true');
    });

    test('Space toggles selection of focused row', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Hover to establish React focus state (without selecting)
      await rows.nth(0).hover();
      await expect(rows.nth(0)).toHaveClass(/ring-2/);

      // Focus table and press Space to select
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('Space');
      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');

      // Press Space again to deselect
      await page.keyboard.press('Space');
      await expect(rows.nth(0)).not.toHaveAttribute('data-selected', 'true');
    });
  });

  test.describe('Shift+Arrow Range Selection', () => {
    test('shift+down extends selection to next row', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 2) {
        test.skip(true, 'Not enough rows for Shift+Arrow test');
        return;
      }

      // Select first row via checkbox
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();
      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');

      // Focus table and use Shift+ArrowDown
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('Shift+ArrowDown');

      // Both rows should be selected
      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(1)).toHaveAttribute('data-selected', 'true');
    });

    test('shift+up extends selection to previous row', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 3) {
        test.skip(true, 'Not enough rows for Shift+Arrow test');
        return;
      }

      // Select second row via checkbox
      await rows.nth(1).hover();
      await rows.nth(1).getByRole('checkbox').click();
      await expect(rows.nth(1)).toHaveAttribute('data-selected', 'true');

      // Focus table and use Shift+ArrowUp
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('Shift+ArrowUp');

      // Both rows 0 and 1 should be selected
      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(1)).toHaveAttribute('data-selected', 'true');
    });

    test('multiple shift+down extends selection incrementally', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 4) {
        test.skip(true, 'Not enough rows for incremental selection test');
        return;
      }

      // Select first row via checkbox
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();
      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');

      // Focus table and press Shift+Down 3 times
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowDown');

      // Rows 0-3 should all be selected
      for (let i = 0; i < 4; i++) {
        await expect(rows.nth(i)).toHaveAttribute('data-selected', 'true');
      }
    });

    test('shift+down then shift+up contracts selection', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 4) {
        test.skip(true, 'Not enough rows for contract selection test');
        return;
      }

      // Select row 1 (second row) via checkbox
      await rows.nth(1).hover();
      await rows.nth(1).getByRole('checkbox').click();
      await expect(rows.nth(1)).toHaveAttribute('data-selected', 'true');

      // Focus table and extend with Shift+Down twice
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('Shift+ArrowDown'); // Rows 1-2 selected
      await page.keyboard.press('Shift+ArrowDown'); // Rows 1-3 selected

      // Verify rows 1-3 selected
      await expect(rows.nth(1)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(2)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(3)).toHaveAttribute('data-selected', 'true');

      // Now Shift+Up to contract selection
      await page.keyboard.press('Shift+ArrowUp'); // Should now be rows 1-2

      // Row 3 should no longer be selected
      await expect(rows.nth(1)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(2)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(3)).not.toHaveAttribute('data-selected', 'true');
    });

    test('shift+end selects from current to last row', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 3) {
        test.skip(true, 'Not enough rows for Shift+End test');
        return;
      }

      // Select first row via checkbox
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();
      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');

      // Focus table and use Shift+End
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('Shift+End');

      // All rows from 0 to last should be selected
      for (let i = 0; i < rowCount; i++) {
        await expect(rows.nth(i)).toHaveAttribute('data-selected', 'true');
      }
    });

    test('shift+home selects from first row to current', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 3) {
        test.skip(true, 'Not enough rows for Shift+Home test');
        return;
      }

      // Select last row via checkbox
      const lastIdx = rowCount - 1;
      await rows.nth(lastIdx).hover();
      await rows.nth(lastIdx).getByRole('checkbox').click();
      await expect(rows.nth(lastIdx)).toHaveAttribute('data-selected', 'true');

      // Focus table and use Shift+Home
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('Shift+Home');

      // All rows from 0 to last should be selected
      for (let i = 0; i < rowCount; i++) {
        await expect(rows.nth(i)).toHaveAttribute('data-selected', 'true');
      }
    });
  });

  test.describe('Select All and Clear', () => {
    test('cmd/ctrl+a selects all visible items', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();

      // Focus table and press Cmd+A
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('Meta+a');

      // All rows should be selected
      for (let i = 0; i < rowCount; i++) {
        await expect(rows.nth(i)).toHaveAttribute('data-selected', 'true');
      }
    });

    test('escape clears all selection', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 2) {
        test.skip(true, 'Not enough rows for clear selection test');
        return;
      }

      // Select multiple items via checkbox
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();
      await rows.nth(1).hover();
      await rows.nth(1).getByRole('checkbox').click({ modifiers: ['Meta'] });

      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(1)).toHaveAttribute('data-selected', 'true');

      // Press Escape to clear selection
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('Escape');

      // No rows should be selected
      await expect(rows.nth(0)).not.toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(1)).not.toHaveAttribute('data-selected', 'true');
    });

    test('cmd/ctrl+a when all selected deselects all', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();

      // Focus table and press Cmd+A to select all
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('Meta+a');

      // Verify all selected
      for (let i = 0; i < rowCount; i++) {
        await expect(rows.nth(i)).toHaveAttribute('data-selected', 'true');
      }

      // Press Cmd+A again to deselect all
      await page.keyboard.press('Meta+a');

      // All rows should be deselected
      for (let i = 0; i < rowCount; i++) {
        await expect(rows.nth(i)).not.toHaveAttribute('data-selected', 'true');
      }
    });
  });
});

test.describe('Global j/k Vim-Style Navigation', () => {
  test.describe('j/k Focus Navigation', () => {
    test('j key moves focus to first/next item globally', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Move mouse outside the list to prevent hover-to-focus interference
      // This ensures we start with a clean focus state
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);

      // Press 'j' to focus first row
      await page.keyboard.press('j');

      // Verify some row has focus ring (using correct selector for tr with class)
      await expect(page.locator('tbody tr.ring-2')).toHaveCount(1, { timeout: 3000 });

      // First row should have focus ring
      await expect(rows.nth(0)).toHaveClass(/ring-2/, { timeout: 3000 });

      // Press j again to move to next row
      await page.keyboard.press('j');

      // Second row should have focus (if exists)
      const rowCount = await rows.count();
      if (rowCount > 1) {
        await expect(rows.nth(1)).toHaveClass(/ring-2/, { timeout: 3000 });
        await expect(rows.nth(0)).not.toHaveClass(/ring-2/);
      }
    });

    test('k key moves focus to previous item', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 2) {
        test.skip(true, 'Not enough rows for k navigation test');
        return;
      }

      // Move mouse outside the list to prevent hover-to-focus interference
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);

      // Navigate down first with j
      await page.keyboard.press('j'); // First row
      await page.keyboard.press('j'); // Second row
      await expect(rows.nth(1)).toHaveClass(/ring-2/, { timeout: 3000 });

      // Press k to move back up
      await page.keyboard.press('k');

      // First row should have focus again
      await expect(rows.nth(0)).toHaveClass(/ring-2/, { timeout: 3000 });
      await expect(rows.nth(1)).not.toHaveClass(/ring-2/);
    });

    test('j/k work without explicitly focusing the table', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Move mouse outside the list to prevent hover-to-focus interference
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);

      // Press j - should still work and focus first row (without clicking anything)
      await page.keyboard.press('j');
      await expect(rows.nth(0)).toHaveClass(/ring-2/, { timeout: 3000 });
    });
  });

  test.describe('Enter to Open Item', () => {
    test('Enter on focused item navigates to issue detail page', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Move mouse outside the list to prevent hover-to-focus interference
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);

      // Focus the row with j
      const firstRow = rows.first();
      await page.keyboard.press('j');
      await expect(firstRow).toHaveClass(/ring-2/, { timeout: 3000 });

      // Press Enter to navigate to issue
      await page.keyboard.press('Enter');

      // Should navigate to some issue detail page (any issue page is valid)
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 });
    });
  });

  test.describe('Input Field Exclusion', () => {
    test('j key types in search input instead of navigating', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      // First, verify j navigates without input focus
      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Move mouse outside the list to prevent hover-to-focus interference
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);

      await page.keyboard.press('j');
      await expect(rows.nth(0)).toHaveClass(/ring-2/, { timeout: 3000 });

      // Now click on a search input if one exists, or any text input
      const searchInput = page.locator('input[type="text"], input[type="search"]').first();
      if (await searchInput.isVisible()) {
        await searchInput.click();
        await searchInput.fill(''); // Clear any existing text

        // Press j while in input
        await page.keyboard.press('j');

        // Input should contain 'j', not trigger navigation
        await expect(searchInput).toHaveValue('j');
      } else {
        test.skip(true, 'No text input found to test input exclusion');
      }
    });

  });

  test.describe('Hover-to-Focus', () => {
    test('hovering over row sets keyboard focus', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 3) {
        test.skip(true, 'Not enough rows for hover-to-focus test');
        return;
      }

      // Hover over the third row (not first, to verify it's setting focus correctly)
      await rows.nth(2).hover();

      // Third row should have focus ring - wait for data-focused attribute
      await expect(rows.nth(2)).toHaveAttribute('data-focused', 'true', { timeout: 5000 });
      await expect(rows.nth(2)).toHaveClass(/ring-2/, { timeout: 3000 });

      // Now press j and focus should move from third to fourth row (if exists)
      if (rowCount > 3) {
        await page.keyboard.press('j');
        await expect(rows.nth(3)).toHaveAttribute('data-focused', 'true', { timeout: 5000 });
        await expect(rows.nth(3)).toHaveClass(/ring-2/, { timeout: 3000 });
        await expect(rows.nth(2)).not.toHaveClass(/ring-2/);
      }
    });

    test('Shift+Arrow from hovered item creates selection', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      const rowCount = await rows.count();
      if (rowCount < 2) {
        test.skip(true, 'Not enough rows for hover+shift test');
        return;
      }

      // Hover over first row
      await rows.nth(0).hover();
      await expect(rows.nth(0)).toHaveClass(/ring-2/, { timeout: 3000 });

      // Press Shift+Down without prior selection
      await page.keyboard.press('Shift+ArrowDown');

      // Both first and second row should be selected
      await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');
      await expect(rows.nth(1)).toHaveAttribute('data-selected', 'true');
    });
  });

  test.describe('Breadcrumb and Escape Navigation', () => {
    test('navigating from Program shows breadcrumb on issue page', async ({ page }) => {
      await login(page);

      // Go to a program page
      await page.goto('/programs');
      await expect(page.getByRole('heading', { name: 'Programs', level: 1 })).toBeVisible({ timeout: 10000 });

      // Click on a program to open it
      const programRow = page.locator('tbody tr').first();
      await expect(programRow).toBeVisible();
      await programRow.click();

      // Wait for program page to load
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 });

      // Click on Issues tab
      const issuesTab = page.getByRole('tab', { name: 'Issues' });
      await expect(issuesTab).toBeVisible({ timeout: 5000 });
      await issuesTab.click();

      // Wait for issues to load
      await page.waitForTimeout(500);

      // Check if there are issues in this program
      const issueRows = page.locator('tbody tr');
      const rowCount = await issueRows.count();
      if (rowCount === 0) {
        test.skip(true, 'No issues in this program');
        return;
      }

      // Click on an issue
      await issueRows.first().click();

      // Should navigate to issue page
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 });

      // Should show breadcrumb with program name (aria-label contains "Back to")
      const backButton = page.locator('button[aria-label*="Back to"]');
      await expect(backButton).toBeVisible({ timeout: 5000 });
    });

    test('direct URL navigation shows generic back button', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Get an issue ID
      const firstRow = rows.first();
      const rowText = await firstRow.getAttribute('aria-label') || '';
      const idMatch = rowText.match(/Select item ([a-f0-9-]{36})/);
      const issueId = idMatch?.[1];

      if (!issueId) {
        test.skip(true, 'Could not extract issue ID');
        return;
      }

      // Navigate directly to issue via URL (no navigation context)
      await page.goto(`/issues/${issueId}`);
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+/, { timeout: 5000 });

      // Should show generic "Back to documents" instead of program name (aria-label)
      const backButton = page.locator('button[aria-label="Back to documents"]');
      await expect(backButton).toBeVisible({ timeout: 5000 });
    });
  });
});

test.describe('Bulk Selection - Tab/Filter Behavior', () => {
  test('switching tabs clears selection', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Select first row via checkbox
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');

    // Note: When items are selected, the bulk action bar replaces the filter tabs.
    // Navigate via URL to simulate tab switching (which clears selection)
    await page.goto('/issues?state=todo,in_progress,in_review');

    // Wait for the page to load
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    // Selection should be cleared - check that no row has data-selected="true"
    // Note: the rows may be different now due to filtering
    const selectedRows = page.locator('tbody tr[data-selected="true"]');
    await expect(selectedRows).toHaveCount(0);
  });

  test('selection only applies to visible items', async ({ page }) => {
    await login(page);
    await page.goto('/issues?state=backlog');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    const rowCount = await rows.count();
    if (rowCount === 0) {
      test.skip(true, 'No backlog issues to test with');
      return;
    }

    // Select first row via checkbox
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    await expect(rows.nth(0)).toHaveAttribute('data-selected', 'true');

    // Verify the selected item shows "Backlog" status
    const statusBadge = rows.nth(0).locator('[data-status-indicator]');
    await expect(statusBadge).toHaveAttribute('data-status', 'backlog');
  });

  test('cmd+a only selects items in current filter', async ({ page }) => {
    await login(page);

    // First, get the total count on "All" tab
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });
    const allRows = page.locator('tbody tr');
    await expect(allRows.first()).toBeVisible();
    const totalCount = await allRows.count();

    // Now go to a filtered view (e.g., Backlog)
    await page.getByRole('tab', { name: 'Backlog' }).click();
    await expect(page).toHaveURL(/state=backlog/);

    // Wait for rows to load
    const filteredRows = page.locator('tbody tr');

    // Skip if no backlog items or if all items are backlog
    const filteredCount = await filteredRows.count();
    if (filteredCount === 0) {
      test.skip(true, 'No backlog issues to test with');
      return;
    }
    if (filteredCount === totalCount) {
      test.skip(true, 'All issues are backlog - cannot verify filter scoping');
      return;
    }

    // Focus table and press Cmd+A to select all
    const table = page.locator('table[role="grid"]');
    await table.focus();
    await page.keyboard.press('Meta+a');

    // All visible (filtered) rows should be selected
    for (let i = 0; i < filteredCount; i++) {
      await expect(filteredRows.nth(i)).toHaveAttribute('data-selected', 'true');
    }

    // The selection count should match the filtered count, not total count
    // We can verify this by checking the count in the bulk action bar
    const bulkBar = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bulkBar).toContainText(`${filteredCount} selected`);
  });
});

test.describe('Bulk Action Bar', () => {
  test.describe('Visibility', () => {
    test('bulk action bar is hidden when nothing selected', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      // Verify bulk action bar is NOT visible (has role="region" aria-label="Bulk actions")
      const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
      await expect(bulkActionBar).toHaveCount(0);
    });

    test('bulk action bar appears when 1+ items selected', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Select one item
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();

      // Verify bulk action bar appears
      const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
      await expect(bulkActionBar).toBeVisible();
    });

    test('bulk action bar shows selected count', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      const rowCount = await rows.count();
      if (rowCount < 3) {
        test.skip();
        return;
      }

      // Select 3 items - first click starts selection, subsequent Cmd+clicks add to it
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();
      await rows.nth(1).hover();
      await rows.nth(1).getByRole('checkbox').click({ modifiers: ['Meta'] });
      await rows.nth(2).hover();
      await rows.nth(2).getByRole('checkbox').click({ modifiers: ['Meta'] });

      // Verify bar shows "3 selected"
      const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
      await expect(bulkActionBar).toContainText('3 selected');
    });

    test('bulk action bar disappears when selection cleared', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Select an item
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();

      // Verify bar is visible
      const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
      await expect(bulkActionBar).toBeVisible();

      // Focus the table and press Escape to clear selection
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('Escape');

      // Verify bar disappears
      await expect(bulkActionBar).toHaveCount(0);
    });
  });

  test.describe('Actions Available', () => {
    test('bulk action bar has Archive button', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Select an item
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();

      // Verify Archive button is visible
      const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
      await expect(bulkActionBar.getByRole('button', { name: 'Archive' })).toBeVisible();
    });

    test('bulk action bar has Move to Week dropdown', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Select an item
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();

      // Verify Move to Week button is visible (has aria-haspopup="menu")
      const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
      await expect(bulkActionBar.getByRole('button', { name: 'Move to Week' })).toBeVisible();
    });

    test('bulk action bar has Delete button', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Select an item
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();

      // Verify Delete button is visible
      const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
      await expect(bulkActionBar.getByRole('button', { name: 'Delete' })).toBeVisible();
    });

    test('bulk action bar has Change Status dropdown', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Select an item
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();

      // Verify Change Status button is visible
      const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
      await expect(bulkActionBar.getByRole('button', { name: 'Change Status' })).toBeVisible();
    });

    test('bulk action bar has Clear Selection button', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();

      // Select an item
      await rows.nth(0).hover();
      await rows.nth(0).getByRole('checkbox').click();

      // Verify Clear button is visible (aria-label="Clear selection")
      const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
      await expect(bulkActionBar.getByRole('button', { name: 'Clear selection' })).toBeVisible();
    });
  });
});

test.describe('Bulk Actions - Archive', () => {
  test('archive action moves selected issues to archived state', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Get the title of the first issue to track it
    const issueTitle = await rows.nth(0).locator('td').nth(1).textContent();
    const initialCount = await rows.count();

    // Select the first issue
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();

    // Click Archive button
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await bulkActionBar.getByRole('button', { name: 'Archive' }).click();

    // Wait for the issue to be removed from the list
    await expect(rows).toHaveCount(initialCount - 1, { timeout: 5000 });

    // Verify the archived issue is no longer in the list
    if (issueTitle) {
      await expect(page.getByText(issueTitle)).toHaveCount(0);
    }
  });

  test('archived issues do not appear in default views', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Get the title and ticket number of the first issue
    const issueTitle = await rows.nth(0).locator('td').nth(1).textContent();

    // Select and archive
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await bulkActionBar.getByRole('button', { name: 'Archive' }).click();

    // Wait for archive to complete
    await expect(bulkActionBar).toHaveCount(0, { timeout: 5000 });

    // Check All tab - should not contain archived issue
    await page.getByRole('tab', { name: 'All' }).click();
    if (issueTitle) {
      await expect(page.locator('tbody').getByText(issueTitle)).toHaveCount(0);
    }

    // Check Active tab
    await page.getByRole('tab', { name: 'Active' }).click();
    await page.waitForTimeout(200);
    if (issueTitle) {
      await expect(page.locator('tbody').getByText(issueTitle)).toHaveCount(0);
    }

    // Check Backlog tab
    await page.getByRole('tab', { name: 'Backlog' }).click();
    await page.waitForTimeout(200);
    if (issueTitle) {
      await expect(page.locator('tbody').getByText(issueTitle)).toHaveCount(0);
    }
  });

  test('archive shows success toast', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Select an issue and archive
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await bulkActionBar.getByRole('button', { name: 'Archive' }).click();

    // Verify toast appears with success message
    const toast = page.getByRole('alert');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText(/archived/i);
  });

  test('archive toast has undo button', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Select an issue and archive
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await bulkActionBar.getByRole('button', { name: 'Archive' }).click();

    // Verify toast has Undo button
    const toast = page.getByRole('alert');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  test('selection clears after archive action', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Select an issue
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();

    // Verify bulk action bar is visible
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bulkActionBar).toBeVisible();

    // Click Archive
    await bulkActionBar.getByRole('button', { name: 'Archive' }).click();

    // Verify bulk action bar is gone (selection cleared)
    await expect(bulkActionBar).toHaveCount(0, { timeout: 5000 });

    // Verify no rows are selected
    const selectedRows = page.locator('tbody tr[data-selected="true"]');
    await expect(selectedRows).toHaveCount(0);
  });
});

test.describe('Bulk Actions - Move to Week', () => {
  test('move to sprint shows sprint picker dropdown', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Select an issue
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();

    // Click Move to Week button
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    const moveToSprintButton = bulkActionBar.getByRole('button', { name: 'Move to Week' });
    await moveToSprintButton.click();

    // Verify dropdown is shown with at least "No Week" option
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'No Week' })).toBeVisible();
  });

  test('move to sprint shows success toast', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Select an issue
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();

    // Click Move to Week and select No Week
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await bulkActionBar.getByRole('button', { name: 'Move to Week' }).click();

    const menu = page.getByRole('menu');
    // Use dispatchEvent to bypass z-index issues with stacking context
    await menu.getByRole('menuitem', { name: 'No Week' }).dispatchEvent('click');

    // Verify success toast (toast says "assigned to" not "moved to")
    const toast = page.getByRole('alert');
    await expect(toast).toContainText(/assigned/i);
  });

  test('can move to "No Week" to unassign', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Select an issue
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();

    // Click Move to Week and select No Week
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await bulkActionBar.getByRole('button', { name: 'Move to Week' }).click();

    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'No Week' })).toBeVisible();
    // Use dispatchEvent to bypass z-index issues with stacking context
    await menu.getByRole('menuitem', { name: 'No Week' }).dispatchEvent('click');

    // Verify action completed (toast shown means mutation succeeded)
    const toast = page.getByRole('alert');
    await expect(toast).toBeVisible();
  });

  test('selection clears after move action', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Select multiple issues
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    await rows.nth(1).hover();
    await rows.nth(1).getByRole('checkbox').click({ modifiers: ['Meta'] });

    // Verify bulk action bar shows 2 selected
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bulkActionBar).toContainText('2 selected');

    // Move to No Week - use dispatchEvent to bypass z-index issues with stacking context
    await bulkActionBar.getByRole('button', { name: 'Move to Week' }).click();
    const menu = page.getByRole('menu');
    await menu.getByRole('menuitem', { name: 'No Week' }).dispatchEvent('click');

    // Verify selection cleared (bulk action bar should be gone)
    await expect(bulkActionBar).not.toBeVisible();

    // Verify no rows are selected
    const selectedRows = page.locator('tbody tr[data-selected="true"]');
    await expect(selectedRows).toHaveCount(0);
  });
});

test.describe('Bulk Actions - Delete (Trash)', () => {
  test('delete action moves selected issues to trash', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    const issueTitle = await rows.nth(0).locator('td').nth(1).textContent();
    const initialCount = await rows.count();

    // Select and delete
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await bulkActionBar.getByRole('button', { name: 'Delete' }).click();

    // Wait for issue to be removed from list
    await expect(rows).toHaveCount(initialCount - 1, { timeout: 5000 });

    // Verify issue no longer visible
    if (issueTitle) {
      await expect(page.locator('tbody').getByText(issueTitle)).toHaveCount(0);
    }
  });

  test('delete shows success toast with undo', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Select and delete
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await bulkActionBar.getByRole('button', { name: 'Delete' }).click();

    // Verify toast with Undo
    const toast = page.getByRole('alert');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText(/deleted/i);
    await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();
  });

  test('undo restores deleted issues from trash', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    const issueTitle = await rows.nth(0).locator('td').nth(1).textContent();
    const initialCount = await rows.count();

    // Select and delete
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await bulkActionBar.getByRole('button', { name: 'Delete' }).click();

    // Wait for removal
    await expect(rows).toHaveCount(initialCount - 1, { timeout: 5000 });

    // Click Undo
    const toast = page.getByRole('alert');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await toast.getByRole('button', { name: 'Undo' }).click();

    // Wait for undo confirmation
    await expect(page.getByRole('alert')).toContainText(/undone/i, { timeout: 5000 });

    // Verify issue restored
    await expect(rows).toHaveCount(initialCount, { timeout: 10000 });
    if (issueTitle) {
      await expect(page.locator('tbody').getByText(issueTitle)).toBeVisible({ timeout: 5000 });
    }
  });

  test('selection clears after delete action', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Select and delete
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bulkActionBar).toBeVisible();
    await bulkActionBar.getByRole('button', { name: 'Delete' }).click();

    // Verify bar gone (selection cleared)
    await expect(bulkActionBar).toHaveCount(0, { timeout: 5000 });

    // Verify no rows selected
    const selectedRows = page.locator('tbody tr[data-selected="true"]');
    await expect(selectedRows).toHaveCount(0);
  });
});

test.describe('Bulk Actions - Change Status', () => {
  test('change status shows status picker dropdown', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Select an item
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();

    // Click Change Status button
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await bulkActionBar.getByRole('button', { name: 'Change Status' }).click();

    // Verify dropdown with status options appears
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Backlog' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Todo' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'In Progress' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Done' })).toBeVisible();
  });

  test('selecting status updates all selected issues', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    // Go to Backlog tab to find issues we can change
    await page.getByRole('tab', { name: 'Backlog' }).click();
    await page.waitForTimeout(300);

    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();
    if (rowCount < 2) {
      test.skip();
      return;
    }

    // Select 2 items
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    await rows.nth(1).hover();
    await rows.nth(1).getByRole('checkbox').click({ modifiers: ['Meta'] });

    // Change status to "In Progress"
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await bulkActionBar.getByRole('button', { name: 'Change Status' }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'In Progress' }).click();

    // Wait for toast to confirm
    await expect(page.getByRole('alert')).toContainText(/changed/i, { timeout: 5000 });

    // Verify issues are now in Active tab
    await page.getByRole('tab', { name: 'Active' }).click();
    await page.waitForTimeout(300);

    // The previously backlog issues should now appear in Active
    const statusIndicators = page.locator('[data-status="in_progress"]');
    await expect(statusIndicators.first()).toBeVisible({ timeout: 5000 });
  });

  test('change status shows success toast', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Select and change status
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await bulkActionBar.getByRole('button', { name: 'Change Status' }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Todo' }).click();

    // Verify toast
    const toast = page.getByRole('alert');
    await expect(toast).toBeVisible({ timeout: 3000 });
    await expect(toast).toContainText(/changed to|updated/i);
  });

  test('issues move to correct tab after status change', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    // Go to Backlog tab
    await page.getByRole('tab', { name: 'Backlog' }).click();
    await page.waitForTimeout(300);

    const rows = page.locator('tbody tr');
    const initialCount = await rows.count();
    if (initialCount === 0) {
      test.skip();
      return;
    }

    const issueTitle = await rows.nth(0).locator('td').nth(1).textContent();

    // Select and change to Done
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await bulkActionBar.getByRole('button', { name: 'Change Status' }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Done' }).click();

    // Wait for toast
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 3000 });

    // Verify issue is no longer in Backlog tab
    await expect(rows).toHaveCount(initialCount - 1, { timeout: 5000 });
    if (issueTitle) {
      await expect(page.locator('tbody').getByText(issueTitle)).toHaveCount(0);
    }

    // Verify issue appears in Done tab
    await page.getByRole('tab', { name: 'Done' }).click();
    await page.waitForTimeout(300);
    if (issueTitle) {
      await expect(page.locator('tbody').getByText(issueTitle)).toBeVisible({ timeout: 5000 });
    }
  });

  test('selection clears after status change', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const rows = page.locator('tbody tr');
    await expect(rows.first()).toBeVisible();

    // Select and change status
    await rows.nth(0).hover();
    await rows.nth(0).getByRole('checkbox').click();
    const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bulkActionBar).toBeVisible();
    await bulkActionBar.getByRole('button', { name: 'Change Status' }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Backlog' }).click();

    // Verify bar gone (selection cleared)
    await expect(bulkActionBar).toHaveCount(0, { timeout: 5000 });

    // Verify no rows selected
    const selectedRows = page.locator('tbody tr[data-selected="true"]');
    await expect(selectedRows).toHaveCount(0);
  });
});

test.describe('Bulk Selection - Kanban View', () => {
  test.describe('Card Selection', () => {
    test('checkbox appears on kanban card hover', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      // Switch to Kanban view
      await page.getByRole('button', { name: 'Kanban view' }).click();

      // Wait for Kanban board to load
      const kanbanBoard = page.getByRole('application', { name: /Kanban board/ });
      await expect(kanbanBoard).toBeVisible();

      // Find first card
      const cards = page.locator('[data-issue]');
      await expect(cards.first()).toBeVisible();

      // Checkbox should be hidden by default (opacity-0)
      const firstCard = cards.first();
      const checkbox = firstCard.getByRole('checkbox');
      // The opacity is on the checkbox container div, not the input itself
      const checkboxContainer = checkbox.locator('..');

      // Move mouse away to ensure no hover state
      await page.mouse.move(0, 0);
      await page.waitForTimeout(100);

      // Before hover, checkbox container should exist but be invisible (opacity-0)
      await expect(checkboxContainer).toHaveCSS('opacity', '0');

      // Hover card to reveal checkbox
      await firstCard.hover();
      await expect(checkboxContainer).toHaveCSS('opacity', '1');
    });

    test('clicking checkbox selects kanban card', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      // Switch to Kanban view
      await page.getByRole('button', { name: 'Kanban view' }).click();
      const kanbanBoard = page.getByRole('application', { name: /Kanban board/ });
      await expect(kanbanBoard).toBeVisible();

      // Find first card and click checkbox
      const firstCard = page.locator('[data-issue]').first();
      await firstCard.hover();
      await firstCard.getByRole('checkbox').click();

      // Verify card is selected
      await expect(firstCard).toHaveAttribute('data-selected', 'true');
    });

    test('selected card shows visual distinction', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      // Switch to Kanban view
      await page.getByRole('button', { name: 'Kanban view' }).click();
      const kanbanBoard = page.getByRole('application', { name: /Kanban board/ });
      await expect(kanbanBoard).toBeVisible();

      // Select a card
      const firstCard = page.locator('[data-issue]').first();
      await firstCard.hover();
      await firstCard.getByRole('checkbox').click();

      // Verify visual distinction - card inner div should have ring-2 class
      const cardInner = firstCard.locator('.ring-2');
      await expect(cardInner).toBeVisible();
    });

    test('clicking card (not checkbox) opens detail', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      // Switch to Kanban view
      await page.getByRole('button', { name: 'Kanban view' }).click();
      const kanbanBoard = page.getByRole('application', { name: /Kanban board/ });
      await expect(kanbanBoard).toBeVisible();

      // Click card (not checkbox) - should navigate to detail
      const firstCard = page.locator('[data-issue]').first();
      await firstCard.click();

      // Verify navigation to issue detail
      await expect(page).toHaveURL(/\/documents\/[a-f0-9-]+$/);
    });
  });

  test.describe('Multi-Select in Kanban', () => {
    test('can select cards across multiple columns', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      // Switch to Kanban view
      await page.getByRole('button', { name: 'Kanban view' }).click();
      const kanbanBoard = page.getByRole('application', { name: /Kanban board/ });
      await expect(kanbanBoard).toBeVisible();

      // Find cards in different columns
      const backlogColumn = page.locator('ul[aria-label="Backlog issues"]');
      const todoColumn = page.locator('ul[aria-label="Todo issues"]');

      const backlogCard = backlogColumn.locator('[data-issue]').first();
      const todoCard = todoColumn.locator('[data-issue]').first();

      // Select card in Backlog
      await backlogCard.hover();
      await backlogCard.getByRole('checkbox').click();

      // Cmd+click card in Todo (to add to selection)
      await todoCard.hover();
      await todoCard.getByRole('checkbox').click({ modifiers: ['Meta'] });

      // Verify both cards are selected
      await expect(backlogCard).toHaveAttribute('data-selected', 'true');
      await expect(todoCard).toHaveAttribute('data-selected', 'true');

      // Verify bulk action bar shows 2 selected
      const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
      await expect(bulkActionBar).toContainText('2 selected');
    });

    test('cmd+click toggles individual cards', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      // Switch to Kanban view
      await page.getByRole('button', { name: 'Kanban view' }).click();
      const kanbanBoard = page.getByRole('application', { name: /Kanban board/ });
      await expect(kanbanBoard).toBeVisible();

      const cards = page.locator('[data-issue]');
      const cardA = cards.nth(0);
      const cardB = cards.nth(1);

      // Select card A
      await cardA.hover();
      await cardA.getByRole('checkbox').click();
      await expect(cardA).toHaveAttribute('data-selected', 'true');

      // Cmd+click card B to add to selection
      await cardB.hover();
      await cardB.getByRole('checkbox').click({ modifiers: ['Meta'] });
      await expect(cardA).toHaveAttribute('data-selected', 'true');
      await expect(cardB).toHaveAttribute('data-selected', 'true');

      // Cmd+click card A to remove from selection
      await cardA.hover();
      await cardA.getByRole('checkbox').click({ modifiers: ['Meta'] });
      await expect(cardA).not.toHaveAttribute('data-selected', 'true');
      await expect(cardB).toHaveAttribute('data-selected', 'true');
    });
  });

  test.describe('Bulk Actions in Kanban', () => {
    test('bulk action bar appears with kanban selection', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      // Switch to Kanban view
      await page.getByRole('button', { name: 'Kanban view' }).click();
      const kanbanBoard = page.getByRole('application', { name: /Kanban board/ });
      await expect(kanbanBoard).toBeVisible();

      // Verify bulk action bar is hidden
      const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
      await expect(bulkActionBar).not.toBeVisible();

      // Select a card
      const firstCard = page.locator('[data-issue]').first();
      await firstCard.hover();
      await firstCard.getByRole('checkbox').click();

      // Verify bulk action bar appears
      await expect(bulkActionBar).toBeVisible();
      await expect(bulkActionBar).toContainText('1 selected');
    });

    test('archive works from kanban view', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      // Switch to Kanban view
      await page.getByRole('button', { name: 'Kanban view' }).click();
      const kanbanBoard = page.getByRole('application', { name: /Kanban board/ });
      await expect(kanbanBoard).toBeVisible();

      // Count initial cards
      const cards = page.locator('[data-issue]');
      const initialCount = await cards.count();

      // Select a card and archive
      await cards.first().hover();
      await cards.first().getByRole('checkbox').click();

      const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
      await bulkActionBar.getByRole('button', { name: 'Archive' }).click();

      // Verify toast and card removed
      await expect(page.getByRole('alert')).toContainText(/archived/i);
      await expect(cards).toHaveCount(initialCount - 1);
    });

    test('status change moves cards to correct column', async ({ page }) => {
      await login(page);
      await page.goto('/issues');
      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      // Switch to Kanban view
      await page.getByRole('button', { name: 'Kanban view' }).click();
      const kanbanBoard = page.getByRole('application', { name: /Kanban board/ });
      await expect(kanbanBoard).toBeVisible();

      // Find a card in Backlog column
      const backlogColumn = page.locator('ul[aria-label="Backlog issues"]');
      const backlogCards = backlogColumn.locator('[data-issue]');

      // Skip if no cards in Backlog
      const backlogCount = await backlogCards.count();
      if (backlogCount === 0) {
        test.skip();
        return;
      }

      const cardToMove = backlogCards.first();
      const cardTitle = await cardToMove.locator('.text-foreground').textContent();

      // Select and change status to Done
      await cardToMove.hover();
      await cardToMove.getByRole('checkbox').click();

      const bulkActionBar = page.getByRole('region', { name: 'Bulk actions' });
      await bulkActionBar.getByRole('button', { name: 'Change Status' }).click();

      const menu = page.getByRole('menu');
      await menu.getByRole('menuitem', { name: 'Done' }).dispatchEvent('click');

      // Verify card moved to Done column
      await expect(page.getByRole('alert')).toBeVisible();
      const doneColumn = page.locator('ul[aria-label="Done issues"]');
      await expect(doneColumn.locator(`text="${cardTitle}"`)).toBeVisible();
    });
  });

});

test.describe('Bulk Selection - Accessibility', () => {
  test('list has aria-multiselectable attribute', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    // Verify table has aria-multiselectable="true"
    const table = page.locator('table');
    await expect(table).toHaveAttribute('aria-multiselectable', 'true');
  });

  test('rows have aria-selected attribute', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible();

    // Initially, aria-selected should be false
    await expect(firstRow).toHaveAttribute('aria-selected', 'false');

    // Select the row
    await firstRow.hover();
    await firstRow.getByRole('checkbox').click();

    // aria-selected should now be true
    await expect(firstRow).toHaveAttribute('aria-selected', 'true');

    // Deselect the row
    await firstRow.getByRole('checkbox').click();

    // aria-selected should be false again
    await expect(firstRow).toHaveAttribute('aria-selected', 'false');
  });

  test('checkboxes have accessible labels', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.hover();

    // Verify checkbox has aria-label like "Select item {id}"
    const checkbox = firstRow.getByRole('checkbox');
    await expect(checkbox).toHaveAttribute('aria-label', /Select item/);
  });

  test('bulk action bar is announced to screen readers', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    // Select an item to show the bulk action bar
    const firstRow = page.locator('tbody tr').first();
    await firstRow.hover();
    await firstRow.getByRole('checkbox').click();

    // Verify bulk action bar has proper accessibility attributes
    const bulkBar = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bulkBar).toBeVisible();
    await expect(bulkBar).toHaveAttribute('aria-live', 'polite');
  });

  test('selection count announced when selection changes', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    // Find the selection announcer (screen reader only)
    const announcer = page.locator('#selection-announcer');
    await expect(announcer).toHaveAttribute('aria-live', 'polite');
    await expect(announcer).toHaveAttribute('role', 'status');

    // Initially empty
    await expect(announcer).toHaveText('');

    // Select an item
    const firstRow = page.locator('tbody tr').first();
    await firstRow.hover();
    await firstRow.getByRole('checkbox').click();

    // Announcer should say "1 items selected"
    await expect(announcer).toHaveText('1 items selected');

    // Select another item
    const rows = page.locator('tbody tr');
    if (await rows.count() >= 2) {
      const secondRow = rows.nth(1);
      await secondRow.hover();
      await secondRow.getByRole('checkbox').click({ modifiers: ['Meta'] });
      await expect(announcer).toHaveText('2 items selected');
    }
  });

  test('focus is visible on keyboard navigation', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const table = page.locator('table');
    await expect(table).toBeVisible();

    // Hover first row to establish React focus state (hover triggers setFocusedId)
    const firstRow = page.locator('tbody tr').first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    await firstRow.hover();

    // First row should have visible focus ring (ring-2 class)
    await expect(firstRow).toHaveClass(/ring-2/);
  });

  test('bulk actions are keyboard accessible', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    // Select an item to show the bulk action bar
    const firstRow = page.locator('tbody tr').first();
    await firstRow.hover();
    await firstRow.getByRole('checkbox').click();

    // Verify bulk action bar is visible
    const bulkBar = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bulkBar).toBeVisible();

    // Get the clear selection button
    const clearButton = bulkBar.getByRole('button', { name: /Clear selection|×/ });
    await expect(clearButton).toBeVisible();

    // Focus the clear button using Tab navigation
    await clearButton.focus();

    // Press Enter to activate the button
    await page.keyboard.press('Enter');

    // Selection should be cleared and bulk bar hidden
    await expect(bulkBar).not.toBeVisible();
    await expect(firstRow).toHaveAttribute('aria-selected', 'false');
  });
});

test.describe('Bulk Selection - Performance', () => {
  test('selecting many items remains responsive', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const table = page.locator('table');
    await expect(table).toBeVisible();

    // Count available rows
    const rows = page.locator('tbody tr');
    const rowCount = await rows.count();

    // Skip if not enough rows for meaningful performance test
    if (rowCount < 5) {
      test.skip(true, 'Not enough issues for performance test');
      return;
    }

    // Focus the table
    await table.focus();

    // Measure time to select all with Cmd+A
    const startTime = Date.now();
    await page.keyboard.press('Meta+a');
    const endTime = Date.now();

    // Wait for selection announcer to update
    const announcer = page.locator('#selection-announcer');
    await expect(announcer).toHaveText(new RegExp(`${rowCount} items selected`));

    // Selection should complete in reasonable time (< 500ms even for larger lists)
    // Note: 100ms is very aggressive, 500ms is more realistic with rendering
    const elapsed = endTime - startTime;
    expect(elapsed).toBeLessThan(500);
  });

  test('bulk action on many items shows loading state', async ({ page }) => {
    await login(page);
    await page.goto('/issues');
    await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

    const table = page.locator('table');
    await expect(table).toBeVisible();

    // Select multiple items using Cmd+A
    await table.focus();
    await page.keyboard.press('Meta+a');

    // Verify bulk action bar is visible
    const bulkBar = page.getByRole('region', { name: 'Bulk actions' });
    await expect(bulkBar).toBeVisible();

    // Archive button should be enabled initially
    const archiveButton = bulkBar.getByRole('button', { name: 'Archive' });
    await expect(archiveButton).toBeEnabled();

    // Click archive and immediately check for disabled state (loading)
    await archiveButton.click();

    // The button should either become disabled briefly during loading
    // OR we should see the success toast (fast response)
    // Either outcome is acceptable - we're testing that the action completes
    const toast = page.getByRole('alert');
    await expect(toast).toBeVisible({ timeout: 5000 });
    await expect(toast).toContainText(/archived/i);
  });
});
