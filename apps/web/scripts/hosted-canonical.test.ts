import type { AuditedPage } from '@santi020k/og/audit'
import { describe, expect, test } from 'vitest'
import { hostedCanonicalRule } from './hosted-canonical.mjs'

const page = (canonical: string, indexable = true): AuditedPage => ({
  alternates: [], canonical, file: '/dist/docs/index.html', indexable,
  route: '/docs/', schemaTypes: []
})
const run = (input: AuditedPage) => hostedCanonicalRule({
  directory: '/dist', page: input, siteUrl: new URL('https://og.santi020k.com')
})

describe('Cloudflare directory canonicals', () => {
  test('rejects a canonical that redirects to the slash route', async () => {
    expect(await run(page('https://og.santi020k.com/docs'))).toEqual([
      expect.objectContaining({ code: 'hosted-canonical-mismatch', severity: 'error', route: '/docs/' })
    ])
  })
  test('accepts the deployed directory URL', async () => {
    expect(await run(page('https://og.santi020k.com/docs/'))).toEqual([])
  })
  test('leaves non-indexable routes to their robots policy', async () => {
    expect(await run(page('https://og.santi020k.com/docs', false))).toEqual([])
  })
})
