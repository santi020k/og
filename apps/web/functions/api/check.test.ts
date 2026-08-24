import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { onRequestPost } from './check.js'

const request = (url: string, headers: HeadersInit = {}): Request => new Request(
  'https://og.santi020k.com/api/check',
  {
    body: JSON.stringify({ turnstileToken: 'verified-token', url }),
    headers: {
      'cf-connecting-ip': '192.0.2.10',
      'content-type': 'application/json',
      origin: 'https://og.santi020k.com',
      ...Object.fromEntries(new Headers(headers))
    },
    method: 'POST'
  }
)

const context = (input: Request) => ({
  env: { TURNSTILE_SECRET_KEY: 'test-secret' },
  request: input
})

describe('hosted checker protections', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({
      action: 'inspect',
      hostname: 'og.santi020k.com',
      success: true
    }))))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('rejects cross-site requests before human verification', async () => {
    const input = request('https://example.com', { origin: 'https://attacker.example' })
    const response = await onRequestPost(context(input))

    expect(response.status).toBe(403)
    expect(fetch).not.toHaveBeenCalled()
  })

  test('fails closed when the Turnstile secret is unavailable', async () => {
    const response = await onRequestPost({ env: {}, request: request('https://example.com') })

    expect(response.status).toBe(503)
  })

  test('rejects oversized bodies when content length is unavailable', async () => {
    const input = new Request('https://og.santi020k.com/api/check', {
      body: JSON.stringify({ padding: 'x'.repeat(4_096), turnstileToken: 'verified-token', url: 'https://example.com' }),
      headers: {
        'content-type': 'application/json',
        origin: 'https://og.santi020k.com'
      },
      method: 'POST'
    })

    input.headers.delete('content-length')

    const response = await onRequestPost(context(input))

    expect(response.status).toBe(413)
    expect(fetch).not.toHaveBeenCalled()
  })

  test('rejects invalid or mismatched human verification', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({
      action: 'inspect',
      hostname: 'attacker.example',
      success: true
    }))))

    const response = await onRequestPost(context(request('https://example.com')))

    expect(response.status).toBe(403)
  })

  test('fails closed when Turnstile verification errors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Unavailable'))))

    const response = await onRequestPost(context(request('https://example.com')))

    expect(response.status).toBe(503)
  })

  test('blocks private destinations after human verification', async () => {
    const response = await onRequestPost(context(request('http://127.0.0.1')))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Private and reserved addresses can only be inspected with the CLI.'
    })
  })
})
