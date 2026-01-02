import { test, expect } from '@playwright/test';

// Helper to create a new document and return its URL
// CRITICAL: Must track current URL and wait for it to CHANGE
async function createNewDocument(page: import('@playwright/test').Page): Promise<string> {
  // Store the current URL before clicking
  const currentUrl = page.url();

  // Use the same selector pattern as the working test
  const createButton = page.locator('aside').getByRole('button', { name: /new|create|\+/i }).first();

  if (await createButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    await createButton.click();
  } else {
    // Fallback to main button
    await page.getByRole('button', { name: /new document/i }).click();
  }

  // Wait for URL to change to a DIFFERENT doc URL
  await page.waitForFunction(
    (oldUrl: string) => {
      const url = window.location.href;
      return url !== oldUrl && url.includes('/docs/');
    },
    currentUrl,
    { timeout: 10000 }
  );

  const newUrl = page.url();

  // Wait for editor
  await page.waitForSelector('.ProseMirror', { timeout: 10000 });
  await page.waitForSelector('text=Saved', { timeout: 15000 });

  return newUrl;
}

test.describe('Document Isolation - Critical Data Integrity', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'dev@ship.local');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(issues|docs)/);
  });

  test('content typed in one document does NOT appear in another document', async ({ page }) => {
    // Navigate to documents
    await page.goto('/docs');
    await page.waitForTimeout(1000);

    // Create first document
    const doc1Url = await createNewDocument(page);
    const doc1Id = doc1Url.split('/docs/')[1];

    // Type unique content in doc 1
    const doc1Content = `UNIQUE_DOC1_${Date.now()}_ISOLATION_TEST`;
    await page.locator('.ProseMirror').click();
    await page.keyboard.type(doc1Content);

    // Wait for sync
    await page.waitForTimeout(2000);

    // Navigate back to docs list to create second document
    await page.goto('/docs');
    await page.waitForTimeout(1000);

    // Create second document
    const doc2Url = await createNewDocument(page);
    const doc2Id = doc2Url.split('/docs/')[1];

    // Ensure we're on a different document
    expect(doc2Id).not.toBe(doc1Id);

    // Type unique content in doc 2
    const doc2Content = `UNIQUE_DOC2_${Date.now()}_ISOLATION_TEST`;
    await page.locator('.ProseMirror').click();
    await page.keyboard.type(doc2Content);

    // Wait for sync
    await page.waitForTimeout(2000);

    // CRITICAL TEST: Navigate back to doc 1 and verify it ONLY has doc1Content
    await page.goto(doc1Url);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 15000 });

    const doc1FinalContent = await page.locator('.ProseMirror').textContent();

    // Doc 1 should contain its own content
    expect(doc1FinalContent).toContain(doc1Content);

    // Doc 1 should NOT contain doc 2's content
    expect(doc1FinalContent).not.toContain(doc2Content);

    // CRITICAL TEST: Navigate to doc 2 and verify it ONLY has doc2Content
    await page.goto(doc2Url);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 15000 });

    const doc2FinalContent = await page.locator('.ProseMirror').textContent();

    // Doc 2 should contain its own content
    expect(doc2FinalContent).toContain(doc2Content);

    // Doc 2 should NOT contain doc 1's content
    expect(doc2FinalContent).not.toContain(doc1Content);
  });

  test('rapid navigation between documents does not cause content contamination', async ({ page }) => {
    await page.goto('/docs');
    await page.waitForTimeout(1000);

    // Get existing document links from sidebar
    const docLinks = page.locator('aside ul li button');
    const count = await docLinks.count();

    if (count < 2) {
      test.skip();
      return;
    }

    // Navigate to first document and note its content
    await docLinks.first().click();
    await page.waitForURL(/\/docs\/.+/);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 15000 });

    const doc1Url = page.url();
    const doc1InitialContent = await page.locator('.ProseMirror').textContent() || '';

    // Navigate to second document
    await docLinks.nth(1).click();
    await page.waitForURL(/\/docs\/.+/);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 15000 });

    const doc2Url = page.url();
    const doc2InitialContent = await page.locator('.ProseMirror').textContent() || '';

    // Rapidly toggle between documents 5 times
    for (let i = 0; i < 5; i++) {
      await page.goto(doc1Url);
      await page.waitForSelector('.ProseMirror', { timeout: 5000 });

      await page.goto(doc2Url);
      await page.waitForSelector('.ProseMirror', { timeout: 5000 });
    }

    // Wait for everything to settle
    await page.waitForTimeout(2000);

    // Verify doc 1 content hasn't changed
    await page.goto(doc1Url);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 15000 });

    const doc1FinalContent = await page.locator('.ProseMirror').textContent() || '';

    // Content should be same as before rapid navigation
    if (doc1InitialContent.length > 10) {
      expect(doc1FinalContent).toContain(doc1InitialContent.substring(0, 50));
    }

    // Verify doc 2 content hasn't changed
    await page.goto(doc2Url);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 15000 });

    const doc2FinalContent = await page.locator('.ProseMirror').textContent() || '';

    if (doc2InitialContent.length > 10) {
      expect(doc2FinalContent).toContain(doc2InitialContent.substring(0, 50));
    }
  });

  test('editing while rapidly switching documents stays isolated', async ({ page }) => {
    await page.goto('/docs');
    await page.waitForTimeout(1000);

    // Create first document
    const doc1Url = await createNewDocument(page);

    // Add content to doc 1
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('DOC1_START');
    await page.waitForTimeout(500);

    // Navigate to create doc 2
    await page.goto('/docs');
    await page.waitForTimeout(500);
    const doc2Url = await createNewDocument(page);

    // Add content to doc 2
    await page.locator('.ProseMirror').click();
    await page.keyboard.type('DOC2_START');
    await page.waitForTimeout(500);

    // Now rapidly switch and type
    for (let i = 0; i < 3; i++) {
      // Go to doc 1 and type
      await page.goto(doc1Url);
      await page.waitForSelector('.ProseMirror', { timeout: 5000 });
      await page.locator('.ProseMirror').click();
      await page.keyboard.type(`_DOC1_ITER${i}`);

      // Go to doc 2 and type
      await page.goto(doc2Url);
      await page.waitForSelector('.ProseMirror', { timeout: 5000 });
      await page.locator('.ProseMirror').click();
      await page.keyboard.type(`_DOC2_ITER${i}`);
    }

    // Wait for sync
    await page.waitForTimeout(3000);

    // Verify doc 1 has only DOC1 content
    await page.goto(doc1Url);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 15000 });

    const doc1Content = await page.locator('.ProseMirror').textContent() || '';

    expect(doc1Content).toContain('DOC1_START');
    expect(doc1Content).toContain('DOC1_ITER0');
    expect(doc1Content).toContain('DOC1_ITER1');
    expect(doc1Content).toContain('DOC1_ITER2');
    expect(doc1Content).not.toContain('DOC2');

    // Verify doc 2 has only DOC2 content
    await page.goto(doc2Url);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 15000 });

    const doc2Content = await page.locator('.ProseMirror').textContent() || '';

    expect(doc2Content).toContain('DOC2_START');
    expect(doc2Content).toContain('DOC2_ITER0');
    expect(doc2Content).toContain('DOC2_ITER1');
    expect(doc2Content).toContain('DOC2_ITER2');
    expect(doc2Content).not.toContain('DOC1');
  });

});

test.describe('Document Isolation - Cross Document Type', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'dev@ship.local');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(issues|docs)/);
  });

  test('wiki document and issue document stay isolated', async ({ page }) => {
    // Create content in a wiki document
    await page.goto('/docs');
    await page.waitForTimeout(1000);

    const docLinks = page.locator('aside ul li button');
    const docCount = await docLinks.count();

    if (docCount === 0) {
      test.skip();
      return;
    }

    await docLinks.first().click();
    await page.waitForURL(/\/docs\/.+/);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 15000 });

    const wikiUrl = page.url();
    const wikiContent = `WIKI_UNIQUE_${Date.now()}`;

    await page.locator('.ProseMirror').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(wikiContent);
    await page.waitForTimeout(2000);

    // Now navigate to an issue
    await page.goto('/issues');
    await page.waitForTimeout(1000);

    const issueLinks = page.locator('aside ul li button');
    const issueCount = await issueLinks.count();

    if (issueCount === 0) {
      test.skip();
      return;
    }

    await issueLinks.first().click();
    await page.waitForURL(/\/issues\/.+/);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 15000 });

    const issueUrl = page.url();
    const issueContent = `ISSUE_UNIQUE_${Date.now()}`;

    await page.locator('.ProseMirror').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(issueContent);
    await page.waitForTimeout(2000);

    // Verify wiki doesn't have issue content
    await page.goto(wikiUrl);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 15000 });

    const finalWikiContent = await page.locator('.ProseMirror').textContent() || '';
    expect(finalWikiContent).toContain(wikiContent);
    expect(finalWikiContent).not.toContain(issueContent);

    // Verify issue doesn't have wiki content
    await page.goto(issueUrl);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 15000 });

    const finalIssueContent = await page.locator('.ProseMirror').textContent() || '';
    expect(finalIssueContent).toContain(issueContent);
    expect(finalIssueContent).not.toContain(wikiContent);
  });

});
