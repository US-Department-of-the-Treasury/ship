import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'

describe('Health endpoint', () => {
  const app = createApp()

  it('returns ok status with audit_status, cloudwatch_audit_status, and audit_logs_size_bytes', async () => {
    const response = await request(app).get('/health')

    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
    expect(response.body.audit_status).toBe('ok')
    expect(response.body.cloudwatch_audit_status).toBe('disabled') // No CLOUDWATCH_AUDIT_LOG_GROUP in test env
    expect(response.body.audit_logs_size_bytes).toBeGreaterThanOrEqual(0) // AU-4 storage monitoring
    expect(response.headers['content-type']).toMatch(/json/)
  })
})
