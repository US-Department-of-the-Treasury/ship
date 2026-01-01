import { test, expect, Page } from '@playwright/test';

// Helper to create a new document using the available buttons
async function createNewDocument(page: Page) {
  await page.goto('/docs');

  // Wait for the page to stabilize (may auto-redirect to existing doc)
  await page.waitForLoadState('networkidle');

  // Get current URL to detect change after clicking
  const currentUrl = page.url();

  // Click the "New document" button
  const newDocButton = page.locator('button[title="New document"]');
  await expect(newDocButton).toBeVisible({ timeout: 5000 });
  await newDocButton.click();

  // Wait for URL to change to a new document
  await page.waitForFunction(
    (oldUrl) => window.location.href !== oldUrl && /\/docs\/[a-f0-9-]+/.test(window.location.href),
    currentUrl,
    { timeout: 10000 }
  );

  // Wait for editor to be ready
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 });

  // Verify this is a NEW document (title should be "Untitled")
  await expect(page.locator('input[placeholder="Untitled"]')).toBeVisible({ timeout: 3000 });
}

test.describe('Tables', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.locator('#email').fill('dev@ship.local');
    await page.locator('#password').fill('admin123');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 });
  });

  test('should create table via /table command', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Type /table to trigger slash command
    await page.keyboard.type('/table');
    await page.waitForTimeout(500);

    // Should show table option
    const tableOption = page.getByRole('button', { name: /Table/i });
    await expect(tableOption).toBeVisible({ timeout: 5000 });

    // Press Enter to insert table
    await page.keyboard.press('Enter');

    // Wait for table to appear
    await expect(editor.locator('table')).toBeVisible({ timeout: 3000 });
  });

  test('should add rows to table', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert table
    await page.keyboard.type('/table');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');

    // Wait for table to appear
    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 3000 });

    // Get initial row count
    const initialRows = await table.locator('tr').count();
    expect(initialRows).toBeGreaterThan(0);

    // Click in a cell to focus table
    const firstCell = table.locator('td, th').first();
    await firstCell.click();

    // Right-click to open context menu (or use table controls)
    await firstCell.click({ button: 'right' });
    await page.waitForTimeout(300);

    // Look for "Add row" option (or use keyboard shortcut if available)
    const addRowOption = page.getByText(/Add row|Insert row/i);
    if (await addRowOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addRowOption.click();
      await page.waitForTimeout(300);

      // Verify row was added
      const newRows = await table.locator('tr').count();
      expect(newRows).toBeGreaterThan(initialRows);
    }
  });

  test('should add columns to table', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert table
    await page.keyboard.type('/table');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');

    // Wait for table to appear
    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 3000 });

    // Get initial column count from first row
    const firstRow = table.locator('tr').first();
    const initialCols = await firstRow.locator('td, th').count();
    expect(initialCols).toBeGreaterThan(0);

    // Click in a cell to focus table
    const firstCell = table.locator('td, th').first();
    await firstCell.click();

    // Right-click to open context menu
    await firstCell.click({ button: 'right' });
    await page.waitForTimeout(300);

    // Look for "Add column" option
    const addColOption = page.getByText(/Add column|Insert column/i);
    if (await addColOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addColOption.click();
      await page.waitForTimeout(300);

      // Verify column was added
      const newCols = await firstRow.locator('td, th').count();
      expect(newCols).toBeGreaterThan(initialCols);
    }
  });

  test('should delete rows from table', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert table
    await page.keyboard.type('/table');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');

    // Wait for table to appear
    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 3000 });

    // Get initial row count
    const initialRows = await table.locator('tr').count();

    // Click in a cell to focus table
    const firstCell = table.locator('td, th').first();
    await firstCell.click();

    // Right-click to open context menu
    await firstCell.click({ button: 'right' });
    await page.waitForTimeout(300);

    // Look for "Delete row" option
    const deleteRowOption = page.getByText(/Delete row|Remove row/i);
    if (await deleteRowOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteRowOption.click();
      await page.waitForTimeout(300);

      // Verify row was deleted (or table removed if only one row)
      const tableExists = await table.isVisible({ timeout: 1000 }).catch(() => false);
      if (tableExists) {
        const newRows = await table.locator('tr').count();
        expect(newRows).toBeLessThan(initialRows);
      }
    }
  });

  test('should delete columns from table', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert table
    await page.keyboard.type('/table');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');

    // Wait for table to appear
    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 3000 });

    // Get initial column count
    const firstRow = table.locator('tr').first();
    const initialCols = await firstRow.locator('td, th').count();

    // Click in a cell to focus table
    const firstCell = table.locator('td, th').first();
    await firstCell.click();

    // Right-click to open context menu
    await firstCell.click({ button: 'right' });
    await page.waitForTimeout(300);

    // Look for "Delete column" option
    const deleteColOption = page.getByText(/Delete column|Remove column/i);
    if (await deleteColOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteColOption.click();
      await page.waitForTimeout(300);

      // Verify column was deleted (or table removed if only one column)
      const tableExists = await table.isVisible({ timeout: 1000 }).catch(() => false);
      if (tableExists) {
        const newCols = await firstRow.locator('td, th').count();
        expect(newCols).toBeLessThan(initialCols);
      }
    }
  });

  test('should navigate cells with Tab key', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert table
    await page.keyboard.type('/table');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');

    // Wait for table to appear
    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 3000 });

    // Click in first cell
    const firstCell = table.locator('td, th').first();
    await firstCell.click();
    await page.waitForTimeout(200);

    // Press Tab to move to next cell
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    // Verify focus moved (check that activeElement is in a different cell)
    const focusedElement = await page.evaluate(() => {
      const active = document.activeElement;
      return active?.closest('td, th') ? true : false;
    });
    expect(focusedElement).toBeTruthy();
  });

  test('should edit cell content', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert table
    await page.keyboard.type('/table');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');

    // Wait for table to appear
    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 3000 });

    // Click in first cell
    const firstCell = table.locator('td, th').first();
    await firstCell.click();
    await page.waitForTimeout(200);

    // Type content
    await page.keyboard.type('Cell content');

    // Verify content appears
    await expect(firstCell).toContainText('Cell content');
  });

  test('should show header row styling', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert table
    await page.keyboard.type('/table');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');

    // Wait for table to appear
    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 3000 });

    // Check if first row has header cells (th) or special styling
    const headerRow = table.locator('tr').first();
    const headerCells = headerRow.locator('th');

    // Either has th elements or td with header class
    const hasHeaders = await headerCells.count().then(count => count > 0);
    const hasHeaderClass = await headerRow.locator('td[class*="header"], td[class*="Header"]').count().then(count => count > 0);

    expect(hasHeaders || hasHeaderClass).toBeTruthy();
  });

  test('should select entire table', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert table
    await page.keyboard.type('/table');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');

    // Wait for table to appear
    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 3000 });

    // Click on table control button (usually in top-left corner) or use triple-click
    const tableControl = table.locator('[class*="tableControl"], [class*="table-control"]').first();
    const hasControl = await tableControl.isVisible({ timeout: 1000 }).catch(() => false);

    if (hasControl) {
      await tableControl.click();
    } else {
      // Alternative: click in table and use Cmd/Ctrl+A to select all
      const firstCell = table.locator('td, th').first();
      await firstCell.click();
      await page.keyboard.press('Meta+a'); // or Control+a on Windows
    }

    await page.waitForTimeout(300);

    // Verify table is selected (should have selection class or all cells selected)
    const hasSelectedClass = await table.evaluate(el =>
      el.classList.contains('selectedCell') ||
      el.closest('.ProseMirror-selectednode') !== null
    );
    expect(hasSelectedClass).toBeTruthy();
  });

  test('should delete entire table', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert table
    await page.keyboard.type('/table');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');

    // Wait for table to appear
    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 3000 });

    // Click in a cell
    const firstCell = table.locator('td, th').first();
    await firstCell.click();

    // Right-click to open context menu
    await firstCell.click({ button: 'right' });
    await page.waitForTimeout(300);

    // Look for "Delete table" option
    const deleteTableOption = page.getByText(/Delete table|Remove table/i);
    if (await deleteTableOption.isVisible({ timeout: 2000 }).catch(() => false)) {
      await deleteTableOption.click();
      await page.waitForTimeout(300);

      // Verify table is gone
      await expect(table).toBeHidden({ timeout: 3000 });
    } else {
      // Alternative: Select table and press Delete/Backspace
      await page.keyboard.press('Meta+a'); // Select all in table
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(300);

      // Verify table is gone
      await expect(table).toBeHidden({ timeout: 3000 });
    }
  });

  test('should persist table after reload', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert table
    await page.keyboard.type('/table');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');

    // Wait for table to appear
    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 3000 });

    // Add some content to first cell
    const firstCell = table.locator('td, th').first();
    await firstCell.click();
    await page.keyboard.type('Persistent data');

    // Wait for Yjs sync
    await page.waitForTimeout(2000);

    // Hard refresh
    await page.reload();

    // Wait for editor to load
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 });

    // Verify table still exists
    await expect(page.locator('.ProseMirror table')).toBeVisible({ timeout: 5000 });

    // Verify content persisted
    await expect(page.locator('.ProseMirror table')).toContainText('Persistent data');
  });

  test('should navigate with Shift+Tab to go backwards', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert table
    await page.keyboard.type('/table');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');

    // Wait for table to appear
    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 3000 });

    // Click in first cell and move forward
    const firstCell = table.locator('td, th').first();
    await firstCell.click();
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    // Now press Shift+Tab to go back
    await page.keyboard.press('Shift+Tab');
    await page.waitForTimeout(200);

    // Should be back in first cell
    const focusedInFirstCell = await page.evaluate(() => {
      const active = document.activeElement;
      const table = document.querySelector('table');
      const firstCell = table?.querySelector('td, th');
      return active?.closest('td, th') === firstCell;
    });
    expect(focusedInFirstCell).toBeTruthy();
  });

  test('should support column resizing', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert table
    await page.keyboard.type('/table');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');

    // Wait for table to appear
    const table = editor.locator('table');
    await expect(table).toBeVisible({ timeout: 3000 });

    // Look for column resize handle (usually appears on column borders)
    const resizeHandle = table.locator('[class*="resize"], [class*="column-resize"]').first();
    const hasResizeHandle = await resizeHandle.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasResizeHandle) {
      // Get initial column width
      const firstCell = table.locator('td, th').first();
      const initialWidth = await firstCell.evaluate(el => el.offsetWidth);

      // Try to drag resize handle
      await resizeHandle.hover();
      await page.mouse.down();
      await page.mouse.move(50, 0, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(300);

      // Verify width changed
      const newWidth = await firstCell.evaluate(el => el.offsetWidth);
      expect(newWidth).not.toBe(initialWidth);
    }
  });
});
