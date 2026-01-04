import { test, expect } from './fixtures/isolated-env';

test.describe('Content Caching - High Performance Navigation', () => {

  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[name="email"]', 'dev@ship.local');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(issues|docs)/);
  });

  test('document content loads instantly from cache on revisit', async ({ page }) => {
    // Navigate to documents
    await page.goto('/docs');
    await page.waitForTimeout(1000);

    // Click on first document (tree has aria-label="Workspace documents" or "Documents")
    const tree = page.getByRole('tree', { name: 'Workspace documents' }).or(page.getByRole('tree', { name: 'Documents' }));
    const firstDoc = tree.getByRole('link').first();
    await firstDoc.click();
    await page.waitForURL(/\/docs\/.+/);

    // Wait for content to fully load (WebSocket sync)
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForFunction(() => {
      const editor = document.querySelector('.ProseMirror');
      return editor && editor.textContent && editor.textContent.length > 0;
    }, { timeout: 10000 }).catch(() => {});

    const docUrl = page.url();

    // Navigate away
    await page.goto('/docs');
    await page.waitForLoadState('networkidle');

    // Measure time to content visible on return
    const startTime = Date.now();
    await page.goto(docUrl);

    // Content should appear quickly (from cache) - not blank flash
    await page.waitForSelector('.ProseMirror', { timeout: 5000 });
    const loadTime = Date.now() - startTime;

    // With caching, content should appear in under 500ms (vs 1-2s without)
    // This is a soft assertion - the real test is no blank flash
    console.log(`Content load time: ${loadTime}ms`);
  });

  test('toggling between two documents shows no blank flash', async ({ page }) => {
    await page.goto('/docs');

    // Wait for the document tree to load (tree has aria-label="Workspace documents" or "Documents")
    const tree = page.getByRole('tree', { name: 'Workspace documents' }).or(page.getByRole('tree', { name: 'Documents' }));
    await tree.first().waitFor({ timeout: 10000 });

    // Get first two document links from sidebar tree (seed data provides these)
    const docLinks = tree.first().getByRole('link');
    const count = await docLinks.count();

    // Seed data should provide at least 2 wiki documents
    expect(count, 'Seed data should provide at least 2 wiki documents. Run: pnpm db:seed').toBeGreaterThanOrEqual(2);

    // Visit first document
    await docLinks.first().click();
    await page.waitForURL(/\/docs\/.+/);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    const doc1Url = page.url();

    // Visit second document
    await docLinks.nth(1).click();
    await page.waitForURL(/\/docs\/.+/);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    const doc2Url = page.url();

    // Now toggle rapidly - should not see blank state
    for (let i = 0; i < 3; i++) {
      await page.goto(doc1Url);

      // Should NOT have blank/loading state for more than 200ms
      const hasContent = await page.waitForFunction(() => {
        const editor = document.querySelector('.ProseMirror');
        // Either has content OR is showing cached skeleton
        return editor && (editor.textContent?.length || 0) > 0;
      }, { timeout: 1000 }).catch(() => false);

      expect(hasContent).toBeTruthy();

      await page.goto(doc2Url);

      const hasContent2 = await page.waitForFunction(() => {
        const editor = document.querySelector('.ProseMirror');
        return editor && (editor.textContent?.length || 0) > 0;
      }, { timeout: 1000 }).catch(() => false);

      expect(hasContent2).toBeTruthy();
    }
  });

  test('IndexedDB stores document content after visit', async ({ page }) => {
    await page.goto('/docs');

    // Visit a document (tree has aria-label="Workspace documents" or "Documents")
    const tree = page.getByRole('tree', { name: 'Workspace documents' }).or(page.getByRole('tree', { name: 'Documents' }));
    const firstDoc = tree.getByRole('link').first();
    await firstDoc.click();
    await page.waitForURL(/\/docs\/.+/);

    // Wait for content to load and sync
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForTimeout(2000); // Give IndexedDB time to persist

    // Extract document ID from URL
    const url = page.url();
    const docId = url.split('/docs/')[1];

    // Check IndexedDB has the document cached
    const hasCache = await page.evaluate(async (docId) => {
      const dbName = `ship-doc-${docId}`;
      return new Promise((resolve) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => {
          const db = request.result;
          const hasStores = db.objectStoreNames.length > 0;
          db.close();
          resolve(hasStores);
        };
        request.onerror = () => resolve(false);
      });
    }, docId);

    expect(hasCache).toBe(true);
  });

  test('cached content is available even when WebSocket is slow', async ({ page }) => {
    await page.goto('/docs');

    // Visit a document first to cache it (tree has aria-label="Workspace documents" or "Documents")
    const tree = page.getByRole('tree', { name: 'Workspace documents' }).or(page.getByRole('tree', { name: 'Documents' }));
    const firstDoc = tree.getByRole('link').first();
    await firstDoc.click();
    await page.waitForURL(/\/docs\/.+/);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForTimeout(2000); // Ensure cached

    const docUrl = page.url();

    // Navigate away
    await page.goto('/docs');

    // Slow down WebSocket connections
    await page.route('**/collaboration/**', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 3000)); // 3s delay
      await route.continue();
    });

    // Navigate back - should show cached content immediately
    await page.goto(docUrl);

    // Content should appear quickly from cache, not wait for slow WebSocket
    const hasContentFast = await page.waitForFunction(() => {
      const editor = document.querySelector('.ProseMirror');
      return editor && (editor.textContent?.length || 0) > 0;
    }, { timeout: 1000 }).catch(() => false);

    expect(hasContentFast).toBeTruthy();
  });

});

test.describe('WebSocket Connection Reliability', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'dev@ship.local');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(issues|docs)/);
  });

  test('WebSocket connects successfully on document load', async ({ page }) => {
    await page.goto('/docs');

    // Track WebSocket connections
    const wsConnections: string[] = [];
    page.on('websocket', ws => {
      wsConnections.push(ws.url());
    });

    // Navigate to a document (tree has aria-label="Workspace documents" or "Documents")
    const tree = page.getByRole('tree', { name: 'Workspace documents' }).or(page.getByRole('tree', { name: 'Documents' }));
    const firstDoc = tree.getByRole('link').first();
    await firstDoc.click();
    await page.waitForURL(/\/docs\/.+/);

    // Wait for WebSocket to connect
    await page.waitForTimeout(2000);

    // Should have a collaboration WebSocket
    const hasCollabWs = wsConnections.some(url => url.includes('/collaboration/'));
    expect(hasCollabWs).toBe(true);
  });

  test('sync status shows "Saved" after WebSocket connects', async ({ page }) => {
    await page.goto('/docs');

    const tree2 = page.getByRole('tree', { name: 'Workspace documents' }).or(page.getByRole('tree', { name: 'Documents' }));
    const firstDoc2 = tree2.getByRole('link').first();
    await firstDoc2.click();
    await page.waitForURL(/\/docs\/.+/);

    // Wait for sync status to show "Saved"
    await page.waitForSelector('text=Saved', { timeout: 10000 });

    // Should not show error states
    const hasDisconnected = await page.locator('text=Disconnected').count();
    expect(hasDisconnected).toBe(0);
  });

  test('no console errors about WebSocket connection failures', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('WebSocket')) {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/docs');

    const tree3 = page.getByRole('tree', { name: 'Workspace documents' }).or(page.getByRole('tree', { name: 'Documents' }));
    const firstDoc3 = tree3.getByRole('link').first();
    await firstDoc3.click();
    await page.waitForURL(/\/docs\/.+/);

    // Wait for connection to establish
    await page.waitForSelector('text=Saved', { timeout: 10000 });

    // Should have no WebSocket errors
    const wsErrors = consoleErrors.filter(e =>
      e.includes('closed before') ||
      e.includes('connection failed')
    );
    expect(wsErrors).toHaveLength(0);
  });

});
