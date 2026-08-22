import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

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
