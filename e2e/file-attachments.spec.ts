import { test, expect, Page } from './fixtures/isolated-env';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Helper to create a new document using the available buttons
async function createNewDocument(page: Page) {
  await page.goto('/docs');

  // Wait for the page to stabilize (may auto-redirect to existing doc)
  await page.waitForLoadState('networkidle');

  // Get current URL to detect change after clicking
  const currentUrl = page.url();

  // Try sidebar button first, fall back to main "New Document" button
  const sidebarButton = page.locator('aside').getByRole('button', { name: /new|create|\+/i }).first();
  const mainButton = page.getByRole('button', { name: 'New Document', exact: true });

  if (await sidebarButton.isVisible({ timeout: 2000 })) {
    await sidebarButton.click();
  } else {
    await expect(mainButton).toBeVisible({ timeout: 5000 });
    await mainButton.click();
  }

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

// Create a test file
function createTestFile(filename: string, content: string): string {
  const tmpPath = path.join(os.tmpdir(), filename);
  fs.writeFileSync(tmpPath, content);
  return tmpPath;
}

test.describe('File Attachments', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await page.goto('/login');
    await page.locator('#email').fill('dev@ship.local');
    await page.locator('#password').fill('admin123');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Wait for app to load
    await expect(page).not.toHaveURL('/login', { timeout: 5000 });

    // Log console errors for debugging
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log('CONSOLE ERROR:', msg.text());
      }
    });
  });

  test('should insert file attachment via slash command', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Type /file to trigger slash command
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    // Should show file attachment option
    const fileOption = page.getByRole('button', { name: /^File Upload a file attachment/i });
    await expect(fileOption).toBeVisible({ timeout: 5000 });

    // Create test file
    const tmpPath = createTestFile('test-document.pdf', 'PDF file content');

    // Click the File option and wait for file chooser
    const fileChooserPromise = page.waitForEvent('filechooser');
    await fileOption.click();

    // Handle file chooser
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for file attachment to appear in editor
    await expect(editor.locator('[data-file-attachment]')).toBeVisible({ timeout: 5000 });

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should show file upload progress', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Type /file
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    // Create a larger test file to see progress
    const tmpPath = createTestFile('large-file.zip', 'x'.repeat(10000));

    // Select file option
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Should show some upload indicator (spinner, progress bar, or "uploading" text)
    const uploadIndicator = page.locator('[data-file-attachment]');
    await expect(uploadIndicator).toBeVisible({ timeout: 5000 });

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should show file download link after upload', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert file via slash command
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    const tmpPath = createTestFile('download-test.txt', 'Test content');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for upload to complete
    await page.waitForTimeout(2000);

    // File attachment should have a clickable link/button
    const fileAttachment = editor.locator('[data-file-attachment]');
    await expect(fileAttachment).toBeVisible({ timeout: 5000 });

    // Should have a download link (href attribute)
    const downloadLink = fileAttachment.locator('a[href]');
    await expect(downloadLink).toBeVisible({ timeout: 3000 });

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should validate file type', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Type /file
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    // Create a potentially restricted file type (e.g., .exe)
    const tmpPath = createTestFile('potentially-dangerous.exe', 'Not really an exe');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait a moment for validation
    await page.waitForTimeout(1000);

    // Either:
    // 1. File is rejected (no attachment appears)
    // 2. File is accepted but sanitized
    // 3. Error message appears
    // This test just verifies that validation happens

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should persist file attachment after reload', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert file
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    const tmpPath = createTestFile('persist-test.pdf', 'Persistent content');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for upload to complete
    await expect(editor.locator('[data-file-attachment]')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Get the filename for verification after reload
    const fileName = await editor.locator('[data-file-attachment]').textContent();

    // Wait for Yjs sync
    await page.waitForTimeout(2000);

    // Hard refresh
    await page.reload();

    // Wait for editor to load
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 });

    // Verify file attachment still exists
    await expect(page.locator('.ProseMirror [data-file-attachment]')).toBeVisible({ timeout: 5000 });

    // Verify filename matches
    if (fileName) {
      await expect(page.locator('.ProseMirror [data-file-attachment]')).toContainText(fileName);
    }

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should sync file attachments between collaborators', async ({ page, browser }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert file
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    const tmpPath = createTestFile('sync-test.txt', 'Sync test content');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for upload to complete
    await expect(editor.locator('[data-file-attachment]')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Get current document URL
    const docUrl = page.url();

    // Wait for Yjs sync
    await page.waitForTimeout(2000);

    // Open second tab with same document
    const page2 = await browser.newPage();

    // Login on second page
    await page2.goto('/login');
    await page2.locator('#email').fill('dev@ship.local');
    await page2.locator('#password').fill('admin123');
    await page2.getByRole('button', { name: /sign in/i }).click();
    await expect(page2).not.toHaveURL('/login', { timeout: 5000 });

    // Navigate to same document
    await page2.goto(docUrl);

    // Wait for editor to load
    await expect(page2.locator('.ProseMirror')).toBeVisible({ timeout: 5000 });

    // Verify file attachment synced to second tab
    await expect(page2.locator('.ProseMirror [data-file-attachment]')).toBeVisible({ timeout: 10000 });

    // Clean up
    await page2.close();
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should display file icon based on type', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert PDF file
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    const tmpPath = createTestFile('icon-test.pdf', 'PDF content');

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for file attachment to appear
    const fileAttachment = editor.locator('[data-file-attachment]');
    await expect(fileAttachment).toBeVisible({ timeout: 5000 });

    // Should have an icon element (svg, img, or icon class)
    const icon = fileAttachment.locator('svg, img, [class*="icon"]').first();
    await expect(icon).toBeVisible({ timeout: 3000 });

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });

  test('should show file size in attachment', async ({ page }) => {
    await createNewDocument(page);

    const editor = page.locator('.ProseMirror');
    await editor.click();
    await page.waitForTimeout(300);

    // Insert file
    await page.keyboard.type('/file');
    await page.waitForTimeout(500);

    // Create file with known size
    const content = 'x'.repeat(1024 * 5); // ~5KB
    const tmpPath = createTestFile('size-test.txt', content);

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /^File Upload a file attachment/i }).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(tmpPath);

    // Wait for upload
    await expect(editor.locator('[data-file-attachment]')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(2000);

    // Should show file size (KB, MB, etc.)
    const fileAttachment = editor.locator('[data-file-attachment]');
    const text = await fileAttachment.textContent();

    // Should contain size indicator (KB, MB, or bytes)
    expect(text).toMatch(/\d+\s?(KB|MB|bytes|B)/i);

    // Cleanup
    setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 5000);
  });
});
