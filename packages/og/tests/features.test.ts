import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { describe, expect, test } from 'vitest'

import { auditSite, auditToSarif } from '../src/audit.js'
import {
  collectContentCards,
  getFrontmatterValue,
  groupArchive,
  paginateArchive } from '../src/content.js'
import type { PresetCardData } from '../src/presets.js'
import { createRouteManifest } from '../src/route-manifest.js'
import {
  articleSchema,
  composeJsonLd,
  defineSchema,
  defineSchemaRecipe,
  extendSchema,
  personSchema,
  serializeJsonLd } from '../src/schema.js'
import { defineSite } from '../src/site.js'

describe('defineSite', () => {
  test('binds defaults across pages, metadata, HTML, Next.js, and cards', () => {
    const site = defineSite({
      defaults: {
        authors: ['Santiago Molina'],
        image: { alt: 'Default social card', output: 'default.webp' },
        twitter: { site: '@santi020k' }
      },
      locale: 'en_US',
      siteName: 'Example',
      siteUrl: 'https://example.com/'
    })

    const page = site.page({
      description: 'Portable page metadata.',
      image: { alt: 'Page social card', output: 'page.webp' },
      pathname: '/docs/',
      title: 'Docs'
    })

    expect(site.resolve(page).image?.url).toBe('https://example.com/og/page.webp')

    expect(site.tags(page)).toContainEqual({ content: '@santi020k', name: 'twitter:site', tag: 'meta' })

    expect(site.html(page)).toContain('<link rel="canonical" href="https://example.com/docs/">')

    expect(site.next(page).openGraph.siteName).toBe('Example')

    expect(site.card(page).route?.pathname).toBe('/docs/')
  })
})

describe('JSON-LD recipes', () => {
  test('compose known recipes and arbitrary custom schemas in one graph', () => {
    const author = personSchema({ id: 'https://example.com/#author', name: 'Ada' })

    const article = articleSchema({
      author,
      datePublished: '2026-08-24',
      name: 'Composable schema',
      url: 'https://example.com/article/'
    })

    const faqRecipe = defineSchemaRecipe((questions: readonly { answer: string, question: string }[]) => (
      defineSchema({
        '@type': 'FAQPage',
        mainEntity: questions.map(item => defineSchema({
          '@type': 'Question',
          acceptedAnswer: defineSchema({ '@type': 'Answer', text: item.answer }),
          name: item.question
        }))
      })
    ))

    const extended = extendSchema(article, {
      accessibilityFeature: ['alternativeText', 'readingOrder']
    })

    const graph = composeJsonLd(
      author,
      extended,
      faqRecipe([{ answer: '</script><p>Safe</p>', question: 'Can recipes be extended?' }])
    )

    const serialized = serializeJsonLd(graph)

    expect(graph['@graph']).toHaveLength(3)

    expect(extended.accessibilityFeature).toEqual(['alternativeText', 'readingOrder'])

    expect(serialized).not.toContain('</script>')

    expect(serialized).toContain('\\u003c/script\\u003e')
  })
})

describe('content archive recipes', () => {
  test('resolve nested covers and create pagination and grouped archives', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'santi-og-content-'))
    const directory = path.join(root, 'content')
    const post = path.join(directory, 'post.md')
    const cover = path.join(directory, 'cover.png')

    await mkdir(directory, { recursive: true })

    await writeFile(cover, 'cover')

    await writeFile(post, `---
title: One post
description: Useful content
tags: [TypeScript, Testing]
coverImage:
  src: ./cover.png
---
Body
`)

    const cards = await collectContentCards({
      archives: [
        paginateArchive<PresetCardData>({
          basePath: '/blog/',
          data: context => ({ badge: 'Blog', title: `Page ${context.pageNumber}` }),
          pageSize: 1
        }),
        groupArchive<PresetCardData>({
          basePath: '/blog/tags/',
          data: context => ({ badge: 'Topic', title: `${context.group} posts` }),
          field: 'tags'
        })
      ],
      coverFields: ['coverImage.src'],
      directory: 'content',
      resolveCover: true,
      route: entry => `/articles/${entry.slug}/`,
      root
    })

    expect(cards[0]?.data.image).toBe(cover)

    expect(cards[0]?.route?.pathname).toBe('/articles/post/')

    expect(cards.map(card => card.output)).toEqual([
      'post.webp',
      'blog.webp',
      'blog--tags--typescript.webp',
      'blog--tags--testing.webp'
    ])

    const entry = { body: '', filePath: post, frontmatter: { nested: { value: 42 } }, id: '', slug: '' }

    expect(getFrontmatterValue(entry, 'nested.value')).toBe(42)
  })
})

describe('route manifests and built-site audits', () => {
  test('map every format and validate built metadata and image files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'santi-og-audit-'))
    const dist = path.join(root, 'dist')
    const imageDirectory = path.join(dist, 'og')
    const site = defineSite({ siteName: 'Example', siteUrl: 'https://example.com/' })

    const page = site.page({
      canonical: 'https://publisher.example/a-complete-audited-page/',
      description: 'A complete audited page.',
      image: { alt: 'Example card', type: 'image/png', url: 'https://example.com/og/index.png' },
      pathname: '/',
      schemaTypes: ['WebSite'],
      title: 'Example'
    })

    const card = site.card(page)
    const cardWithFormats = { ...card, formats: ['svg'] as const, output: 'index.png' }

    const manifest = createRouteManifest([cardWithFormats], {
      outputDirectory: 'public/og',
      routeManifest: true
    })

    await mkdir(imageDirectory, { recursive: true })

    await mkdir(path.join(dist, 'old'), { recursive: true })

    await writeFile(path.join(dist, 'index.html'), `<!doctype html><html lang="en"><head>${site.html(page)}<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script></head><body><h1>Example</h1></body></html>`)

    await writeFile(path.join(dist, 'old', 'index.html'), '<!doctype html><title>Redirecting</title><meta http-equiv="refresh" content="0;url=/"><meta name="robots" content="noindex"><link rel="canonical" href="https://example.com/">')

    await sharp({
      create: { background: '#000000', channels: 3, height: 630, width: 1200 }
    }).png().toFile(path.join(imageDirectory, 'index.png'))

    expect(manifest.routes['/']?.images.map(image => image.url)).toEqual([
      '/og/index.png',
      '/og/index.svg'
    ])

    const result = await auditSite({
      directory: 'dist',
      manifest,
      root,
      siteUrl: 'https://example.com/'
    })

    expect(result.passed).toBe(true)

    expect(result.issues).toEqual([])

    expect(result.pages[0]?.schemaTypes).toContain('WebSite')

    expect(auditToSarif(result).version).toBe('2.1.0')
  })

  test('report incomplete indexable metadata', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'santi-og-audit-invalid-'))
    const dist = path.join(root, 'dist')

    await mkdir(dist)

    await writeFile(path.join(dist, 'index.html'), '<title>Incomplete</title>')

    const result = await auditSite({ directory: 'dist', root })

    expect(result.passed).toBe(false)

    expect(result.issues.map(item => item.code)).toContain('missing-description')

    expect(result.issues.map(item => item.code)).toContain('missing-og-image')
  })
})
