/**
 * Dev Server Fixture
 *
 * A lightweight fixture that connects to already-running dev servers.
 * Use this when:
 * - You're developing tests locally and want fast iteration
 * - System has low memory and can't spin up isolated environments
 * - You want to run quick smoke tests
 *
 * Unlike isolated-env, this does NOT provide:
 * - Test isolation (tests share the same database)
 * - Per-worker containers
 *
 * Prerequisites:
 * - Run `pnpm dev` in another terminal before running tests
 * - Default ports: API on 3000, Web on 5173
 */

import { test as base, Page, expect } from '@playwright/test'

// Allow port override via env vars
const API_PORT = process.env.TEST_API_PORT || '3000'
const WEB_PORT = process.env.TEST_WEB_PORT || '5173'
const WEB_URL = `http://localhost:${WEB_PORT}`

export interface DevServerFixtures {
  apiUrl: string
  webUrl: string
}

export const test = base.extend<DevServerFixtures>({
  // Set baseURL for all page navigations
  baseURL: async ({}, use) => {
    await use(WEB_URL)
  },

  // No container setup - just use existing dev servers
  apiUrl: async ({}, use) => {
    await use(`http://localhost:${API_PORT}`)
  },

  webUrl: async ({}, use) => {
    await use(WEB_URL)
  },

  // Playwright creates a fresh browser context per test by default
  // No need for explicit storageState - it causes SecurityError on about:blank
})

export { expect }
export type { Page }
