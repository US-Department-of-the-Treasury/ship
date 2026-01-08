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

    test('checkbox column does not shift table layout on hover', async ({ page }) => {
      await login(page);
      await page.goto('/issues');

      await expect(page.getByRole('heading', { name: 'Issues', level: 1 })).toBeVisible({ timeout: 10000 });

      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Get the position of the second column (title) before hover
      const titleCell = firstRow.locator('td').nth(1);
      const boundingBoxBefore = await titleCell.boundingBox();

      // Hover over the row to reveal checkbox
      await firstRow.hover();
      await page.waitForTimeout(100);

      // Get the position after hover - should be the same
      const boundingBoxAfter = await titleCell.boundingBox();

      // The X position should not have changed (no layout shift)
      expect(boundingBoxBefore?.x).toBe(boundingBoxAfter?.x);
      // Width should remain the same
      expect(boundingBoxBefore?.width).toBe(boundingBoxAfter?.width);
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
      await expect(page).toHaveURL(/\/issues\/[a-f0-9-]+/, { timeout: 5000 });
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

      // Focus the table by clicking on it first, then using keyboard
      const table = page.locator('table[role="grid"]');
      await table.focus();

      // Press arrow down to focus first row
      await page.keyboard.press('ArrowDown');

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

      // Focus table and navigate to first row
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('ArrowDown');
      await expect(rows.nth(0)).toHaveClass(/ring-2/);

      // Press ArrowDown to move focus to second row
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

      // Focus table and navigate to second row
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('ArrowDown'); // First row
      await page.keyboard.press('ArrowDown'); // Second row
      await expect(rows.nth(1)).toHaveClass(/ring-2/);

      // Press ArrowUp to move focus to first row
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

      // Focus table and navigate to a middle row
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('ArrowDown'); // Row 0
      await page.keyboard.press('ArrowDown'); // Row 1
      await page.keyboard.press('ArrowDown'); // Row 2
      await expect(rows.nth(2)).toHaveClass(/ring-2/);

      // Press Home to move focus to first row
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

      // Focus table and start at first row
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('ArrowDown'); // First row
      await expect(rows.nth(0)).toHaveClass(/ring-2/);

      // Press End to move focus to last row
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

      // Focus table and navigate to first row
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('ArrowDown');
      await expect(rows.nth(0)).toHaveClass(/ring-2/);

      // Press Enter to select
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

      // Focus table and navigate to first row
      const table = page.locator('table[role="grid"]');
      await table.focus();
      await page.keyboard.press('ArrowDown');
      await expect(rows.nth(0)).toHaveClass(/ring-2/);

      // Press Space to select
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

test.describe('Bulk Selection - Tab/Filter Behavior', () => {
  test.fixme('switching tabs clears selection', async ({ page }) => {
    // TODO: Select items on "All" tab, click "Active" tab, verify selection cleared
  });

  test.fixme('selection only applies to visible items', async ({ page }) => {
    // TODO: Filter to "Backlog", select items, verify only backlog items can be selected
  });

  test.fixme('cmd+a only selects items in current filter', async ({ page }) => {
    // TODO: Filter to "Active", Cmd+A, verify only active issues selected (not all issues)
  });
});

test.describe('Bulk Action Bar', () => {
  test.describe('Visibility', () => {
    test.fixme('bulk action bar is hidden when nothing selected', async ({ page }) => {
      // TODO: Verify bulk action bar not visible with no selection
    });

    test.fixme('bulk action bar appears when 1+ items selected', async ({ page }) => {
      // TODO: Select one item, verify bulk action bar appears
    });

    test.fixme('bulk action bar shows selected count', async ({ page }) => {
      // TODO: Select 3 items, verify bar shows "3 selected" or similar
    });

    test.fixme('bulk action bar disappears when selection cleared', async ({ page }) => {
      // TODO: Select items, press Escape, verify bar disappears
    });
  });

  test.describe('Actions Available', () => {
    test.fixme('bulk action bar has Archive button', async ({ page }) => {
      // TODO: Select item, verify Archive action visible in bar
    });

    test.fixme('bulk action bar has Move to Sprint dropdown', async ({ page }) => {
      // TODO: Select item, verify Move to Sprint action visible
    });

    test.fixme('bulk action bar has Delete button', async ({ page }) => {
      // TODO: Select item, verify Delete (trash) action visible
    });

    test.fixme('bulk action bar has Change Status dropdown', async ({ page }) => {
      // TODO: Select item, verify Change Status action visible
    });

    test.fixme('bulk action bar has Clear Selection button', async ({ page }) => {
      // TODO: Select item, verify Clear/Cancel action visible
    });
  });
});

test.describe('Bulk Actions - Archive', () => {
  test.fixme('archive action moves selected issues to archived state', async ({ page }) => {
    // TODO: Select issues, click Archive, verify issues removed from list
  });

  test.fixme('archived issues do not appear in default views', async ({ page }) => {
    // TODO: Archive issue, verify not in All/Active/Backlog/Done tabs
  });

  test.fixme('archive shows success toast', async ({ page }) => {
    // TODO: Archive issues, verify toast appears with message
  });

  test.fixme('archive toast has undo button', async ({ page }) => {
    // TODO: Archive issues, verify toast has Undo action
  });

  test.fixme('undo restores archived issues', async ({ page }) => {
    // TODO: Archive, click Undo within 5s, verify issues restored to list
  });

  test.fixme('selection clears after archive action', async ({ page }) => {
    // TODO: Archive selected, verify bulk bar gone, no selection
  });
});

test.describe('Bulk Actions - Move to Sprint', () => {
  test.fixme('move to sprint shows sprint picker dropdown', async ({ page }) => {
    // TODO: Select issues, click Move to Sprint, verify dropdown with sprint options
  });

  test.fixme('selecting sprint assigns all selected issues', async ({ page }) => {
    // TODO: Select issues, pick sprint, verify all issues now have that sprint
  });

  test.fixme('move to sprint overwrites existing sprint assignments', async ({ page }) => {
    // TODO: Issue with Sprint A, select it, move to Sprint B, verify now Sprint B
  });

  test.fixme('move to sprint shows success toast', async ({ page }) => {
    // TODO: Move to sprint, verify success message
  });

  test.fixme('can move to "No Sprint" to unassign', async ({ page }) => {
    // TODO: Select issues with sprints, move to None/Unassigned, verify sprint removed
  });

  test.fixme('selection clears after move action', async ({ page }) => {
    // TODO: Move selected, verify bulk bar gone
  });
});

test.describe('Bulk Actions - Delete (Trash)', () => {
  test.fixme('delete action moves selected issues to trash', async ({ page }) => {
    // TODO: Select issues, click Delete, verify issues removed from list
  });

  test.fixme('deleted issues appear in Trash view', async ({ page }) => {
    // TODO: Delete issues, navigate to Trash, verify issues visible there
  });

  test.fixme('delete shows success toast with undo', async ({ page }) => {
    // TODO: Delete issues, verify toast with Undo button
  });

  test.fixme('undo restores deleted issues from trash', async ({ page }) => {
    // TODO: Delete, click Undo, verify issues back in original view
  });

  test.fixme('selection clears after delete action', async ({ page }) => {
    // TODO: Delete selected, verify bulk bar gone
  });
});

test.describe('Bulk Actions - Change Status', () => {
  test.fixme('change status shows status picker dropdown', async ({ page }) => {
    // TODO: Select issues, click Change Status, verify dropdown with status options
  });

  test.fixme('selecting status updates all selected issues', async ({ page }) => {
    // TODO: Select issues in backlog, change to "In Progress", verify all now in progress
  });

  test.fixme('change status shows success toast', async ({ page }) => {
    // TODO: Change status, verify success message
  });

  test.fixme('issues move to correct tab after status change', async ({ page }) => {
    // TODO: In "Backlog" tab, select, change to "Done", verify issues gone from backlog
  });

  test.fixme('selection clears after status change', async ({ page }) => {
    // TODO: Change status, verify bulk bar gone
  });
});

test.describe('Bulk Selection - Kanban View', () => {
  test.describe('Card Selection', () => {
    test.fixme('checkbox appears on kanban card hover', async ({ page }) => {
      // TODO: Hover kanban card, verify checkbox visible
    });

    test.fixme('clicking checkbox selects kanban card', async ({ page }) => {
      // TODO: Click card checkbox, verify selected state
    });

    test.fixme('selected card shows visual distinction', async ({ page }) => {
      // TODO: Select card, verify ring/border/highlight
    });

    test.fixme('clicking card (not checkbox) opens detail', async ({ page }) => {
      // TODO: Click card title, verify navigation to detail view
    });
  });

  test.describe('Multi-Select in Kanban', () => {
    test.fixme('can select cards across multiple columns', async ({ page }) => {
      // TODO: Select card in Backlog column, select card in Done column, both selected
    });

    test.fixme('shift+click works for cards in same column', async ({ page }) => {
      // TODO: Select first card in column, shift+click third card, verify range selected
    });

    test.fixme('cmd+click toggles individual cards', async ({ page }) => {
      // TODO: Select card A, cmd+click card B, both selected. Cmd+click A, only B selected.
    });
  });

  test.describe('Bulk Actions in Kanban', () => {
    test.fixme('bulk action bar appears with kanban selection', async ({ page }) => {
      // TODO: Select kanban card, verify bulk bar appears
    });

    test.fixme('archive works from kanban view', async ({ page }) => {
      // TODO: Select cards, archive, verify cards removed from board
    });

    test.fixme('status change moves cards to correct column', async ({ page }) => {
      // TODO: Select cards in Backlog, change to In Progress, verify cards moved
    });
  });

  test.describe('Drag and Selection', () => {
    test.fixme('dragging a selected card moves all selected cards', async ({ page }) => {
      // TODO: Select 3 cards, drag one, verify all 3 moved to new column
    });

    test.fixme('dragging unselected card only moves that card', async ({ page }) => {
      // TODO: Select cards A,B, drag unselected card C, only C moves
    });
  });
});

test.describe('Bulk Selection - Accessibility', () => {
  test.fixme('list has aria-multiselectable attribute', async ({ page }) => {
    // TODO: Verify table/list has aria-multiselectable="true"
  });

  test.fixme('rows have aria-selected attribute', async ({ page }) => {
    // TODO: Select row, verify aria-selected="true", deselect, verify aria-selected="false"
  });

  test.fixme('checkboxes have accessible labels', async ({ page }) => {
    // TODO: Verify checkbox has aria-label like "Select issue #7"
  });

  test.fixme('bulk action bar is announced to screen readers', async ({ page }) => {
    // TODO: Verify role="region" or aria-live for bulk bar
  });

  test.fixme('selection count announced when selection changes', async ({ page }) => {
    // TODO: Verify live region announces "3 items selected"
  });

  test.fixme('focus is visible on keyboard navigation', async ({ page }) => {
    // TODO: Tab through list, verify visible focus indicator on each row
  });

  test.fixme('bulk actions are keyboard accessible', async ({ page }) => {
    // TODO: Tab to bulk bar, verify can activate buttons with Enter/Space
  });
});

test.describe('Bulk Selection - Performance', () => {
  test.fixme('selecting many items remains responsive', async ({ page }) => {
    // TODO: With 50+ issues, Cmd+A should complete in <100ms
  });

  test.fixme('bulk action on many items shows loading state', async ({ page }) => {
    // TODO: Select 20 items, archive, verify loading indicator while processing
  });
});
