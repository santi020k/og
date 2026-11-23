import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { generate } from '../src/generate.js'
import type { OgConfig, OgRenderer } from '../src/types.js'

const roots: string[] = []

const createRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'og-portable-'))

  roots.push(root)

  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

describe('portable generation cache', () => {
  it('reuses copied cards, aliases, assets and versioned URLs after a checkout moves', async () => {
    const original = await createRoot()
    const moved = await createRoot()
    const external = path.join(await createRoot(), 'shared.txt')
    const renderer = vi.fn<OgRenderer<{ title: string }>>(data => `<svg>${data.title}</svg>`)

    await mkdir(path.join(original, 'content'))

    await writeFile(path.join(original, 'content/article.md'), 'Article')

    await writeFile(path.join(original, 'content/brand.txt'), 'Brand')

    await writeFile(external, 'External shared input')

    const config = (root: string): OgConfig<{ title: string }> => ({
      assets: [{ source: path.join(root, 'content/brand.txt'), output: 'brand.txt' }],
      cache: { sources: [external, 'content/brand.txt', path.join(root, 'content/brand.txt')] },
      cards: [{
        aliases: ['alias.svg'],
        data: { title: 'Portable' },
        output: 'article.svg',
        route: { pathname: '/article/' },
        sources: [path.join(root, 'content/article.md')]
      }],
      renderer,
      root,
      routeManifest: { cacheBust: true }
    })

    await generate(config(original))

    await cp(original, moved, { recursive: true })

    const cacheBefore = await readFile(path.join(moved, '.og-cache.json'), 'utf8')
    const routesBefore = await readFile(path.join(moved, 'public/og/manifest.json'), 'utf8')

    expect((await generate(config(moved), { check: true })).stale).toEqual([])

    const result = await generate(config(moved))

    expect(result.generated).toEqual([])

    expect(result.skipped).toEqual(['article.svg', 'alias.svg', 'brand.txt'])

    expect(renderer).toHaveBeenCalledOnce()

    expect(await readFile(path.join(moved, '.og-cache.json'), 'utf8')).toBe(cacheBefore)

    expect(await readFile(path.join(moved, 'public/og/manifest.json'), 'utf8')).toBe(routesBefore)

    await writeFile(path.join(moved, 'content/article.md'), 'Changed article')

    expect((await generate(config(moved))).generated).toEqual(['article.svg', 'alias.svg'])

    await writeFile(path.join(moved, 'public/og/article.svg'), 'Corrupt output')

    expect((await generate(config(moved), { check: true })).stale).toEqual(['article.svg'])

    expect((await generate(config(moved))).generated).toEqual(['article.svg', 'alias.svg'])

    await writeFile(path.join(moved, 'content/brand.txt'), 'Changed brand')

    expect((await generate(config(moved))).generated).toEqual(['article.svg', 'alias.svg', 'brand.txt'])

    await writeFile(external, 'Changed external input')

    expect((await generate(config(moved))).generated).toEqual(['article.svg', 'alias.svg'])
  })

  it('retains source identity even when renamed files have identical bytes', async () => {
    const root = await createRoot()

    await mkdir(path.join(root, 'first'))

    await mkdir(path.join(root, 'second'))

    await writeFile(path.join(root, 'first/source.txt'), 'same bytes')

    await writeFile(path.join(root, 'second/source.txt'), 'same bytes')

    const config: OgConfig<{ title: string }> = {
      cards: [{ data: { title: 'Identity' }, output: 'index.svg', sources: ['first/source.txt'] }],
      renderer: data => `<svg>${data.title}</svg>`,
      root
    }

    await generate(config)

    const changed = {
      ...config,
      cards: [{ data: { title: 'Identity' }, output: 'index.svg', sources: ['second/source.txt'] }]
    }

    expect((await generate(changed, { check: true })).stale).toEqual(['index.svg'])
  })
})
