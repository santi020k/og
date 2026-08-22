export type Awaitable<T> = Promise<T> | T

export type OgFormat = 'avif' | 'jpeg' | 'jpg' | 'png' | 'svg' | 'webp'

export type OgSourceCollection = readonly string[] | (() => Awaitable<readonly string[]>)

export interface OgOutputTarget {
  /** Named directory from outputDirectories. Omit to use outputDirectory. */
  directory?: string
  /** Path relative to the selected output directory. */
  output: string
}

export interface OgAsset extends OgOutputTarget {
  /** Source file, absolute or relative to the project root. */
  source: string
  /** Additional destinations that receive the same bytes. */
  aliases?: readonly (string | OgOutputTarget)[]
}

export interface OgCard<T = unknown> {
  /** Additional destinations that receive the rendered bytes without rendering again. */
  aliases?: readonly (string | OgOutputTarget)[]
  /** Data passed to the renderer. It also participates in the cache fingerprint. */
  data: T
  /** Output path relative to outputDirectory, including its extension. */
  output: string
  /** Additional formats rendered from the same logical card and output stem. */
  formats?: readonly OgFormat[]
  /** Format-specific aliases for cards that render more than one format. */
  formatAliases?: Readonly<Partial<Record<OgFormat, readonly (string | OgOutputTarget)[]>>>
  /** Named directory from outputDirectories. Omit to use outputDirectory. */
  outputDirectory?: string
  /** Additional files whose contents invalidate this card. */
  sources?: OgSourceCollection
  /** Optional per-card dimensions. */
  height?: number
  width?: number
}

export interface OgRenderContext {
  format: OgFormat
  height: number
  outputPath: string
  root: string
  width: number
}

export type OgRenderOutput = Buffer | string | Uint8Array

export type OgRenderer<T = unknown> = (
  data: T,
  context: OgRenderContext
) => Awaitable<OgRenderOutput>

export interface OgWorkerRenderer<T = unknown> {
  readonly exportName: string
  /** Internal renderer factory loaded inside each worker. */
  readonly factoryModule?: string
  readonly kind: 'worker'
  readonly module: string
  /** Type-only marker that makes descriptors preserve the card data type. */
  readonly renderData?: T
}

export interface OgCacheOptions {
  /** Enables content-aware caching. Defaults to true. */
  enabled?: boolean
  /** Cache manifest path relative to the project root. */
  manifest?: string
  /** Template, font, logo, or asset files shared by every card. */
  /** Paths, glob patterns, or a callback returning either. Absolute paths are supported. */
  sources?: OgSourceCollection
  /** Consumer renderer or preset revision included in every fingerprint. */
  key?: string
}

export interface OgAutoConcurrency {
  /** Upper bound applied after detecting available CPUs. */
  max?: number
  mode: 'auto'
}

export type OgConcurrency = number | 'auto' | OgAutoConcurrency

export interface OgConfig<T = unknown> {
  /** Static assets copied alongside rendered cards. */
  assets?: readonly OgAsset[] | (() => Awaitable<readonly OgAsset[]>)
  /** Cards or an asynchronous card collector. */
  cards: readonly OgCard<T>[] | (() => Awaitable<readonly OgCard<T>[]>)
  /** Renderer function or worker-module descriptor. */
  renderer: OgRenderer<T> | OgWorkerRenderer<T>
  /** Cache configuration. Content-aware caching is enabled by default. */
  cache?: boolean | OgCacheOptions
  /** Remove outputs previously tracked by this tool when their cards disappear. */
  clean?: boolean
  /** Maximum active renders. Defaults to 1 for functions and available CPUs for workers. */
  concurrency?: OgConcurrency
  /** Default image height. */
  height?: number
  /** Output directory relative to the project root. Defaults to public/og. */
  outputDirectory?: string
  /** Additional named output directories, relative to root. */
  outputDirectories?: Readonly<Record<string, string>>
  /** Project root. CLI configs default to the directory containing the config. */
  root?: string
  /** Default image width. */
  width?: number
}

export interface GenerateOptions {
  /** Check whether outputs are current without writing them. */
  check?: boolean
  /** Config-file contents or another value that should invalidate every card. */
  configFingerprint?: string
  /** Override the configured concurrency. */
  concurrency?: OgConcurrency
  /** Regenerate every card. */
  force?: boolean
  /** Receives progress events. */
  onEvent?: (event: OgEvent) => void
  /** @internal Redirect outputs and the manifest for non-destructive comparisons. */
  stagingDirectory?: string
}

export type OgEvent =
  | { output: string, type: 'clean' } |
  { output: string, type: 'skip' } |
  { output: string, type: 'write' }

export interface GenerateResult {
  cacheKey?: string
  checked: boolean
  cleaned: readonly string[]
  generated: readonly string[]
  skipped: readonly string[]
  stale: readonly string[]
  total: number
  version: string
  elapsedMilliseconds: number
}
