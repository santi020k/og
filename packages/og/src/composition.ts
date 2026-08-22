import path from 'node:path'

import type {
  Awaitable,
  OgCard,
  OgFormat,
  OgOutputTarget,
  OgRenderContext,
  OgRenderer,
  OgRenderOutput
} from './types.js'

export interface LegacyCardSpec<T> {
  aliases?: readonly (string | OgOutputTarget)[]
  height?: number
  outFile: string
  props: T
  sources?: OgCard<T>['sources']
  width?: number
}

export interface PathCardSpec<T> {
  aliases?: readonly (string | OgOutputTarget)[]
  data: T
  height?: number
  pathname: string
  sources?: OgCard<T>['sources']
  width?: number
}

export interface PathCardOptions {
  directory?: string
  extension?: string
}

export interface CreateCardsOptions<T, TData> {
  aliases?: (item: T, data: TData, index: number) => OgCard<TData>['aliases']
  formats?: readonly OgFormat[]
  formatAliases?: (item: T, data: TData, index: number) => OgCard<TData>['formatAliases']
  height?: number
  output: (item: T, data: TData, index: number) => string
  outputDirectory?: string
  sources?: (item: T, data: TData, index: number) => OgCard<TData>['sources']
  width?: number
}

/** Map any typed catalog into cards while keeping derived output and source rules in one place. */
export const createCards = <T, TData>(
  items: readonly T[],
  mapper: (item: T, index: number) => TData,
  options: CreateCardsOptions<T, TData>
): OgCard<TData>[] => items.map((item, index) => {
  const data = mapper(item, index)
  const aliases = options.aliases?.(item, data, index)
  const formatAliases = options.formatAliases?.(item, data, index)
  const sources = options.sources?.(item, data, index)

  return {
    data,
    output: options.output(item, data, index),
    ...(aliases ? { aliases } : {}),
    ...(options.formats ? { formats: options.formats } : {}),
    ...(formatAliases ? { formatAliases } : {}),
    ...(options.height === undefined ? {} : { height: options.height }),
    ...(options.outputDirectory ? { outputDirectory: options.outputDirectory } : {}),
    ...(sources ? { sources } : {}),
    ...(options.width === undefined ? {} : { width: options.width })
  }
})

/** Convert the common legacy `{ outFile, props }` shape into cards. */
export const fromLegacyCards = <T>(specs: readonly LegacyCardSpec<T>[]): OgCard<T>[] => (
  specs.map(spec => ({
    data: spec.props,
    output: spec.outFile,
    ...(spec.aliases ? { aliases: spec.aliases } : {}),
    ...(spec.height === undefined ? {} : { height: spec.height }),
    ...(spec.sources ? { sources: spec.sources } : {}),
    ...(spec.width === undefined ? {} : { width: spec.width })
  }))
)

/** Convert a URL pathname into a deterministic, filesystem-safe output name. */
export const pathnameOutput = (
  pathname: string,
  options: PathCardOptions = {}
): string => {
  const extension = options.extension?.replace(/^\./u, '') ?? 'webp'

  const filename = pathname
    .replace(/^\/+|\/+$/gu, '')
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment).replaceAll('%', '~'))
    .join('--') || 'index'

  const directory = options.directory?.replace(/^\/+|\/+$/gu, '')

  return [directory, `${filename}.${extension}`].filter(Boolean).join('/')
}

/** Create cards from URL-oriented page definitions without repeating output mapping. */
export const createPathCards = <T>(
  specs: readonly PathCardSpec<T>[],
  options: PathCardOptions = {}
): OgCard<T>[] => specs.map(spec => ({
  data: spec.data,
  output: pathnameOutput(spec.pathname, options),
  ...(spec.aliases ? { aliases: spec.aliases } : {}),
  ...(spec.height === undefined ? {} : { height: spec.height }),
  ...(spec.sources ? { sources: spec.sources } : {}),
  ...(spec.width === undefined ? {} : { width: spec.width })
}))

/** Derive a portable card output from a path inside outputDirectory. */
export const relativeOutput = (outputDirectory: string, outFile: string): string => {
  const relative = path.relative(path.resolve(outputDirectory), path.resolve(outFile))

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Output must stay inside ${path.resolve(outputDirectory)}: ${outFile}`)
  }

  return relative.split(path.sep).join('/')
}

/** Give an existing encoded PNG/WebP/etc. function the OgRenderer type. */
export const createEncodedRenderer = <T>(
  render: (data: T, context: OgRenderContext) => Awaitable<OgRenderOutput>
): OgRenderer<T> => ((data, context) => render(data, context))
