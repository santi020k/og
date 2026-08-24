import { describe, expect, test, vi } from 'vitest'

import { onRequestPost } from './check.js'

const request = (url: string, headers: HeadersInit = {}): Request => new Request(
  'https://og.santi020k.com/api/check',
  {
    body: JSON.stringify({ url }),
    headers: {
      'cf-connecting-ip': '192.0.2.10',
      'content-type': 'application/json',
      origin: 'https://og.santi020k.com',
      ...Object.fromEntries(new Headers(headers))
    },
    method: 'POST'
  }
)

const context = (input: Request, success = true) => {
  const limit = vi.fn(() => Promise.resolve({ success }))

  return {
    context: {
      env: { CHECKER_RATE_LIMITER: { limit } },
      request: input
    },
    limit
  }
}

describe('hosted checker protections', () => {
  test('rejects cross-site requests before consuming rate-limit capacity', async () => {
    const input = request('https://example.com', { origin: 'https://attacker.example' })
    const { context: pagesContext, limit } = context(input)
    const response = await onRequestPost(pagesContext)

    expect(response.status).toBe(403)
    expect(limit).not.toHaveBeenCalled()
  })

  test('fails closed when the deployment rate limiter is unavailable', async () => {
    const response = await onRequestPost({ env: {}, request: request('https://example.com') })

    expect(response.status).toBe(503)
  })

  test('returns retry guidance when the client exceeds its allowance', async () => {
    const { context: pagesContext, limit } = context(request('https://example.com'), false)
    const response = await onRequestPost(pagesContext)

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('60')
    expect(limit).toHaveBeenCalledWith({ key: '192.0.2.10' })
  })

  test('fails closed when the rate-limit service errors', async () => {
    const response = await onRequestPost({
      env: {
        CHECKER_RATE_LIMITER: {
          limit: () => Promise.reject(new Error('Unavailable'))
        }
      },
      request: request('https://example.com')
    })

    expect(response.status).toBe(503)
  })

  test('blocks private destinations after rate-limit authorization', async () => {
    const { context: pagesContext } = context(request('http://127.0.0.1'))
    const response = await onRequestPost(pagesContext)

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Private and reserved addresses can only be inspected with the CLI.'
    })
  })
})
