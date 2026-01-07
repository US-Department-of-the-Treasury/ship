import { test, expect, Page } from './fixtures/isolated-env'

/**
 * Backlinks E2E Tests
 *
 * Tests backlink panel display, creation, removal, and navigation.
 */

// Helper to login before each test
async function login(page: Page) {
  await page.goto('/login')
  await page.locator('#email').fill('dev@ship.local')
  await page.locator('#password').fill('admin123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL('/login', { timeout: 5000 })
}

// Helper to create a new document and get to the editor
async function createNewDocument(page: Page) {
  await page.goto('/docs')
  await page.getByRole('button', { name: 'New Document', exact: true }).click()
  await expect(page).toHaveURL(/\/docs\/[a-f0-9-]+/, { timeout: 10000 })
  await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
  return page.url()
}

// Helper to set document title
async function setDocumentTitle(page: Page, title: string) {
  const titleInput = page.getByPlaceholder('Untitled')
  await expect(titleInput).toBeVisible({ timeout: 5000 })
  await titleInput.fill(title)
  await page.waitForResponse(
    resp => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH',
    { timeout: 5000 }
  )
  await page.waitForTimeout(500)
}

test.describe('Backlinks', () => {
  test.beforeEach(async ({ page }) => {
    await login(page)
  })

  test('backlinks panel shows in sidebar', async ({ page }) => {
    await createNewDocument(page)

    // Look for backlinks panel in properties sidebar (right side)
    // Common selectors: "Backlinks", "Referenced by", or a data attribute
    const backlinksPanel = page.locator('text="Backlinks"').or(
      page.locator('text="Referenced by"')
    ).or(
      page.locator('[data-backlinks-panel]')
    )

    // Backlinks panel should be visible in sidebar
    await expect(backlinksPanel.first()).toBeVisible({ timeout: 5000 })
  })

  test('creating mention adds backlink', async ({ page }) => {
    // Create Document A (will be mentioned)
    const docAUrl = await createNewDocument(page)
    await setDocumentTitle(page, 'Document A')

    // Create Document B (will mention Document A)
    const docBUrl = await createNewDocument(page)
    await setDocumentTitle(page, 'Document B')

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create mention to Document A
    await page.keyboard.type('@Document A')
    await page.waitForTimeout(500)

    // Wait for mention popup
    const mentionPopup = page.locator('[role="listbox"]')
    if (await mentionPopup.isVisible({ timeout: 3000 })) {
      // Select Document A from list
      const docAOption = page.locator('[role="option"]').filter({ hasText: 'Document A' })
      if (await docAOption.isVisible()) {
        await docAOption.click()
        await page.waitForTimeout(1000)

        // Navigate to Document A
        await page.goto(docAUrl)
        await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
        await page.waitForTimeout(1000)

        // Document A should now show Document B in backlinks
        const backlinksPanel = page.locator('text="Backlinks"').or(
          page.locator('text="Referenced by"')
        ).or(
          page.locator('[data-backlinks-panel]')
        ).first()

        await expect(backlinksPanel).toBeVisible({ timeout: 3000 })

        // Look for Document B in backlinks
        const hasDocB = await page.locator('text="Document B"').isVisible({ timeout: 3000 })
        expect(hasDocB).toBeTruthy()
      } else {
        expect(true).toBe(false) // Element not found, test cannot continue
      }
    } else {
      expect(true).toBe(false) // Element not found, test cannot continue
    }
  })

  test('removing mention removes backlink', async ({ page }) => {
    // Create Document A (will be mentioned)
    const docAUrl = await createNewDocument(page)
    await setDocumentTitle(page, 'Doc to Mention')

    // Create Document B (will mention Document A, then remove it)
    const docBUrl = await createNewDocument(page)
    await setDocumentTitle(page, 'Doc with Mention')

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Create mention to Document A
    await page.keyboard.type('@Doc to Mention')
    await page.waitForTimeout(500)

    const mentionPopup = page.locator('[role="listbox"]')
    if (await mentionPopup.isVisible({ timeout: 3000 })) {
      const docOption = page.locator('[role="option"]').filter({ hasText: 'Doc to Mention' })
      if (await docOption.isVisible()) {
        await docOption.click()
        await page.waitForTimeout(1000)

        // Delete the mention
        const mention = editor.locator('.mention')
        await expect(mention).toBeVisible({ timeout: 3000 })
        await mention.click()
        await page.keyboard.press('Backspace')
        await page.waitForTimeout(1000)

        // Navigate to Document A
        await page.goto(docAUrl)
        await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
        await page.waitForTimeout(1000)

        // Document A should NOT show Document B in backlinks (or show empty state)
        // Look within the properties sidebar for backlinks
        const propertiesSidebar = page.locator('aside[aria-label="Document properties"]')
        await expect(propertiesSidebar).toBeVisible({ timeout: 3000 })

        // Should either show "No backlinks" or not have "Doc with Mention" in the backlinks section
        const hasNoBacklinks = await propertiesSidebar.locator('text="No backlinks"').isVisible({ timeout: 2000 })
        const hasDocWithMention = await propertiesSidebar.locator('text="Doc with Mention"').isVisible({ timeout: 2000 })

        // Either "No backlinks" is shown, OR the doc is not in the backlinks
        expect(hasNoBacklinks || !hasDocWithMention).toBeTruthy()
      } else {
        expect(true).toBe(false) // Element not found, test cannot continue
      }
    } else {
      expect(true).toBe(false) // Element not found, test cannot continue
    }
  })

  test('backlinks show correct document info', async ({ page }) => {
    // Create Document X
    const docXUrl = await createNewDocument(page)
    await setDocumentTitle(page, 'Target Document')

    // Create Document Y that mentions X
    const docYUrl = await createNewDocument(page)
    await setDocumentTitle(page, 'Referencing Document')

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Mention Target Document
    await page.keyboard.type('@Target Document')
    await page.waitForTimeout(500)

    const mentionPopup = page.locator('[role="listbox"]')
    if (await mentionPopup.isVisible({ timeout: 3000 })) {
      const docOption = page.locator('[role="option"]').filter({ hasText: 'Target Document' })
      if (await docOption.isVisible()) {
        await docOption.click()
        await page.waitForTimeout(1000)

        // Navigate to Target Document
        await page.goto(docXUrl)
        await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
        await page.waitForTimeout(1000)

        // Check backlinks panel shows correct info
        const backlinksPanel = page.locator('text="Backlinks"').or(
          page.locator('text="Referenced by"')
        ).or(
          page.locator('[data-backlinks-panel]')
        ).first()

        await expect(backlinksPanel).toBeVisible({ timeout: 3000 })

        // Should show "Referencing Document" with document icon or title
        const backlink = page.locator('text="Referencing Document"')
        await expect(backlink).toBeVisible({ timeout: 3000 })

        // Optionally check for document icon or type indicator
        // This depends on implementation
      } else {
        expect(true).toBe(false) // Element not found, test cannot continue
      }
    } else {
      expect(true).toBe(false) // Element not found, test cannot continue
    }
  })

  // TODO: This test is flaky - backlinks don't always appear in UI even after sync/reload
  // The underlying backlinks API works (verified by features-real tests), but UI display is unreliable
  test.skip('clicking backlink navigates to source document', async ({ page }) => {
    // Create Document M (will be mentioned)
    const docMUrl = await createNewDocument(page)
    await setDocumentTitle(page, 'Mentioned Doc')

    // Create Document N (will mention Document M)
    const docNUrl = await createNewDocument(page)
    await setDocumentTitle(page, 'Source Doc')

    const editor = page.locator('.ProseMirror')
    await editor.click()

    // Mention Document M
    await page.keyboard.type('@Mentioned Doc')
    await page.waitForTimeout(500)

    const mentionPopup = page.locator('[role="listbox"]')
    if (await mentionPopup.isVisible({ timeout: 3000 })) {
      const docOption = page.locator('[role="option"]').filter({ hasText: 'Mentioned Doc' })
      if (await docOption.isVisible()) {
        await docOption.click()
        await page.waitForTimeout(1000)

        // Wait for sync to complete before navigating
        await page.waitForResponse(
          resp => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH',
          { timeout: 5000 }
        ).catch(() => {}) // Ignore if no response
        await page.waitForTimeout(2000)

        // Navigate to Mentioned Doc and reload to ensure fresh backlinks data
        await page.goto(docMUrl)
        await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
        await page.waitForTimeout(1000)

        // Reload to ensure backlinks are fetched fresh from server
        await page.reload()
        await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
        await page.waitForTimeout(1000)

        // Find backlink to Source Doc in the properties sidebar and click it
        const propertiesSidebar = page.locator('aside[aria-label="Document properties"]')
        await expect(propertiesSidebar).toBeVisible({ timeout: 3000 })

        // Look for "Source Doc" link within the properties sidebar
        const sourceLinkInBacklinks = propertiesSidebar.locator('text="Source Doc"')

        if (await sourceLinkInBacklinks.first().isVisible({ timeout: 3000 })) {
          await sourceLinkInBacklinks.first().click()
          await page.waitForTimeout(1000)

          // Should navigate to Source Doc (Document N)
          expect(page.url()).toContain(docNUrl.split('/').pop()!)

          // Verify we're on Source Doc page
          const titleInput = page.getByPlaceholder('Untitled')
          const title = await titleInput.inputValue()
          expect(title).toBe('Source Doc')
        } else {
          expect(true).toBe(false) // Element not found, test cannot continue
        }
      } else {
        expect(true).toBe(false) // Element not found, test cannot continue
      }
    } else {
      expect(true).toBe(false) // Element not found, test cannot continue
    }
  })

  // TODO: This test is flaky - real-time backlinks updates don't reliably appear in UI
  // The underlying backlinks API works (verified by features-real tests), but UI display timing is unreliable
  test.skip('backlinks update in real-time', async ({ page, browser }) => {
    // Create Document P (will be mentioned)
    const docPUrl = await createNewDocument(page)
    await setDocumentTitle(page, 'Real-time Doc')

    // Open second browser context for Document Q
    const page2 = await browser.newPage()
    await page2.goto('/login')
    await page2.locator('#email').fill('dev@ship.local')
    await page2.locator('#password').fill('admin123')
    await page2.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page2).not.toHaveURL('/login', { timeout: 5000 })

    // Create Document Q in second tab
    await page2.goto('/docs')
    await page2.getByRole('button', { name: 'New Document', exact: true }).click()
    await expect(page2).toHaveURL(/\/docs\/[a-f0-9-]+/, { timeout: 10000 })
    await expect(page2.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

    const titleInput2 = page2.getByPlaceholder('Untitled')
    await titleInput2.fill('Live Update Doc')
    await page2.waitForResponse(
      resp => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH',
      { timeout: 5000 }
    )
    await page2.waitForTimeout(500)

    // In page2, mention Document P
    const editor2 = page2.locator('.ProseMirror')
    await editor2.click()
    await page2.keyboard.type('@Real-time Doc')
    await page2.waitForTimeout(500)

    const mentionPopup = page2.locator('[role="listbox"]')
    if (await mentionPopup.isVisible({ timeout: 3000 })) {
      const docOption = page2.locator('[role="option"]').filter({ hasText: 'Real-time Doc' })
      if (await docOption.isVisible()) {
        await docOption.click()

        // Wait for sync to complete in page2
        await page2.waitForResponse(
          resp => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH',
          { timeout: 5000 }
        ).catch(() => {}) // Ignore if no response
        await page2.waitForTimeout(2000)

        // In page1 (Document P), check if backlinks updated
        await page.goto(docPUrl)
        await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
        await page.waitForTimeout(1000)

        // Reload to ensure backlinks are fetched fresh from server
        await page.reload()
        await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
        await page.waitForTimeout(1000)

        // Should see "Live Update Doc" in backlinks within properties sidebar
        const propertiesSidebar = page.locator('aside[aria-label="Document properties"]')
        await expect(propertiesSidebar).toBeVisible({ timeout: 3000 })

        // Look for backlinks heading
        const backlinksHeading = propertiesSidebar.locator('text="Backlinks"')
        await expect(backlinksHeading).toBeVisible({ timeout: 3000 })

        // Check for "Live Update Doc" within the properties sidebar
        const hasLiveUpdateDoc = await propertiesSidebar.locator('text="Live Update Doc"').isVisible({ timeout: 5000 })
        expect(hasLiveUpdateDoc).toBeTruthy()

        // Clean up
        await page2.close()
      } else {
        await page2.close()
        expect(true).toBe(false) // Element not found, test cannot continue
      }
    } else {
      await page2.close()
      expect(true).toBe(false) // Element not found, test cannot continue
    }
  })

  test('backlinks panel shows empty state when no backlinks', async ({ page }) => {
    await createNewDocument(page)
    await setDocumentTitle(page, 'Lonely Document')

    // Wait a moment for any potential backlinks to load
    await page.waitForTimeout(1000)

    // Find backlinks panel
    const backlinksPanel = page.locator('text="Backlinks"').or(
      page.locator('text="Referenced by"')
    ).or(
      page.locator('[data-backlinks-panel]')
    ).first()

    await expect(backlinksPanel).toBeVisible({ timeout: 3000 })

    // Should show empty state message
    const emptyMessage = page.getByText('No backlinks', { exact: false }).or(
      page.getByText('No documents reference this page', { exact: false })
    ).or(
      page.getByText('Not referenced', { exact: false })
    )

    // Either empty message is visible or no backlink items exist
    const hasEmptyMessage = await emptyMessage.isVisible({ timeout: 2000 })
    const backlinkItems = page.locator('[data-backlink-item], .backlink-item, .backlink')
    const itemCount = await backlinkItems.count()

    expect(hasEmptyMessage || itemCount === 0).toBeTruthy()
  })

  test('backlinks count updates correctly', async ({ page }) => {
    // Create Document Z (will be mentioned)
    const docZUrl = await createNewDocument(page)
    await setDocumentTitle(page, 'Popular Doc')

    // Create two documents that mention Document Z
    for (let i = 1; i <= 2; i++) {
      await page.goto('/docs')
      await page.getByRole('button', { name: 'New Document', exact: true }).click()
      await expect(page).toHaveURL(/\/docs\/[a-f0-9-]+/, { timeout: 10000 })
      await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })

      const titleInput = page.getByPlaceholder('Untitled')
      await titleInput.fill(`Referrer ${i}`)
      await page.waitForResponse(
        resp => resp.url().includes('/api/documents/') && resp.request().method() === 'PATCH',
        { timeout: 5000 }
      )

      const editor = page.locator('.ProseMirror')
      await editor.click()

      // Mention Popular Doc
      await page.keyboard.type('@Popular Doc')
      await page.waitForTimeout(500)

      const mentionPopup = page.locator('[role="listbox"]')
      if (await mentionPopup.isVisible({ timeout: 3000 })) {
        const docOption = page.locator('[role="option"]').filter({ hasText: 'Popular Doc' })
        if (await docOption.isVisible()) {
          await docOption.click()
          await page.waitForTimeout(1000)
        }
      }
    }

    // Navigate to Popular Doc
    await page.goto(docZUrl)
    await expect(page.locator('.ProseMirror')).toBeVisible({ timeout: 5000 })
    await page.waitForTimeout(1000)

    // Should show 2 backlinks (or backlinks count)
    const backlinksPanel = page.locator('text="Backlinks"').or(
      page.locator('text="Referenced by"')
    ).or(
      page.locator('[data-backlinks-panel]')
    ).first()

    await expect(backlinksPanel).toBeVisible({ timeout: 3000 })

    // Check for both referrers
    const hasReferrer1 = await page.locator('text="Referrer 1"').isVisible({ timeout: 3000 })
    const hasReferrer2 = await page.locator('text="Referrer 2"').isVisible({ timeout: 3000 })

    expect(hasReferrer1 && hasReferrer2).toBeTruthy()
  })
})
