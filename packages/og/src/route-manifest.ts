import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getFormat, resolveInside } from './paths.js'
import type {
  OgCard,
  OgConfig,
  OgFormat,
  OgOutputTarget,
  OgRouteManifestOptions } from './types.js'
import { GENERATOR_VERSION } from './version.js'

export interface OgRouteManifestImage {
  directory?: string
  format: OgFormat
  height: number
  output: string
  primary: boolean
  url?: string
  /** Content fingerprint prefix used to invalidate URL-based social-image caches. */
  version?: string
  width: number
}

export interface OgRouteManifestRoute {
  alt?: string
  description?: string
  images: readonly OgRouteManifestImage[]
  pathname: string
  schemaTypes?: readonly string[]
  title?: string
}

export interface OgRouteManifest {
  generatorVersion: string
  routes: Readonly<Record<string, OgRouteManifestRoute>>
  version: 1
}

const extension = (format: OgFormat): string => format === 'jpeg' ? 'jpeg' : format

const replaceFormat = (output: string, format: OgFormat): string => {
  const current = path.posix.extname(output)

  return `${current ? output.slice(0, -current.length) : output}.${extension(format)}`
}

const target = (value: string | OgOutputTarget, directory?: string): OgOutputTarget => (
  typeof value === 'string' ? { ...(directory ? { directory } : {}), output: value } : value
)

const publicUrl = (
  destination: OgOutputTarget,
  options: OgRouteManifestOptions,
  outputDirectory: string,
  version?: string
): string | undefined => {
  const configured = destination.directory ? options.publicPaths?.[destination.directory] : options.publicPath
  const inferred = destination.directory ? undefined : `/${outputDirectory.replace(/^public\/?/u, '')}`
  const base = configured ?? inferred

  if (!base) return undefined

  const pathname = `/${[
    base.replace(/^\/+|\/+$/gu, ''),
    destination.output.replace(/^\//u, '')
  ].filter(Boolean).join('/')}`

  return version ? `${pathname}?v=${encodeURIComponent(version)}` : pathname
}

const normalizePathname = (value: string): string => {
  const pathname = value.split(/[?#]/u, 1)[0] ?? '/'
  const normalized = `/${pathname.replace(/^\/+|\/+$/gu, '')}`

  return normalized === '/' ? normalized : normalized.replace(/\/$/u, '')
}

export interface CreateRouteManifestOptions {
  /** Full fingerprints keyed by output destination. Used by generate() for cache-busted URLs. */
  imageVersions?: Readonly<Record<string, string>>
}

export interface GetRouteManifestImageOptions {
  format?: OgFormat
  primary?: boolean
}

/** Create a deterministic route-to-card manifest without writing it. */
export const createRouteManifest = <T>(
  cards: readonly OgCard<T>[],
  config: Pick<OgConfig<T>, 'height' | 'outputDirectory' | 'routeManifest' | 'width'> = {},
  generation: CreateRouteManifestOptions = {}
): OgRouteManifest => {
  const options = typeof config.routeManifest === 'object' ? config.routeManifest : {}
  const outputDirectory = config.outputDirectory ?? 'public/og'
  const routes: Record<string, OgRouteManifestRoute> = {}

  for (const card of cards) {
    if (!card.route) continue

    const primaryFormat = getFormat(card.output)
    const formats = [...new Set([primaryFormat, ...(card.formats ?? [])])]
    const images: OgRouteManifestImage[] = []

    for (const format of formats) {
      const primaryOutput = format === primaryFormat ? card.output : replaceFormat(card.output, format)

      const aliases = [
        ...(format === primaryFormat ? card.aliases ?? [] : []),
        ...(card.formatAliases?.[format] ?? [])
      ]

      const destinations = [
        target(primaryOutput, card.outputDirectory),
        ...aliases.map(alias => target(alias, card.outputDirectory))
      ]

      destinations.forEach((destination, index) => {
        const fingerprint = generation.imageVersions?.[
          destination.directory ? `${destination.directory}:${destination.output}` : destination.output
        ]

        if (options.cacheBust && !fingerprint) {
          throw new Error(`Missing content fingerprint for cache-busted OG image: ${destination.output}`)
        }

        const version = options.cacheBust && fingerprint ? fingerprint.slice(0, 12) : undefined
        const url = publicUrl(destination, options, outputDirectory, version)

        images.push({
          ...(destination.directory ? { directory: destination.directory } : {}),
          format: getFormat(destination.output),
          height: card.height ?? config.height ?? 630,
          output: destination.output,
          primary: index === 0,
          ...(url ? { url } : {}),
          ...(version ? { version } : {}),
          width: card.width ?? config.width ?? 1200
        })
      })
    }

    if (routes[card.route.pathname]) throw new Error(`Duplicate OG route: ${card.route.pathname}`)

    routes[card.route.pathname] = {
      ...(card.route.alt ? { alt: card.route.alt } : {}),
      ...(card.route.description ? { description: card.route.description } : {}),
      images,
      pathname: card.route.pathname,
      ...(card.route.schemaTypes?.length ? { schemaTypes: card.route.schemaTypes } : {}),
      ...(card.route.title ? { title: card.route.title } : {})
    }
  }

  return { generatorVersion: GENERATOR_VERSION, routes, version: 1 }
}

/** Find the generated image metadata for a route, including its cache-busted public URL. */
export const getRouteManifestImage = (
  manifest: OgRouteManifest,
  pathname: string,
  options: GetRouteManifestImageOptions = {}
): OgRouteManifestImage | undefined => {
  const route = Object.values(manifest.routes).find(candidate => (
    normalizePathname(candidate.pathname) === normalizePathname(pathname)
  ))

  const primary = options.primary ?? true

  return route?.images.find(image => (
    image.primary === primary && (options.format === undefined || image.format === options.format)
  ))
}

export const routeManifestPath = <T>(config: OgConfig<T>, root: string): string => {
  const options = typeof config.routeManifest === 'object' ? config.routeManifest : {}
  const file = options.file ?? path.posix.join(config.outputDirectory ?? 'public/og', 'manifest.json')

  return resolveInside(root, file, 'route manifest')
}

export const serializeRouteManifest = (manifest: OgRouteManifest): string => `${JSON.stringify(manifest, null, 2)}\n`

export const routeManifestIsCurrent = async (
  filePath: string,
  manifest: OgRouteManifest
): Promise<boolean> => {
  try {
    return await readFile(filePath, 'utf8') === serializeRouteManifest(manifest)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false

    throw error
  }
}

export const writeRouteManifest = async (filePath: string, manifest: OgRouteManifest): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true })

  await writeFile(filePath, serializeRouteManifest(manifest))
}
