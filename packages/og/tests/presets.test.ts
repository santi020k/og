import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'

import { collectAstroContentCards, readAstroContent } from '../src/astro.js'
import { collectContentCards, readContent } from '../src/content.js'
import { generate } from '../src/generate.js'
import {
  createPresetRenderer,
  definePresetConfig,
  type PresetCardData
} from '../src/presets.js'
import { wrapMeasuredText } from '../src/typography.js'

const directories: string[] = []

const createRoot = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'santi-og-preset-'))

  directories.push(directory)

  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, {
    force: true,
    recursive: true
  })))
})

describe('preset renderer', () => {
  it('renders neutral layouts in every supported raster workflow', async () => {
    const renderer = createPresetRenderer({
      brand: { domain: 'example.com', name: 'Example' },
      theme: { accent: '#ff3366' },
      variant: 'docs'
    })

    const data: PresetCardData = {
      description: 'Reusable social cards without a project-specific template.',
      title: 'A useful default Open Graph image'
    }

    const output = await renderer(data, {
      format: 'png',
      height: 630,
      outputPath: '/tmp/preset.png',
      root: '/tmp',
      width: 1200
    })

    expect(Buffer.isBuffer(output)).toBe(true)

    await expect(sharp(output as Buffer).metadata()).resolves.toMatchObject({
      format: 'png',
      height: 630,
      width: 1200
    })
  })

  it('defines a complete config without a consumer-owned renderer', async () => {
    const root = await createRoot()

    const config = definePresetConfig({
      cards: [{ data: { title: 'Hello' }, output: 'index.svg' }],
      preset: { brand: { name: 'Example' } },
      root
    })

    await generate(config)

    await expect(readFile(path.join(root, 'public/og/index.svg'), 'utf8'))
      .resolves.toContain('Hello')
  })

  it('embeds deterministic typography and safely wraps long unbroken titles', async () => {
    const renderer = createPresetRenderer({ variant: 'product' })

    const output = await renderer({
      title: 'InternationalizationSupercalifragilisticEmojiFamily👨‍👩‍👧‍👦WithoutWhitespace'
    }, {
      format: 'svg',
      height: 630,
      outputPath: '/tmp/card.svg',
      root: '/tmp',
      width: 1200
    })

    expect(output).toEqual(expect.any(String))

    expect(output).toContain('@font-face')

    expect(output).toContain('Inter Variable')

    expect(output).not.toContain('rgba(')
  })

  it('keeps joined emoji graphemes intact while splitting long tokens', () => {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    const family = '👨‍👩‍👧‍👦'

    const lines = wrapMeasuredText({
      font: {
        css: '',
        family: 'Test',
        measure: value => [...segmenter.segment(value)].length
      },
      fontSize: 1,
      maximumLines: 10,
      maximumWidth: 2,
      value: `ab${family}cd`
    })

    expect(lines.some(line => line.includes(family))).toBe(true)

    expect(lines.join('')).toBe(`ab${family}cd`)
  })
})

describe('framework-neutral content helpers', () => {
  it('preserves the Astro entry point as compatibility aliases', () => {
    expect(collectAstroContentCards).toBe(collectContentCards)

    expect(readAstroContent).toBe(readContent)
  })

  it('reads nested Markdown and maps frontmatter to preset cards', async () => {
    const root = await createRoot()
    const content = path.join(root, 'src/content/blog')

    await mkdir(path.join(content, 'hello'), { recursive: true })

    await writeFile(path.join(content, 'hello/index.md'), `---
title: Hello world
description: A nested article.
type: Guide
---
Body
`)

    await writeFile(path.join(content, 'draft.md'), `---
title: Hidden
draft: true
---
`)

    const entries = await readAstroContent({ directory: 'src/content/blog', root })

    expect(entries.map(entry => entry.slug)).toEqual(['draft', 'hello'])

    const cards = await collectAstroContentCards({
      basePath: 'blog',
      directory: 'src/content/blog',
      root
    })

    expect(cards).toHaveLength(1)

    expect(cards[0]).toMatchObject({
      data: {
        badge: 'Guide',
        description: 'A nested article.',
        title: 'Hello world',
        variant: 'article'
      },
      output: 'blog--hello.webp'
    })
  })

  it('supports custom data, output, and source mapping', async () => {
    const root = await createRoot()
    const content = path.join(root, 'content')

    await mkdir(content)

    await writeFile(path.join(content, 'page.mdx'), `---
title: Custom
cover: public/cover.png
---
`)

    const cards = await collectAstroContentCards({
      directory: 'content',
      map: entry => ({ title: String(entry.frontmatter.title), variant: 'product' }),
      output: entry => `custom/${entry.slug}.png`,
      root,
      sources: entry => [entry.filePath, String(entry.frontmatter.cover)]
    })

    expect(cards[0]).toMatchObject({
      data: { title: 'Custom', variant: 'product' },
      output: 'custom/page.png'
    })

    expect(typeof cards[0]?.sources).not.toBe('function')

    expect(cards[0]?.sources).toHaveLength(2)
  })

  it('filters before parsing, applies draft and cover fallbacks, and aggregates derived cards', async () => {
    const root = await createRoot()
    const content = path.join(root, 'content')

    await mkdir(path.join(content, 'en'), { recursive: true })

    await mkdir(path.join(content, 'private'), { recursive: true })

    await writeFile(path.join(content, 'en/guide.md'), `---
title: Included
hero: public/guide.png
status: hidden
---
`)

    await writeFile(path.join(content, 'private/secret.md'), `---
title: Secret
---
`)

    const cards = await collectAstroContentCards({
      aggregate: (entries, mapped) => [{
        data: { title: `${mapped.length} of ${entries.length} entries`, variant: 'simple' },
        output: 'summary.webp'
      }],
      coverFields: ['hero'],
      directory: 'content',
      draft: entry => entry.frontmatter.status === 'draft',
      exclude: ['private/**'],
      filter: entry => entry.frontmatter.status !== 'hidden',
      include: ['en/**'],
      root
    })

    expect(cards).toEqual([{
      data: { title: '0 of 1 entries', variant: 'simple' },
      output: 'summary.webp'
    }])

    const included = await collectAstroContentCards({
      coverFields: ['hero'],
      directory: 'content',
      exclude: ['private/**'],
      include: ['en/**'],
      root
    })

    expect(included[0]?.data).toMatchObject({ image: 'public/guide.png', title: 'Included' })
  })
})
