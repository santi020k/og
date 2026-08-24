import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { type AuditedPage, summarizeAuditIssues } from '../src/audit.js'
import { createLlmsAuditRule } from '../src/audit-rules.js'
import { createLocaleAlternates, createLocaleAuditHrefs } from '../src/locales.js'
import { createMetaTags, definePageMetadata } from '../src/metadata.js'
import { renderMetaTags } from '../src/metadata-html.js'
import { toNextMetadata } from '../src/metadata-next.js'
import { createImageResponse } from '../src/runtime.js'
import {
  eventSchema,
  faqSchema,
  imageObjectSchema,
  offerSchema,
  webPageSchema
} from '../src/schema.js'

const localeOptions = {
  defaultLanguage: 'es',
  locales: [
    { language: 'es', prefix: '' },
    { language: 'en', prefix: 'en' }
  ],
  siteUrl: 'https://example.com'
} as const

describe('locale-aware metadata', () => {
  it('creates a stable matrix from neutral and localized routes', () => {
    const expected = [
      { href: 'https://example.com/docs/', language: 'es' },
      { href: 'https://example.com/en/docs/', language: 'en' },
      { href: 'https://example.com/docs/', language: 'x-default' }
    ]

    expect(createLocaleAlternates('/docs/', localeOptions)).toEqual(expected)

    expect(createLocaleAlternates('/en/docs/', localeOptions)).toEqual(expected)

    expect(createLocaleAuditHrefs(localeOptions)({
      alternates: [],
      file: 'en/docs/index.html',
      indexable: true,
      route: '/en/docs/',
      schemaTypes: []
    })).toEqual(
      expected.map(alternate => alternate.href)
    )
  })

  it('emits hreflang HTML and Next.js language alternates from one page', () => {
    const page = definePageMetadata({
      alternates: createLocaleAlternates('/en/docs/', localeOptions),
      description: 'Localized documentation.',
      pathname: '/en/docs/',
      title: 'Documentation'
    })

    const options = { siteUrl: 'https://example.com' }
    const tags = createMetaTags(page, options)

    expect(renderMetaTags(tags)).toContain(
      '<link rel="alternate" hreflang="en" href="https://example.com/en/docs/">'
    )

    expect(toNextMetadata(page, options).alternates.languages).toEqual({
      en: 'https://example.com/en/docs/',
      es: 'https://example.com/docs/',
      'x-default': 'https://example.com/docs/'
    })
  })

  it('rejects ambiguous locale matrices and duplicate page languages', () => {
    expect(() => createLocaleAlternates('/', {
      locales: [
        { language: 'en', prefix: '' },
        { language: 'EN', prefix: 'english' }
      ]
    })).toThrow('Duplicate locale language')

    expect(() => createMetaTags({
      alternates: [
        { href: '/en', language: 'en' },
        { href: '/english', language: 'EN' }
      ],
      description: 'Description',
      pathname: '/',
      title: 'Title'
    }, { siteUrl: 'https://example.com' })).toThrow('Duplicate alternate language')
  })
})

describe('runtime image responses', () => {
  it('turns renderer output into a cacheable Fetch response', async () => {
    const response = await createImageResponse(
      (data: Readonly<{ title: string }>, context) => (
        `<svg width="${context.width}" height="${context.height}">${data.title}</svg>`
      ),
      { title: 'Runtime' },
      { format: 'svg', height: 315, headers: { 'x-og-source': 'test' }, width: 600 }
    )

    expect(response.status).toBe(200)

    expect(response.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')

    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')

    expect(response.headers.get('x-og-source')).toBe('test')

    expect(await response.text()).toBe('<svg width="600" height="315">Runtime</svg>')
  })

  it('validates dimensions before invoking a renderer', async () => {
    await expect(createImageResponse(() => 'unused', null, { width: 0 })).rejects.toThrow(
      'width must be a positive integer'
    )
  })
})

describe('common Schema.org recipes', () => {
  it('builds event, FAQ, web page, offer, and image nodes', () => {
    const offer = offerSchema({ currency: 'USD', price: 0, url: 'https://example.com' })
    const image = imageObjectSchema({ height: 630, url: 'https://example.com/og.png', width: 1200 })

    expect(webPageSchema({ image, name: 'Guide', url: 'https://example.com/guide' })).toMatchObject({
      '@type': 'WebPage',
      image,
      name: 'Guide'
    })

    expect(eventSchema({
      name: 'Launch',
      organizer: offer,
      startDate: '2026-10-19'
    })).toMatchObject({
      '@type': 'Event',
      name: 'Launch',
      startDate: '2026-10-19T00:00:00.000Z'
    })

    expect(faqSchema([{ answer: 'Deterministically.', question: 'How?' }])).toMatchObject({
      '@type': 'FAQPage',
      mainEntity: [{ '@type': 'Question', name: 'How?' }]
    })
  })
})

describe('AI-readable site auditing', () => {
  it('verifies compatibility copies, route Markdown, index links, and full headings', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'santi-og-llms-'))
    const pageFile = path.join(directory, 'guide', 'index.html')

    await mkdir(path.dirname(pageFile), { recursive: true })

    await writeFile(pageFile, '<h1>Guide</h1>')

    await writeFile(path.join(directory, 'guide.md'), '# Guide\n\nUseful documentation.\n')

    await writeFile(path.join(directory, 'llms.txt'), '- [Guide](/guide.md)\n')

    await writeFile(path.join(directory, 'llm.txt'), '- [Guide](/guide.md)\n')

    await writeFile(path.join(directory, 'llms-full.txt'), '# Guide\n\nUseful documentation.\n')

    const page: AuditedPage = {
      alternates: [],
      file: pageFile,
      indexable: true,
      route: '/guide/',
      schemaTypes: [],
      title: 'Guide'
    }

    const rule = createLlmsAuditRule({ compatibilityFiles: ['llm.txt'] })

    expect(await rule({ directory, pages: [page] })).toEqual([])
  })

  it('summarizes repeated findings by root cause', () => {
    expect(summarizeAuditIssues([
      { code: 'missing-title', file: 'a', message: 'Missing', route: '/a/', severity: 'error' },
      { code: 'missing-title', file: 'b', message: 'Missing', route: '/b/', severity: 'error' },
      { code: 'missing-json-ld', file: 'a', message: 'Missing', route: '/a/', severity: 'warning' }
    ])).toEqual([
      { code: 'missing-title', count: 2, routes: ['/a/', '/b/'], severity: 'error' },
      { code: 'missing-json-ld', count: 1, routes: ['/a/'], severity: 'warning' }
    ])
  })
})
