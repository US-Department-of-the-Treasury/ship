import { beforeAll, afterAll } from 'vitest'

// Test setup for API integration tests
// This runs before all tests

beforeAll(async () => {
  // Ensure test environment
  process.env.NODE_ENV = 'test'
})

afterAll(async () => {
  // Cleanup if needed
})
