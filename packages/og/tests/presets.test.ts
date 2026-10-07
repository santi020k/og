import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'

import { collectAstroContentCards, readAstroContent } from '../src/astro.js'
import { defineConfig } from '../src/config.js'
import { collectContentCards, readContent } from '../src/content.js'
import { generate } from '../src/generate.js'
import {
  createPresetRenderer,
  definePresetConfig,
  type PresetCardData
} from '../src/presets.js'
import { createMigrationReport } from '../src/report.js'
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

  it.each(['simple', 'article', 'docs', 'product'] as const)(
    'scales the complete %s layout to smaller output dimensions deterministically',
    async variant => {
      const renderer = createPresetRenderer({ brand: { domain: 'example.com', name: 'Example' } })

      const context = {
        format: 'png' as const,
        height: 315,
        outputPath: '/tmp/compact-preset.png',
        root: '/tmp',
        width: 600
      }

      const data = { description: 'A complete card in a smaller canvas.', title: 'Thoughtful defaults', variant }
      const first = await renderer(data, context)
      const second = await renderer(data, context)

      expect(first).toEqual(second)

      await expect(sharp(first as Buffer).metadata()).resolves.toMatchObject({
        height: 315,
        width: 600
      })

      const footer = await sharp(first as Buffer)
        .extract({ height: 2, left: 40, top: 289, width: 1 })
        .removeAlpha()
        .raw()
        .toBuffer()

      // The accent footer survives at half size rather than falling below the canvas.
      expect(footer[0]).toBeGreaterThan(100)
    }
  )

  it('keeps three title lines and two description lines above the footer', async () => {
    const renderer = createPresetRenderer()

    const output = await renderer({
      description: 'Thoughtful previews deserve enough space for the full story, with readable copy and a comfortable rhythm even when the title takes three lines.',
      title: 'Thoughtful design makes room for people, their ideas, and the stories they want to share with the world.'
    }, {
      format: 'svg',
      height: 630,
      outputPath: '/tmp/long-copy.svg',
      root: '/tmp',
      width: 1200
    })

    if (typeof output !== 'string') throw new Error('Expected SVG output.')

    const copy = [...output.matchAll(/<text ([^>]+)>[^<]*<\/text>/gu)]
      .map(match => ({
        size: Number(/font-size="([\d.]+)"/u.exec(match[1] ?? '')?.[1]),
        x: Number(/x="([\d.]+)"/u.exec(match[1] ?? '')?.[1]),
        y: Number(/y="([\d.]+)"/u.exec(match[1] ?? '')?.[1])
      }))
      .filter(text => text.x === 72 || text.x === 74)

    expect(copy).toHaveLength(5)

    for (const line of copy) expect(line.y + line.size * 0.25).toBeLessThan(550)

    const lastTitle = copy[2]
    const description = copy[3]

    if (!lastTitle || !description) throw new Error('Expected both title and description.')

    expect(description.y - description.size).toBeGreaterThan(lastTitle.y + lastTitle.size * 0.2)
  })

  it('bounds long header and badge copy instead of overflowing its allocated space', async () => {
    const renderer = createPresetRenderer({
      brand: {
        domain: 'a-very-long-domain-name-for-an-example-organization.example.com',
        name: 'An exceptionally long organization name that needs to stay clear of the domain label'
      },
      variant: 'docs'
    })

    const output = await renderer({
      badge: 'An exceptionally long category label that should stay within the content column',
      title: 'Readable at every length'
    }, {
      format: 'svg',
      height: 630,
      outputPath: '/tmp/long-header.svg',
      root: '/tmp',
      width: 1200
    })

    if (typeof output !== 'string') throw new Error('Expected SVG output.')

    const text = [...output.matchAll(/<text [^>]+>([^<]*)<\/text>/gu)]
      .map(match => match[1] ?? '')

    expect(text.filter(value => value.endsWith('…'))).toHaveLength(3)

    expect(text).not.toContain('An exceptionally long category label that should stay within the content column'.toUpperCase())
  })

  it('uses the configured foreground and panel in light-theme decorations', async () => {
    const renderer = createPresetRenderer({
      theme: {
        accent: '#6d28d9',
        background: '#faf9f6',
        foreground: '#18181b',
        muted: '#52525b',
        panel: '#eceae5'
      }
    })

    for (const variant of ['article', 'docs', 'product'] as const) {
      const output = await renderer({ title: 'A lighter point of view', variant }, {
        format: 'svg',
        height: 630,
        outputPath: '/tmp/light-preset.svg',
        root: '/tmp',
        width: 1200
      })

      expect(output).toContain('fill="#eceae5"')

      expect(output).toContain('stroke="#18181b"')

      expect(output).not.toContain('stroke="white"')
    }
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

  it('supports a typed trusted decoration slot without replacing the preset renderer', async () => {
    interface DecoratedCard extends PresetCardData {
      metric: number
    }

    const renderer = createPresetRenderer<DecoratedCard>({
      decoration: (data, _context, decoration) => (
        `<g data-accent="${decoration.accent}"><text>${data.metric}</text></g>`
      ),
      theme: { accent: '#ff3366' }
    })

    const output = await renderer({ metric: 42, title: 'Typed decoration' }, {
      format: 'svg',
      height: 630,
      outputPath: '/tmp/decorated.svg',
      root: '/tmp',
      width: 1200
    })

    expect(output).toContain('<g data-accent="#ff3366"><text>42</text></g>')
  })

  it('keeps custom decoration coordinates in the requested output dimensions', async () => {
    const renderer = createPresetRenderer({
      decoration: (_data, context) => (
        `<rect x="${context.width - 50}" y="${context.height - 50}" width="20" height="20" fill="#ef4444"/>`
      )
    })

    const output = await renderer({ title: 'Custom visual coordinates' }, {
      format: 'png',
      height: 315,
      outputPath: '/tmp/custom-size.png',
      root: '/tmp',
      width: 600
    })

    const pixel = await sharp(output as Buffer)
      .extract({ height: 1, left: 560, top: 275, width: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()

    expect([...pixel]).toEqual([239, 68, 68])
  })

  it('presents logos without requiring consumer-side raster preprocessing', async () => {
    const renderer = createPresetRenderer({
      imagePresentation: { background: '#111827', fit: 'contain', padding: 48 }
    })

    const output = await renderer({
      image: 'data:image/svg+xml;base64,PHN2Zy8+',
      imagePresentation: { background: '#f8fafc', padding: 64 },
      title: 'Logo card',
      variant: 'product'
    }, {
      format: 'svg',
      height: 630,
      outputPath: '/tmp/logo-card.svg',
      root: '/tmp',
      width: 1200
    })

    expect(output).toContain('<rect x="778" y="156" width="350" height="352" rx="40" fill="#f8fafc"/>')

    expect(output).toContain('x="842" y="220" width="222" height="224" preserveAspectRatio="xMidYMid meet"')
  })

  it('normalizes WebP logos so the raster renderer preserves visible pixels', async () => {
    const root = await createRoot()
    const logoPath = path.join(root, 'wide-logo.webp')

    await sharp({
      create: { background: '#ef4444', channels: 4, height: 40, width: 120 }
    }).webp({ lossless: true }).toFile(logoPath)

    const renderer = createPresetRenderer()

    const output = await renderer({
      image: logoPath,
      imagePresentation: { background: '#f8fafc', fit: 'contain', padding: 50 },
      title: 'WebP logo'
    }, {
      format: 'png',
      height: 630,
      outputPath: path.join(root, 'logo-card.png'),
      root,
      width: 1200
    })

    const pixel = await sharp(output as Buffer)
      .extract({ height: 1, left: 952, top: 331, width: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()

    expect([...pixel]).toEqual([239, 68, 68])
  })

  it('normalizes WebP brand marks before embedding them in the header', async () => {
    const root = await createRoot()
    const logoPath = path.join(root, 'brand.webp')

    await sharp({
      create: { background: '#ef4444', channels: 4, height: 32, width: 32 }
    }).webp({ lossless: true }).toFile(logoPath)

    const renderer = createPresetRenderer({ brand: { logo: logoPath, name: 'Example' } })

    const output = await renderer({ title: 'Visible brand mark' }, {
      format: 'png',
      height: 630,
      outputPath: path.join(root, 'brand.png'),
      root,
      width: 1200
    })

    const pixel = await sharp(output as Buffer)
      .extract({ height: 1, left: 88, top: 86, width: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()

    expect([...pixel]).toEqual([239, 68, 68])
  })

  it('keeps cover cropping as the default and rejects invalid image padding', async () => {
    const context = {
      format: 'svg' as const,
      height: 630,
      outputPath: '/tmp/cover-card.svg',
      root: '/tmp',
      width: 1200
    }

    const renderer = createPresetRenderer()

    const output = await renderer({
      image: 'data:image/png;base64,Y292ZXI=',
      title: 'Cover card'
    }, context)

    expect(output).toContain('x="778" y="156" width="350" height="352" preserveAspectRatio="xMidYMid slice"')

    await expect(renderer({
      image: 'data:image/png;base64,Y292ZXI=',
      imagePresentation: { padding: 175 },
      title: 'Invalid padding'
    }, context)).rejects.toThrow('padding must be between 0 and 174 pixels')
  })

  it('downloads pinned remote images once into a verified content-addressed cache', async () => {
    const root = await createRoot()

    const image = await sharp({
      create: { background: '#ff3366', channels: 3, height: 32, width: 32 }
    }).png().toBuffer()

    const wrongType = Buffer.from('not an image')
    const sha256 = createHash('sha256').update(image).digest('hex')
    let requests = 0

    const server = createServer((request, response) => {
      requests += 1

      if (request.url === '/wrong') {
        response.writeHead(200, { 'content-type': 'text/plain' })

        response.end(wrongType)

        return
      }

      response.writeHead(200, { 'content-length': image.byteLength, 'content-type': 'image/png' })

      response.end(image)
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)

      server.listen(0, '127.0.0.1', resolve)
    })

    try {
      const address = server.address()

      if (!address || typeof address === 'string') throw new Error('Expected a TCP test server address.')

      const url = `http://127.0.0.1:${address.port}/cover.png`
      const renderer = createPresetRenderer({ remoteImages: { cacheDirectory: '.cache/remote' } })

      const context = {
        format: 'svg' as const,
        height: 630,
        outputPath: path.join(root, 'card.svg'),
        root,
        width: 1200
      }

      const data = { image: { sha256, type: 'image/png' as const, url }, title: 'Pinned image' }
      const first = await renderer(data, context)
      const second = await renderer(data, context)

      expect(first).toContain('data:image/png;base64,')

      expect(second).toBe(first)

      expect(requests).toBe(1)

      await expect(readFile(path.join(root, '.cache/remote', `${sha256}.png`))).resolves.toEqual(image)

      await expect(renderer({ image: url, title: 'Unpinned image' }, context))
        .rejects.toThrow('must use a pinned')

      await expect(renderer({
        image: {
          sha256: createHash('sha256').update(wrongType).digest('hex'),
          type: 'image/png',
          url: `http://127.0.0.1:${address.port}/wrong`
        },
        title: 'Wrong type'
      }, context)).rejects.toThrow('type mismatch')
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
  })

  it('reports preset usage independently from public cache keys', async () => {
    const root = await createRoot()
    const cards = [{ data: { title: 'Hello' }, output: 'index.svg' }] as const
    const preset = definePresetConfig({ cache: false, cards, root })

    const custom = defineConfig({
      cache: { key: 'preset-v1' },
      cards,
      renderer: (data: PresetCardData) => `<svg>${data.title}</svg>`,
      root
    })

    const parameters = {
      configContents: 'export default {}',
      configPath: path.join(root, 'og.config.mjs')
    }

    await expect(createMigrationReport({ ...parameters, config: preset }))
      .resolves.toMatchObject({ customRenderer: false })

    await expect(createMigrationReport({ ...parameters, config: custom }))
      .resolves.toMatchObject({ customRenderer: true })
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

  it('keeps long titles out of the visual column', async () => {
    const renderer = createPresetRenderer({ variant: 'docs' })

    const output = await renderer({
      title: 'Write it once. Ship it in any framework.'
    }, {
      format: 'svg',
      height: 630,
      outputPath: '/tmp/long-title.svg',
      root: '/tmp',
      width: 1200
    })

    expect(output).toContain('>Write it once. Ship it</text>')

    expect(output).toContain('>in any framework.</text>')

    expect(output).not.toContain('>Write it once. Ship it in</text>')
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

  it('preserves pinned remote cover descriptors from frontmatter', async () => {
    const root = await createRoot()
    const content = path.join(root, 'content')
    const sha256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

    await mkdir(content)

    await writeFile(path.join(content, 'remote.md'), `---
title: Remote cover
cover:
  url: https://cdn.example.com/cover.png
  type: image/png
  sha256: ${sha256}
---
`)

    const cards = await collectContentCards({
      coverFields: ['cover'],
      directory: 'content',
      resolveCover: true,
      root
    })

    expect(cards[0]?.data.image).toEqual({
      sha256,
      type: 'image/png',
      url: 'https://cdn.example.com/cover.png'
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
