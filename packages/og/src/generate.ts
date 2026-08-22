import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import path from 'node:path'

import { mapConcurrent } from './concurrency.js'
import { isWorkerRenderer } from './config.js'
import { hashValues } from './hash.js'
import { emptyManifest, readManifest, writeManifest } from './manifest.js'
import { getFormat, resolveInside } from './paths.js'
import type {
  GenerateOptions,
  GenerateResult,
  OgCacheOptions,
  OgCard,
  OgConfig,
  OgEvent,
  OgRenderContext,
  OgRenderOutput
} from './types.js'
import { OgWorkerPool } from './worker-pool.js'

interface PreparedCard<T> {
  card: OgCard<T>
  context: OgRenderContext
  fingerprint: string
  outputPath: string
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath)

    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false

    throw error
  }
}

const getCacheOptions = (cache: OgConfig['cache']): Required<OgCacheOptions> => {
  if (cache === false) return { enabled: false, manifest: '.og-cache.json', sources: [] }

  if (cache === true || cache === undefined) {
    return { enabled: true, manifest: '.og-cache.json', sources: [] }
  }

  return {
    enabled: cache.enabled ?? true,
    manifest: cache.manifest ?? '.og-cache.json',
    sources: cache.sources ?? []
  }
}

const getConcurrency = <T>(
  config: OgConfig<T>,
  options: GenerateOptions
): number => {
  const configured = options.concurrency ?? config.concurrency

  if (typeof configured === 'number') {
    if (!Number.isSafeInteger(configured) || configured < 1) {
      throw new Error('OG concurrency must be a positive integer.')
    }

    return configured
  }

  if (configured === 'auto') {
    return Math.max(1, availableParallelism())
  }

  if (isWorkerRenderer(config.renderer)) {
    return Math.max(1, availableParallelism())
  }

  return 1
}

const normalizeOutput = (output: OgRenderOutput): Buffer | string => {
  if (typeof output === 'string' || Buffer.isBuffer(output)) return output

  return Buffer.from(output)
}

const emit = (options: GenerateOptions, event: OgEvent): void => options.onEvent?.(event)

interface CardSelection<T> {
  skipped: string[]
  stale: PreparedCard<T>[]
}

interface RenderSession<T> {
  close: () => Promise<void>
  render: (item: PreparedCard<T>) => Promise<OgRenderOutput>
}

const prepareCards = async <T>(parameters: {
  cards: readonly OgCard<T>[]
  config: OgConfig<T>
  globalSources: readonly string[]
  nextEntries: Record<string, string>
  options: GenerateOptions
  outputDirectory: string
  root: string
  workerSources: readonly string[]
}): Promise<PreparedCard<T>[]> => {
  const outputNames = new Set<string>()

  return Promise.all(parameters.cards.map(async card => {
    if (outputNames.has(card.output)) throw new Error(`Duplicate OG output: ${card.output}`)

    outputNames.add(card.output)

    const outputPath = resolveInside(parameters.outputDirectory, card.output, 'card output')

    const context: OgRenderContext = {
      format: getFormat(card.output),
      height: card.height ?? parameters.config.height ?? 630,
      outputPath,
      root: parameters.root,
      width: card.width ?? parameters.config.width ?? 1200
    }

    const sources = [
      ...parameters.globalSources,
      ...parameters.workerSources,
      ...(card.sources ?? []).map(source => path.resolve(parameters.root, source))
    ]

    const fingerprint = await hashValues([
      'santi020k-og-cache-v1',
      parameters.options.configFingerprint ?? '',
      card.output,
      card.data,
      context.height,
      context.width
    ], sources)

    parameters.nextEntries[card.output] = fingerprint

    return { card, context, fingerprint, outputPath }
  }))
}

const selectCards = async <T>(
  prepared: readonly PreparedCard<T>[],
  previousEntries: Readonly<Record<string, string>>,
  cacheEnabled: boolean,
  options: GenerateOptions
): Promise<CardSelection<T>> => {
  const selection: CardSelection<T> = { skipped: [], stale: [] }

  for (const item of prepared) {
    const current = await fileExists(item.outputPath)
    const unchanged = cacheEnabled && previousEntries[item.card.output] === item.fingerprint

    if (!options.force && current && unchanged) {
      selection.skipped.push(item.card.output)

      emit(options, { output: item.card.output, type: 'skip' })
    } else {
      selection.stale.push(item)
    }
  }

  return selection
}

const preserveTrackedOutputs = (
  obsolete: readonly string[],
  previousEntries: Readonly<Record<string, string>>,
  nextEntries: Record<string, string>
): void => {
  for (const output of obsolete) {
    const fingerprint = previousEntries[output]

    if (fingerprint) nextEntries[output] = fingerprint
  }
}

const cleanTrackedOutputs = async (
  obsolete: readonly string[],
  outputDirectory: string,
  options: GenerateOptions
): Promise<string[]> => {
  for (const output of obsolete) {
    const outputPath = resolveInside(outputDirectory, output, 'tracked output')

    await rm(outputPath, { force: true })

    emit(options, { output, type: 'clean' })
  }

  return [...obsolete]
}

const createRenderSession = <T>(
  config: OgConfig<T>,
  root: string,
  concurrency: number
): RenderSession<T> => {
  if (isWorkerRenderer(config.renderer)) {
    const pool = new OgWorkerPool(
      { ...config.renderer, module: path.resolve(root, config.renderer.module) },
      concurrency
    )

    return {
      close: () => pool.close(),
      render: item => pool.render(item.card.data, item.context)
    }
  }

  const renderer = config.renderer

  return {
    close: () => Promise.resolve(),
    render: item => Promise.resolve(renderer(item.card.data, item.context))
  }
}

const renderCards = async <T>(
  cards: readonly PreparedCard<T>[],
  concurrency: number,
  session: RenderSession<T>,
  options: GenerateOptions
): Promise<string[]> => mapConcurrent(cards, concurrency, async item => {
  const result = await session.render(item)

  await mkdir(path.dirname(item.outputPath), { recursive: true })

  await writeFile(item.outputPath, normalizeOutput(result))

  emit(options, { output: item.card.output, type: 'write' })

  return item.card.output
})

export const generate = async <T>(
  config: OgConfig<T>,
  options: GenerateOptions = {}
): Promise<GenerateResult> => {
  const root = path.resolve(config.root ?? process.cwd())
  const outputDirectory = resolveInside(root, config.outputDirectory ?? 'public/og', 'outputDirectory')
  const cache = getCacheOptions(config.cache)
  const manifestPath = resolveInside(root, cache.manifest, 'cache manifest')
  const cards = typeof config.cards === 'function' ? await config.cards() : config.cards
  const previousManifest = await readManifest(manifestPath)
  const nextManifest = emptyManifest()
  const globalSources = cache.sources.map(source => path.resolve(root, source))

  const workerSources = isWorkerRenderer(config.renderer) ?
    [path.resolve(root, config.renderer.module)] :
    []

  const prepared = await prepareCards({
    cards,
    config,
    globalSources,
    nextEntries: nextManifest.entries,
    options,
    outputDirectory,
    root,
    workerSources
  })

  const outputNames = new Set(cards.map(card => card.output))

  const obsolete = Object.keys(previousManifest.entries)
    .filter(output => !outputNames.has(output))
    .sort()

  if (!config.clean) {
    preserveTrackedOutputs(obsolete, previousManifest.entries, nextManifest.entries)
  }

  const selection = await selectCards(prepared, previousManifest.entries, cache.enabled, options)

  const stale = [
    ...(config.clean ? obsolete : []),
    ...selection.stale.map(item => item.card.output)
  ]

  if (options.check) {
    return {
      checked: true,
      cleaned: [],
      generated: [],
      skipped: selection.skipped,
      stale,
      total: cards.length
    }
  }

  const cleaned = config.clean ?
    await cleanTrackedOutputs(obsolete, outputDirectory, options) :
    []

  const concurrency = Math.min(getConcurrency(config, options), Math.max(selection.stale.length, 1))
  const session = createRenderSession(config, root, concurrency)

  try {
    const generated = await renderCards(selection.stale, concurrency, session, options)

    await mkdir(path.dirname(manifestPath), { recursive: true })

    await writeManifest(manifestPath, nextManifest)

    return {
      checked: false,
      cleaned,
      generated,
      skipped: selection.skipped,
      stale: [],
      total: cards.length
    }
  } finally {
    await session.close()
  }
}
