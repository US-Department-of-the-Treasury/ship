/**
 * Category 25: IndexedDB Corruption Recovery
 * Tests handling of corrupted cache data.
 */
import { test, expect } from './fixtures/offline'

test.describe('25.1 Corrupted Cache Handling', () => {
  test('app recovers gracefully from corrupted IndexedDB', async ({ page }) => {
    // GIVEN: IndexedDB has corrupted data (simulated)
    await page.goto('/login')
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page.goto('/docs')

    // Corrupt the IndexedDB
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const request = indexedDB.open('tanstack-query-cache', 1)
        request.onsuccess = () => {
          const db = request.result
          try {
            const tx = db.transaction(['cache'], 'readwrite')
            tx.objectStore('cache').put({ corrupted: true, invalid: 'data' }, 'queries')
            tx.oncomplete = () => resolve()
          } catch {
            resolve() // DB might not have this structure
          }
        }
        request.onerror = () => resolve()
      })
    })

    // WHEN: User reloads app
    await page.reload()

    // THEN: App doesn't crash, loads successfully
    await expect(page.getByTestId('document-list')).toBeVisible({ timeout: 15000 })
  })

  test('handles missing IndexedDB gracefully', async ({ page }) => {
    // GIVEN: IndexedDB throws error on access
    await page.addInitScript(() => {
      const originalOpen = window.indexedDB.open
      let callCount = 0
      window.indexedDB.open = function (...args) {
        callCount++
        // Let initial calls through for app to load, then fail subsequent ones
        if (callCount > 3) {
          throw new Error('IndexedDB unavailable')
        }
        return originalOpen.apply(this, args)
      }
    })

    // WHEN: User loads app
    await page.goto('/login')
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page.goto('/docs')

    // THEN: App still functions (at least for online use)
    await expect(page.getByTestId('document-list')).toBeVisible({ timeout: 15000 })
  })

  test('Yjs corruption triggers fresh sync', async ({ page, login, testData }) => {
    await login()

    // GIVEN: y-indexeddb state might be corrupted
    const doc = testData.wikis[0]
    await page.goto(`/docs/${doc.id}`)

    // Attempt to corrupt Yjs storage
    await page.evaluate(() => {
      return new Promise<void>((resolve) => {
        const request = indexedDB.open('y-indexeddb', 1)
        request.onsuccess = () => {
          const db = request.result
          try {
            // Try to write corrupted data
            const stores = db.objectStoreNames
            if (stores.length > 0) {
              const tx = db.transaction([stores[0]], 'readwrite')
              tx.objectStore(stores[0]).put(new Uint8Array([0, 1, 2, 3]), 'corrupted')
              tx.oncomplete = () => resolve()
            } else {
              resolve()
            }
          } catch {
            resolve()
          }
        }
        request.onerror = () => resolve()
      })
    })

    // WHEN: User reloads document
    await page.reload()

    // THEN: Falls back to server state, doesn't crash
    await expect(page.getByTestId('tiptap-editor')).toBeVisible({ timeout: 15000 })
  })

  test('clear cache option in settings if available', async ({ page, login }) => {
    await login()

    // GIVEN: User navigates to settings (if exists)
    await page.goto('/settings')

    // WHEN: Looking for clear cache option
    const clearButton = page.getByRole('button', { name: /clear.*cache|reset.*offline/i })
    if (await clearButton.isVisible()) {
      await clearButton.click()

      const confirmButton = page.getByRole('button', { name: /confirm/i })
      if (await confirmButton.isVisible()) {
        await confirmButton.click()
      }

      // THEN: Cache is cleared and app still works
      await expect(page.getByText(/cache cleared|reset complete/i)).toBeVisible({ timeout: 5000 })
    }
  })

  test('app handles localStorage quota exceeded', async ({ page }) => {
    // GIVEN: localStorage is full
    await page.addInitScript(() => {
      const originalSetItem = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        // Allow some essential items, throw quota error for others
        if (key.includes('cache') || key.includes('query')) {
          throw new DOMException('QuotaExceededError', 'QuotaExceededError')
        }
        return originalSetItem.call(this, key, value)
      }
    })

    // WHEN: App loads
    await page.goto('/login')
    await page.fill('input[name="email"]', 'dev@ship.local')
    await page.fill('input[name="password"]', 'admin123')
    await page.click('button[type="submit"]')
    await page.waitForURL(/\/(docs|programs|team)/, { timeout: 10000 })

    await page.goto('/docs')

    // THEN: App handles gracefully, core functionality works
    await expect(page.getByTestId('document-list')).toBeVisible({ timeout: 15000 })
  })
})
