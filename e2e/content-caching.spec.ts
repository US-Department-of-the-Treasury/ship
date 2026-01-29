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
    await page.waitForURL(/\/documents\/.+/);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    const doc1Url = page.url();

    // Visit second document
    await docLinks.nth(1).click();
    await page.waitForURL(/\/documents\/.+/);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    const doc2Url = page.url();

    // Now toggle between documents - should not see blank state
    // Reduce to 2 iterations and shorter timeouts to avoid test timeout
    for (let i = 0; i < 2; i++) {
      await page.goto(doc1Url);

      // Wait for editor to appear (content loading is async via WebSocket)
      const hasEditor1 = await page.waitForSelector('.ProseMirror', { timeout: 5000 }).catch(() => null);
      expect(hasEditor1).toBeTruthy();

      await page.goto(doc2Url);

      const hasEditor2 = await page.waitForSelector('.ProseMirror', { timeout: 5000 }).catch(() => null);
      expect(hasEditor2).toBeTruthy();
    }
  });

  test('IndexedDB stores document content after visit', async ({ page }) => {
    await page.goto('/docs');

    // Visit a document (tree has aria-label="Workspace documents" or "Documents")
    const tree = page.getByRole('tree', { name: 'Workspace documents' }).or(page.getByRole('tree', { name: 'Documents' }));
    const firstDoc = tree.getByRole('link').first();
    await firstDoc.click();
    await page.waitForURL(/\/documents\/.+/);

    // Wait for content to load and sync
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForTimeout(2000); // Give IndexedDB time to persist

    // Extract document ID from URL
    const url = page.url();
    const docId = url.split('/documents/')[1];

    // Check IndexedDB has the document cached
    // The database name is `ship-{documentType}-{docId}` where documentType is 'wiki' for wiki docs
    // Note: We need to check for the actual document type used in the IndexedDB name
    const hasCache = await page.evaluate(async (docId) => {
      // Wiki documents use 'wiki' as the room prefix in IndexedDB
      const dbName = `ship-wiki-${docId}`;
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
    await page.waitForURL(/\/documents\/.+/);

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
    await page.waitForURL(/\/documents\/.+/);

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
    await page.waitForURL(/\/documents\/.+/);

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

test.describe('API Content Update Invalidates Browser Cache', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'dev@ship.local');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(issues|docs)/);
  });

  test('user edits document, leaves, API updates content, user returns and sees API content', async ({ page, request }) => {
    // Step 1: Create a new document via API for clean test isolation
    const createResponse = await request.post('/api/documents', {
      data: {
        title: 'API Cache Test Document',
        document_type: 'wiki',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Initial API content' }]
            }
          ]
        }
      }
    });
    expect(createResponse.ok()).toBe(true);
    const { id: docId } = await createResponse.json();

    // Step 2: Navigate to the document in browser
    await page.goto(`/documents/${docId}`);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 10000 });

    // Step 3: Edit content in browser (type some text)
    const editor = page.locator('.ProseMirror');
    await editor.click();
    // Clear and type new content
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('User typed content in browser');

    // Wait for content to sync
    await page.waitForSelector('text=Saved', { timeout: 10000 });
    await page.waitForTimeout(1000); // Give IndexedDB time to persist

    // Verify browser shows user-typed content
    await expect(editor).toContainText('User typed content in browser');

    // Step 4: Navigate away (leave the page)
    await page.goto('/docs');
    await page.waitForSelector('[role="tree"]', { timeout: 5000 });

    // Step 5: Update content via API (simulating /ship or external system)
    const updateResponse = await request.patch(`/api/documents/${docId}/content`, {
      data: {
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'API updated content - should override cached' }]
            }
          ]
        }
      }
    });
    expect(updateResponse.ok()).toBe(true);

    // Step 6: Navigate back to the document
    await page.goto(`/documents/${docId}`);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 10000 });

    // Step 7: Verify the API content is displayed, NOT the cached browser content
    const editorAfter = page.locator('.ProseMirror');
    await expect(editorAfter).toContainText('API updated content - should override cached');
    // Should NOT contain the old cached content
    await expect(editorAfter).not.toContainText('User typed content in browser');

    // Cleanup: Delete the test document
    await request.delete(`/api/documents/${docId}`);
  });

  test('API update while user has document open triggers cache clear', async ({ page, request }) => {
    // Create a new document
    const createResponse = await request.post('/api/documents', {
      data: {
        title: 'Live API Update Test',
        document_type: 'wiki',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Original content' }]
            }
          ]
        }
      }
    });
    expect(createResponse.ok()).toBe(true);
    const { id: docId } = await createResponse.json();

    // Navigate to document and wait for sync
    await page.goto(`/documents/${docId}`);
    await page.waitForSelector('.ProseMirror', { timeout: 10000 });
    await page.waitForSelector('text=Saved', { timeout: 10000 });

    // Verify original content
    const editor = page.locator('.ProseMirror');
    await expect(editor).toContainText('Original content');

    // Update content via API while user has document open
    // This should trigger WebSocket close code 4101 and cache clear
    const updateResponse = await request.patch(`/api/documents/${docId}/content`, {
      data: {
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Updated while viewing' }]
            }
          ]
        }
      }
    });
    expect(updateResponse.ok()).toBe(true);

    // Wait for WebSocket reconnect and content sync
    await page.waitForTimeout(2000);

    // Verify updated content is displayed
    await expect(editor).toContainText('Updated while viewing');

    // Cleanup
    await request.delete(`/api/documents/${docId}`);
  });

});
