import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, test } from 'vitest'

import { type AuditedPage, auditSite } from '../src/audit.js'
import { createRedirectsAuditRule } from '../src/audit-rules.js'
import { defineSite } from '../src/site.js'

const auditedPage = (route: string, redirect?: string): AuditedPage => ({
  alternates: [],
  file: `${route}index.html`,
  indexable: redirect === undefined,
  ...(redirect === undefined ? {} : { redirect }),
  route,
  schemaTypes: []
})

const checkRedirects = (pages: readonly AuditedPage[]) => createRedirectsAuditRule()({
  directory: '/built-site',
  pages,
  siteUrl: new URL('https://example.com/')
})

describe('built-site audit safety', () => {
  test.each([
    ...['/%2e%2e%2f', '/og/%2e%2e%2f%2e%2e%2f'].map(prefix => `${prefix}outside.png`),
    '/og/%invalid.png'
  ])('reports unsafe decoded social image path %s without reading it', async image => {
    const root = await mkdtemp(path.join(tmpdir(), 'santi-og-audit-path-'))
    const directory = path.join(root, 'dist')
    const site = defineSite({ siteUrl: 'https://example.com/' })

    const page = site.page({
      description: 'A page with an invalid local social image.',
      image: { alt: 'Invalid local card', url: `https://example.com${image}` },
      pathname: '/',
      title: 'Unsafe image path'
    })

    await mkdir(directory)

    // Invalid bytes outside dist would make Sharp throw if the audit read the escaped path.
    await writeFile(path.join(root, 'outside.png'), 'must not be read')

    await writeFile(path.join(directory, 'index.html'),
      `<html lang="en"><head>${site.html(page)}</head><body><h1>Example</h1></body></html>`)

    const result = await auditSite({ directory, requireUniqueImages: true, siteUrl: 'https://example.com/' })

    expect(result.passed).toBe(false)

    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'invalid-image-path',
      route: '/',
      severity: 'error'
    }))
  })

  test('detects every route entering a redirect cycle', async () => {
    const result = await checkRedirects([
      auditedPage('/entry/', '/first/'),
      auditedPage('/first/', '/second/'),
      auditedPage('/second/', '/first/')
    ])

    expect(result.map(issue => [issue.route, issue.code, issue.severity])).toEqual([
      ['/entry/', 'redirect-loop', 'error'],
      ['/first/', 'redirect-loop', 'error'],
      ['/second/', 'redirect-loop', 'error']
    ])
  })

  test('resolves relative redirect destinations against the source page', async () => {
    const result = await checkRedirects([
      auditedPage('/first/', '../second/'),
      auditedPage('/second/', '../first/')
    ])

    expect(result.map(issue => issue.code)).toEqual(['redirect-loop', 'redirect-loop'])
  })

  test('accepts redirect chains ending at an HTML page or external URL', async () => {
    expect(await checkRedirects([
      auditedPage('/first/', '/second/'),
      auditedPage('/second/', '/destination/'),
      auditedPage('/destination/'),
      auditedPage('/external/', 'https://other.example/external/')
    ])).toEqual([])
  })

  test('continues to report self loops, missing targets, and invalid URLs', async () => {
    const result = await checkRedirects([
      auditedPage('/self/', '/self/'),
      auditedPage('/missing/', '/absent/'),
      auditedPage('/invalid/', 'http://[')
    ])

    expect(result.map(issue => issue.code)).toEqual([
      'redirect-loop',
      'missing-redirect-target',
      'invalid-redirect-url'
    ])
  })
})
