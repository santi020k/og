import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import path from 'node:path'

import { mapConcurrent } from './concurrency.js'
import { isWorkerRenderer } from './config.js'
import { hashBuffer, hashValues } from './hash.js'
import {
  emptyManifest,
  type OgManifestEntry,
  readManifest,
  writeManifest } from './manifest.js'
import { getFormat, resolveInside } from './paths.js'
import {
  createRouteManifest,
  routeManifestIsCurrent,
  routeManifestPath,
  writeRouteManifest } from './route-manifest.js'
import { collectTransitiveImports, expandSources } from './sources.js'
import type {
  GenerateOptions,
  GenerateResult,
  OgAsset,
  OgCacheOptions,
  OgCard,
  OgConcurrency,
  OgConfig,
  OgEvent,
  OgFormat,
  OgOutputTarget,
  OgRenderContext,
  OgRenderOutput
} from './types.js'
import { GENERATOR_VERSION } from './version.js'
import { OgWorkerPool } from './worker-pool.js'

interface Destination {
  basePath: string
  directory?: string
  key: string
  output: string
  outputPath: string
}

interface PreparedCard<T> {
  card: OgCard<T>
  context: OgRenderContext
  destinations: readonly Destination[]
  fingerprint: string
  kind: 'card'
}

interface PreparedAsset {
  asset: OgAsset
  destinations: readonly Destination[]
  fingerprint: string
  kind: 'asset'
  sourcePath: string
}

type PreparedItem<T> = PreparedAsset | PreparedCard<T>

interface CardSelection<T> {
  skipped: string[]
  stale: PreparedItem<T>[]
  staleOutputs: string[]
}

interface RenderSession<T> {
  close: () => Promise<void>
  render: (item: PreparedCard<T>) => Promise<OgRenderOutput>
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
  if (cache === false) return { enabled: false, key: '', manifest: '.og-cache.json', sources: [] }

  if (cache === true || cache === undefined) {
    return { enabled: true, key: '', manifest: '.og-cache.json', sources: [] }
  }

  return {
    enabled: cache.enabled ?? true,
    key: cache.key ?? '',
    manifest: cache.manifest ?? '.og-cache.json',
    sources: cache.sources ?? []
  }
}

const formatExtension = (format: OgFormat): string => format === 'jpeg' ? 'jpeg' : format

const replaceFormat = (output: string, format: OgFormat): string => {
  const extension = path.posix.extname(output)

  return `${extension ? output.slice(0, -extension.length) : output}.${formatExtension(format)}`
}

const cardFormats = <T>(card: OgCard<T>): OgFormat[] => {
  const primary = getFormat(card.output)

  return [...new Set([primary, ...(card.formats ?? [])])]
}

const cardAliases = <T>(card: OgCard<T>, format: OgFormat, primary: OgFormat): readonly (OgOutputTarget | string)[] => [
  ...(format === primary ? card.aliases ?? [] : []),
  ...(card.formatAliases?.[format] ?? [])
]

const autoConcurrency = (configured: Extract<OgConcurrency, 'auto' | object>): number => {
  const detected = Math.max(1, availableParallelism())

  if (configured === 'auto' || configured.max === undefined) return detected

  if (!Number.isSafeInteger(configured.max) || configured.max < 1) {
    throw new Error('OG automatic concurrency max must be a positive integer.')
  }

  return Math.min(detected, configured.max)
}

const getConcurrency = <T>(config: OgConfig<T>, options: GenerateOptions): number => {
  const configured = options.concurrency ?? config.concurrency

  if (typeof configured === 'number') {
    if (!Number.isSafeInteger(configured) || configured < 1) {
      throw new Error('OG concurrency must be a positive integer.')
    }

    return configured
  }

  if (configured === 'auto' || typeof configured === 'object') return autoConcurrency(configured)

  if (isWorkerRenderer(config.renderer)) return autoConcurrency('auto')

  return 1
}

const normalizeOutput = (output: OgRenderOutput): Buffer | string => {
  if (typeof output === 'string' || Buffer.isBuffer(output)) return output

  return Buffer.from(output)
}

const emit = (options: GenerateOptions, event: OgEvent): void => options.onEvent?.(event)

const destinationKey = (target: OgOutputTarget): string => (
  target.directory ? `${target.directory}:${target.output}` : target.output
)

const destinationLabel = (destination: Pick<Destination, 'directory' | 'output'>): string => (
  destinationKey(destination)
)

const outputTarget = (output: string, directory: string | undefined): OgOutputTarget => ({
  output,
  ...(directory ? { directory } : {})
})

const resolveDirectories = <T>(
  config: OgConfig<T>,
  root: string,
  stagingDirectory?: string
): Map<string | undefined, string> => {
  if (stagingDirectory) {
    const staging = path.resolve(stagingDirectory)
    const directories = new Map<string | undefined, string>([[undefined, path.join(staging, 'default')]])

    for (const name of Object.keys(config.outputDirectories ?? {})) {
      directories.set(name, path.join(staging, 'named', name))
    }

    return directories
  }

  const directories = new Map<string | undefined, string>([
    [undefined, resolveInside(root, config.outputDirectory ?? 'public/og', 'outputDirectory')]
  ])

  for (const [name, directory] of Object.entries(config.outputDirectories ?? {})) {
    if (!name.trim() || name.includes(':')) throw new Error(`Invalid OG output directory name: ${name}`)

    directories.set(name, resolveInside(root, directory, `outputDirectories.${name}`))
  }

  return directories
}

const resolveDestination = (
  target: OgOutputTarget,
  directories: ReadonlyMap<string | undefined, string>
): Destination => {
  const directory = directories.get(target.directory)

  if (!directory) throw new Error(`Unknown OG output directory: ${target.directory ?? '(default)'}`)

  return {
    ...(target.directory ? { directory: target.directory } : {}),
    basePath: directory,
    key: destinationKey(target),
    output: target.output,
    outputPath: resolveInside(directory, target.output, `output ${destinationKey(target)}`)
  }
}

const resolveDestinations = (
  primary: OgOutputTarget,
  aliases: readonly (OgOutputTarget | string)[] | undefined,
  directories: ReadonlyMap<string | undefined, string>
): Destination[] => [primary, ...(aliases ?? []).map(alias => (
  typeof alias === 'string' ? outputTarget(alias, primary.directory) : alias
))].map(target => resolveDestination(target, directories))

const assertUniqueDestinations = <T>(items: readonly PreparedItem<T>[]): void => {
  const paths = new Set<string>()

  for (const item of items) {
    for (const destination of item.destinations) {
      if (paths.has(destination.outputPath)) {
        throw new Error(`Duplicate OG output: ${destinationLabel(destination)}`)
      }

      paths.add(destination.outputPath)
    }
  }
}

const withSourceContext = async <T>(label: string, operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    throw new Error(`${label}: ${message}`, { cause: error })
  }
}

const prepareCard = async <T>(parameters: {
  aliases: readonly (OgOutputTarget | string)[]
  card: OgCard<T>
  config: OgConfig<T>
  directories: ReadonlyMap<string | undefined, string>
  globalSources: readonly string[]
  options: GenerateOptions
  output: string
  root: string
  workerSources: readonly string[]
}): Promise<PreparedCard<T>> => {
  const { card } = parameters
  const primary = outputTarget(parameters.output, card.outputDirectory)
  const destinations = resolveDestinations(primary, parameters.aliases, parameters.directories)
  const format = getFormat(parameters.output)

  for (const alias of destinations.slice(1)) {
    const aliasFormat = getFormat(alias.output)

    const compatible = aliasFormat === format ||
      (['jpeg', 'jpg'].includes(aliasFormat) && ['jpeg', 'jpg'].includes(format))

    if (!compatible) {
      throw new Error(`OG alias must use the same format as ${destinationKey(primary)}: ${destinationLabel(alias)}`)
    }
  }

  const context: OgRenderContext = {
    format,
    height: card.height ?? parameters.config.height ?? 630,
    outputPath: destinations[0]?.outputPath ?? '',
    root: parameters.root,
    width: card.width ?? parameters.config.width ?? 1200
  }

  const cardSources = await expandSources(card.sources, parameters.root, destinationKey(primary))
  const sources = [...parameters.globalSources, ...parameters.workerSources, ...cardSources]

  const fingerprint = await withSourceContext(
    `Unable to fingerprint OG card ${destinationKey(primary)}`,
    () => hashValues([
      'santi020k-og-cache-v2',
      GENERATOR_VERSION,
      typeof parameters.config.cache === 'object' ? parameters.config.cache.key ?? '' : '',
      parameters.options.configFingerprint ?? '',
      destinations.map(destination => destination.key),
      card.data,
      context.format,
      context.height,
      context.width
    ], sources)
  )

  return { card, context, destinations, fingerprint, kind: 'card' }
}

const prepareAsset = async (parameters: {
  asset: OgAsset
  directories: ReadonlyMap<string | undefined, string>
  options: GenerateOptions
  root: string
}): Promise<PreparedAsset> => {
  const { asset } = parameters
  const destinations = resolveDestinations(asset, asset.aliases, parameters.directories)
  const sourcePath = path.resolve(parameters.root, asset.source)

  const fingerprint = await withSourceContext(
    `Unable to fingerprint OG asset ${destinationKey(asset)} from ${sourcePath}`,
    () => hashValues([
      'santi020k-og-asset-v1',
      parameters.options.configFingerprint ?? '',
      destinations.map(destination => destination.key)
    ], [sourcePath])
  )

  return { asset, destinations, fingerprint, kind: 'asset', sourcePath }
}

const outputIsCurrent = async (
  destination: Destination,
  fingerprint: string,
  previousEntry: OgManifestEntry | undefined,
  cacheEnabled: boolean
): Promise<boolean> => {
  if (!cacheEnabled || previousEntry?.fingerprint !== fingerprint || !previousEntry.digest) return false

  if (!await fileExists(destination.outputPath)) return false

  return hashBuffer(await readFile(destination.outputPath)) === previousEntry.digest
}

const selectItems = async <T>(
  prepared: readonly PreparedItem<T>[],
  previousEntries: Readonly<Record<string, OgManifestEntry>>,
  cacheEnabled: boolean,
  options: GenerateOptions
): Promise<CardSelection<T>> => {
  const selection: CardSelection<T> = { skipped: [], stale: [], staleOutputs: [] }

  for (const item of prepared) {
    const current = await Promise.all(item.destinations.map(destination => (
      outputIsCurrent(destination, item.fingerprint, previousEntries[destination.key], cacheEnabled)
    )))

    if (!options.force && current.every(Boolean)) {
      for (const destination of item.destinations) {
        selection.skipped.push(destinationLabel(destination))

        emit(options, { output: destinationLabel(destination), type: 'skip' })
      }
    } else {
      selection.stale.push(item)

      item.destinations.forEach((destination, index) => {
        if (options.force || !current[index]) selection.staleOutputs.push(destinationLabel(destination))
      })
    }
  }

  return selection
}

const manifestDestination = (
  key: string,
  entry: OgManifestEntry,
  directories: ReadonlyMap<string | undefined, string>,
  root: string
): Destination => {
  const target = outputTarget(entry.output ?? key, entry.directory)

  if (entry.directory && !directories.has(entry.directory) && entry.baseDirectory) {
    const basePath = resolveInside(root, entry.baseDirectory, `tracked output directory ${entry.directory}`)

    return {
      basePath,
      directory: entry.directory,
      key,
      output: target.output,
      outputPath: resolveInside(basePath, target.output, `tracked output ${key}`)
    }
  }

  return resolveDestination(target, directories)
}

const cleanTrackedOutputs = async (
  obsolete: readonly [string, OgManifestEntry][],
  directories: ReadonlyMap<string | undefined, string>,
  root: string,
  options: GenerateOptions
): Promise<string[]> => {
  const cleaned: string[] = []

  for (const [key, entry] of obsolete) {
    const destination = manifestDestination(key, entry, directories, root)

    await rm(destination.outputPath, { force: true })

    cleaned.push(key)

    emit(options, { output: key, type: 'clean' })
  }

  return cleaned
}

const createRenderSession = <T>(
  config: OgConfig<T>,
  root: string,
  concurrency: number
): RenderSession<T> => {
  if (isWorkerRenderer(config.renderer)) {
    const pool = new OgWorkerPool(
      {
        ...config.renderer,
        ...(config.renderer.factoryModule ?
          { factoryModule: path.resolve(root, config.renderer.factoryModule) } :
          {}),
        module: path.resolve(root, config.renderer.module)
      },
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

const renderItems = async <T>(
  items: readonly PreparedItem<T>[],
  concurrency: number,
  session: RenderSession<T>,
  nextEntries: Record<string, OgManifestEntry>,
  options: GenerateOptions
): Promise<string[]> => {
  const nested = await mapConcurrent(items, concurrency, async item => {
    const label = destinationLabel(item.destinations[0] ?? { output: '(unknown)' })

    return withSourceContext(`Unable to write OG output ${label}`, async () => {
      const output = normalizeOutput(
        item.kind === 'asset' ? await readFile(item.sourcePath) : await session.render(item)
      )

      const digest = hashBuffer(output)

      for (const destination of item.destinations) {
        await mkdir(path.dirname(destination.outputPath), { recursive: true })

        await writeFile(destination.outputPath, output)

        const baseDirectory = nextEntries[destination.key]?.baseDirectory

        nextEntries[destination.key] = {
          ...(baseDirectory ? { baseDirectory } : {}),
          digest,
          fingerprint: item.fingerprint,
          ...(destination.directory ? { directory: destination.directory } : {}),
          output: destination.output
        }

        emit(options, { output: destinationLabel(destination), type: 'write' })
      }

      return item.destinations.map(destinationLabel)
    })
  })

  return nested.flat()
}

export const generate = async <T>(
  config: OgConfig<T>,
  options: GenerateOptions = {}
): Promise<GenerateResult> => {
  const startedAt = performance.now()
  const root = path.resolve(config.root ?? process.cwd())
  const directories = resolveDirectories(config, root, options.stagingDirectory)
  const cache = getCacheOptions(config.cache)

  const manifestPath = options.stagingDirectory ?
    path.join(path.resolve(options.stagingDirectory), '.og-cache.json') :
    resolveInside(root, cache.manifest, 'cache manifest')

  const cards = typeof config.cards === 'function' ? await config.cards() : config.cards
  const assets = typeof config.assets === 'function' ? await config.assets() : (config.assets ?? [])
  const previousManifest = await readManifest(manifestPath)
  const nextManifest = emptyManifest(GENERATOR_VERSION, cache.key || undefined)
  const globalSources = await expandSources(cache.sources, root, 'cache')
  const workerDescriptor = isWorkerRenderer(config.renderer) ? config.renderer : undefined

  const workerEntries = workerDescriptor ?
    [workerDescriptor.module, ...(workerDescriptor.factoryModule ? [workerDescriptor.factoryModule] : [])] :
    []

  const workerSources = (
    await Promise.all(workerEntries.map(workerEntry => withSourceContext(
      `Unable to inspect worker renderer ${path.resolve(root, workerEntry)}`,
      () => collectTransitiveImports(path.resolve(root, workerEntry), root)
    )))
  ).flat()

  const preparedCards = (await Promise.all(cards.map(async card => {
    const primary = getFormat(card.output)

    return Promise.all(cardFormats(card).map(format => prepareCard({
      aliases: cardAliases(card, format, primary),
      card,
      config,
      directories,
      globalSources,
      options,
      output: format === primary ? card.output : replaceFormat(card.output, format),
      root,
      workerSources
    })))
  }))).flat()

  const preparedAssets = await Promise.all(assets.map(asset => prepareAsset({
    asset,
    directories,
    options,
    root
  })))

  const prepared: PreparedItem<T>[] = [...preparedCards, ...preparedAssets]

  assertUniqueDestinations(prepared)

  for (const item of prepared) {
    for (const destination of item.destinations) {
      nextManifest.entries[destination.key] = {
        baseDirectory: path.relative(root, destination.basePath),
        fingerprint: item.fingerprint,
        ...(destination.directory ? { directory: destination.directory } : {}),
        output: destination.output
      }
    }
  }

  const outputNames = new Set(Object.keys(nextManifest.entries))

  const obsolete = Object.entries(previousManifest.entries)
    .filter(([output]) => !outputNames.has(output))
    .sort(([left], [right]) => left.localeCompare(right))

  if (!config.clean) {
    for (const [output, entry] of obsolete) nextManifest.entries[output] = entry
  }

  const selection = await selectItems(prepared, previousManifest.entries, cache.enabled, options)

  for (const item of prepared) {
    for (const destination of item.destinations) {
      const previous = previousManifest.entries[destination.key]

      if (previous?.digest && previous.fingerprint === item.fingerprint) {
        nextManifest.entries[destination.key] = previous
      }
    }
  }

  const stale = [
    ...(config.clean ? obsolete.map(([output]) => output) : []),
    ...selection.staleOutputs
  ]

  const routeManifest = config.routeManifest ? createRouteManifest(cards, config) : undefined
  let publicManifestPath: string | undefined

  if (routeManifest) {
    publicManifestPath = options.stagingDirectory ?
      path.join(path.resolve(options.stagingDirectory), 'route-manifest.json') :
      routeManifestPath(config, root)
  }

  if (routeManifest && publicManifestPath && !await routeManifestIsCurrent(publicManifestPath, routeManifest)) {
    stale.push(path.relative(root, publicManifestPath))
  }

  if (options.check) {
    return {
      ...(cache.key ? { cacheKey: cache.key } : {}),
      checked: true,
      cleaned: [],
      generated: [],
      skipped: selection.skipped,
      stale,
      elapsedMilliseconds: performance.now() - startedAt,
      total: prepared.reduce((count, item) => count + item.destinations.length, 0),
      version: GENERATOR_VERSION
    }
  }

  const cleaned = config.clean ? await cleanTrackedOutputs(obsolete, directories, root, options) : []
  const concurrency = Math.min(getConcurrency(config, options), Math.max(selection.stale.length, 1))
  const session = createRenderSession(config, root, concurrency)

  try {
    const generated = await renderItems(selection.stale, concurrency, session, nextManifest.entries, options)

    await mkdir(path.dirname(manifestPath), { recursive: true })

    await writeManifest(manifestPath, nextManifest)

    if (routeManifest && publicManifestPath) await writeRouteManifest(publicManifestPath, routeManifest)

    return {
      ...(cache.key ? { cacheKey: cache.key } : {}),
      checked: false,
      cleaned,
      generated,
      skipped: selection.skipped,
      stale: [],
      elapsedMilliseconds: performance.now() - startedAt,
      total: prepared.reduce((count, item) => count + item.destinations.length, 0),
      version: GENERATOR_VERSION
    }
  } finally {
    await session.close()
  }
}
