import { describe, expect, it } from 'vitest'
import { buildApp } from './app.js'

describe('GET /api/meta', () => {
  it('responds with the placeholder payload', async () => {
    const app = buildApp()
    const response = await app.inject({ method: 'GET', url: '/api/meta' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ready: true })
  })
})
