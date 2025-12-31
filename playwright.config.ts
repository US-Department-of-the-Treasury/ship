import { defineConfig, devices } from '@playwright/test'

// Worktree-specific ports (from .env.local files)
const API_PORT = process.env.API_PORT || '3147'
const WEB_PORT = process.env.WEB_PORT || '5320'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 4,  // Limit local parallelism to avoid database conflicts
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm dev:api',
      url: `http://localhost:${API_PORT}/health`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm dev:web',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
