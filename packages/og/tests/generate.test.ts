import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { compare } from '../src/compare.js'
import {
  createCards,
  createEncodedRenderer,
  createPathCards,
  fromLegacyCards,
  pathnameOutput,
  relativeOutput
} from '../src/composition.js'
import { generate } from '../src/generate.js'
import type { OgCard, OgConfig, OgRenderer } from '../src/types.js'

interface CardData {
  title: string
}

const directories: string[] = []

const createRoot = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'santi-og-'))

  directories.push(directory)

  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })))
})

describe('generate', () => {
  it('adapts legacy specs, encoded renderers, and absolute outputs', async () => {
    const outputDirectory = '/project/public/og'
    const cards = fromLegacyCards([{ outFile: 'index.svg', props: { title: 'Legacy' } }])
    const renderer = createEncodedRenderer<CardData>(data => `<svg>${data.title}</svg>`)

    expect(cards).toEqual([{ data: { title: 'Legacy' }, output: 'index.svg' }])

    expect(relativeOutput(outputDirectory, '/project/public/og/pages/index.svg'))
      .toBe('pages/index.svg')

    expect(await renderer(cards[0]?.data ?? { title: '' }, {
      format: 'svg',
      height: 630,
      outputPath: '/tmp/index.svg',
      root: '/tmp',
      width: 1200
    })).toBe('<svg>Legacy</svg>')
  })

  it('maps URL pathnames to portable card outputs', () => {
    expect(pathnameOutput('/docs/getting started/', { extension: '.png' }))
      .toBe('docs--getting~20started.png')

    expect(createPathCards([
      { data: { title: 'Home' }, pathname: '/' },
      { data: { title: 'API' }, pathname: '/docs/api' }
    ], { directory: 'pages' })).toEqual([
      { data: { title: 'Home' }, output: 'pages/index.webp', route: { pathname: '/' } },
      { data: { title: 'API' }, output: 'pages/docs--api.webp', route: { pathname: '/docs/api' } }
    ])
  })

  it('writes and checks a deterministic route manifest', async () => {
    const root = await createRoot()

    const config: OgConfig<CardData> = {
      cards: createPathCards([
        { data: { title: 'Home' }, pathname: '/' },
        { data: { title: 'Docs' }, pathname: '/docs' }
      ]),
      renderer: data => `<svg>${data.title}</svg>`,
      root,
      routeManifest: true
    }

    await generate(config)

    const manifestPath = path.join(root, 'public/og/manifest.json')

    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      routes: Record<string, { images: { url?: string }[] }>
    }

    expect(Object.keys(manifest.routes)).toEqual(['/', '/docs'])

    expect(manifest.routes['/']?.images[0]?.url).toBe('/og/index.webp')

    expect((await generate(config, { check: true })).stale).toEqual([])

    await writeFile(manifestPath, '{}\n')

    expect((await generate(config, { check: true })).stale).toContain('public/og/manifest.json')
  })

  it('maps typed catalogs and renders multiple formats with format-aware aliases', async () => {
    const root = await createRoot()

    const cards = createCards(
      [{ slug: 'hello', title: 'Hello' }],
      item => ({ title: item.title }),
      {
        formatAliases: () => ({ png: ['social/hello.png'] }),
        formats: ['png', 'svg'],
        output: item => `${item.slug}.webp`,
        sources: item => [`content/${item.slug}.md`]
      }
    )

    await mkdir(path.join(root, 'content'))

    await writeFile(path.join(root, 'content/hello.md'), 'Hello')

    const renderer = vi.fn<OgRenderer<CardData>>((data, context) => (
      context.format === 'svg' ? `<svg>${data.title}</svg>` : Buffer.from(`${context.format}:${data.title}`)
    ))

    const result = await generate({ cards, renderer, root })

    expect(result.generated).toEqual([
      'hello.webp',
      'hello.png',
      'social/hello.png',
      'hello.svg'
    ])

    expect(renderer).toHaveBeenCalledTimes(3)

    await expect(readFile(path.join(root, 'public/og/social/hello.png'), 'utf8'))
      .resolves.toBe('png:Hello')

    await expect(readFile(path.join(root, '.og-cache.json'), 'utf8'))
      .resolves.toContain('"generatorVersion": "0.8.0"')
  })

  it('writes cards and skips unchanged outputs using content fingerprints', async () => {
    const root = await createRoot()
    const renderer = vi.fn<OgRenderer<CardData>>(data => `<svg>${data.title}</svg>`)

    const config: OgConfig<CardData> = {
      cards: [{ data: { title: 'Hello' }, output: 'pages/index.svg' }],
      renderer,
      root
    }

    const first = await generate(config)
    const second = await generate(config)

    expect(first.generated).toEqual(['pages/index.svg'])

    expect(second.skipped).toEqual(['pages/index.svg'])

    expect(renderer).toHaveBeenCalledTimes(1)

    await expect(readFile(path.join(root, 'public/og/pages/index.svg'), 'utf8'))
      .resolves.toBe('<svg>Hello</svg>')
  })

  it('invalidates a card when its data or declared source changes', async () => {
    const root = await createRoot()
    const source = path.join(root, 'template.svg')

    const cards: OgCard<CardData>[] = [{
      data: { title: 'First' },
      output: 'index.svg',
      sources: ['template.svg']
    }]

    const renderer = vi.fn<OgRenderer<CardData>>(data => `<svg>${data.title}</svg>`)
    const config: OgConfig<CardData> = { cards, renderer, root }

    await writeFile(source, 'one')

    await generate(config)

    cards[0] = {
      data: { title: 'Second' },
      output: 'index.svg',
      sources: ['template.svg']
    }

    expect((await generate(config)).generated).toEqual(['index.svg'])

    await writeFile(source, 'two')

    expect((await generate(config)).generated).toEqual(['index.svg'])

    expect(renderer).toHaveBeenCalledTimes(3)
  })

  it('invalidates every card when the semantic cache key changes', async () => {
    const root = await createRoot()
    const renderer = vi.fn<OgRenderer<CardData>>(data => `<svg>${data.title}</svg>`)

    const config: OgConfig<CardData> = {
      cache: { key: 'renderer-v1' },
      cards: [{ data: { title: 'Versioned' }, output: 'index.svg' }],
      renderer,
      root
    }

    const first = await generate(config)

    config.cache = { key: 'renderer-v2' }

    const second = await generate(config)

    expect(first.cacheKey).toBe('renderer-v1')

    expect(second.cacheKey).toBe('renderer-v2')

    expect(second.generated).toEqual(['index.svg'])

    expect(renderer).toHaveBeenCalledTimes(2)
  })

  it('detects corrupted output bytes in generate and check modes', async () => {
    const root = await createRoot()
    const output = path.join(root, 'public/og/index.svg')

    const config: OgConfig<CardData> = {
      cards: [{ data: { title: 'Original' }, output: 'index.svg' }],
      renderer: data => `<svg>${data.title}</svg>`,
      root
    }

    await generate(config)

    await writeFile(output, '<svg>corrupted</svg>')

    expect((await generate(config, { check: true })).stale).toEqual(['index.svg'])

    expect((await generate(config)).generated).toEqual(['index.svg'])

    await expect(readFile(output, 'utf8')).resolves.toBe('<svg>Original</svg>')
  })

  it('expands source callbacks and glob patterns', async () => {
    const root = await createRoot()
    const sourceDirectory = path.join(root, 'covers')

    await mkdir(sourceDirectory)

    await writeFile(path.join(sourceDirectory, 'one.txt'), 'one')

    const config: OgConfig<CardData> = {
      cache: { sources: () => ['covers/*.txt'] },
      cards: [{ data: { title: 'Glob' }, output: 'index.svg' }],
      renderer: data => `<svg>${data.title}</svg>`,
      root
    }

    await generate(config)

    await writeFile(path.join(sourceDirectory, 'one.txt'), 'two')

    expect((await generate(config)).generated).toEqual(['index.svg'])
  })

  it('writes aliases and named output directories with one render', async () => {
    const root = await createRoot()
    const renderer = vi.fn<OgRenderer<CardData>>(data => `<svg>${data.title}</svg>`)

    const config: OgConfig<CardData> = {
      cards: [{
        aliases: ['og-image.svg', { directory: 'app', output: 'route.svg' }],
        data: { title: 'Shared' },
        output: 'og.svg'
      }],
      outputDirectories: { app: 'apps/site/public' },
      renderer,
      root
    }

    const result = await generate(config)

    expect(result.generated).toEqual(['og.svg', 'og-image.svg', 'app:route.svg'])

    expect(renderer).toHaveBeenCalledOnce()

    await expect(readFile(path.join(root, 'apps/site/public/route.svg'), 'utf8'))
      .resolves.toBe('<svg>Shared</svg>')

    const cleaned = await generate({ cards: [], clean: true, renderer, root })

    expect(cleaned.cleaned).toEqual(['app:route.svg', 'og-image.svg', 'og.svg'])

    await expect(readFile(path.join(root, 'apps/site/public/route.svg')))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('copies pass-through assets and tracks them for cleanup', async () => {
    const root = await createRoot()

    await writeFile(path.join(root, 'icon.svg'), '<svg>icon</svg>')

    const assets = [{ aliases: ['icon-copy.svg'], output: 'icon.svg', source: 'icon.svg' }]

    const config: OgConfig<CardData> = {
      assets,
      cards: [],
      clean: true,
      renderer: () => '',
      root
    }

    expect((await generate(config)).generated).toEqual(['icon.svg', 'icon-copy.svg'])

    assets.splice(0)

    expect((await generate(config)).cleaned).toEqual(['icon-copy.svg', 'icon.svg'])
  })

  it('compares generated pixels without replacing the existing output', async () => {
    const root = await createRoot()

    const config: OgConfig<CardData> = {
      cards: [{ data: { title: 'Current' }, output: 'index.svg' }],
      renderer: () => '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
      root
    }

    await generate(config)

    const output = path.join(root, 'public/og/index.svg')

    await writeFile(output, '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>')

    const comparisons = await compare(config)

    expect(comparisons[0]).toMatchObject({
      output: 'index.svg',
      pixelDifference: { different: 100, total: 100 },
      status: 'changed'
    })

    await expect(readFile(output, 'utf8')).resolves.toContain('fill="blue"')
  })

  it('cleans only obsolete outputs tracked by the manifest', async () => {
    const root = await createRoot()
    const cards: OgCard<CardData>[] = [{ data: { title: 'Tracked' }, output: 'tracked.svg' }]

    const config: OgConfig<CardData> = {
      cards: () => cards,
      clean: true,
      renderer: data => `<svg>${data.title}</svg>`,
      root
    }

    await generate(config)

    await writeFile(path.join(root, 'public/og/untracked.txt'), 'keep')

    cards.splice(0)

    const result = await generate(config)

    expect(result.cleaned).toEqual(['tracked.svg'])

    await expect(readFile(path.join(root, 'public/og/untracked.txt'), 'utf8')).resolves.toBe('keep')
  })

  it('reports stale outputs in check mode without writing', async () => {
    const root = await createRoot()
    const output = path.join(root, 'public/og/index.svg')

    const result = await generate({
      cards: [{ data: { title: 'Missing' }, output: 'index.svg' }],
      renderer: data => `<svg>${data.title}</svg>`,
      root
    }, { check: true })

    expect(result.stale).toEqual(['index.svg'])

    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects traversal and duplicate output paths', async () => {
    const root = await createRoot()
    const renderer: OgRenderer<CardData> = data => `<svg>${data.title}</svg>`

    await expect(generate({
      cards: [{ data: { title: 'Escape' }, output: '../escape.svg' }],
      renderer,
      root
    })).rejects.toThrow('must stay inside')

    await expect(generate({
      cards: [
        { data: { title: 'One' }, output: 'same.svg' },
        { data: { title: 'Two' }, output: 'same.svg' }
      ],
      renderer,
      root
    })).rejects.toThrow('Duplicate OG output')
  })
})
