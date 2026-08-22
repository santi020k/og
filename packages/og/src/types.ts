export type Awaitable<T> = Promise<T> | T

export type OgFormat = 'avif' | 'jpeg' | 'jpg' | 'png' | 'svg' | 'webp'

export interface OgCard<T = unknown> {
  /** Data passed to the renderer. It also participates in the cache fingerprint. */
  data: T
  /** Output path relative to outputDirectory, including its extension. */
  output: string
  /** Additional files whose contents invalidate this card. */
  sources?: readonly string[]
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
  sources?: readonly string[]
}

export interface OgConfig<T = unknown> {
  /** Cards or an asynchronous card collector. */
  cards: readonly OgCard<T>[] | (() => Awaitable<readonly OgCard<T>[]>)
  /** Renderer function or worker-module descriptor. */
  renderer: OgRenderer<T> | OgWorkerRenderer<T>
  /** Cache configuration. Content-aware caching is enabled by default. */
  cache?: boolean | OgCacheOptions
  /** Remove outputs previously tracked by this tool when their cards disappear. */
  clean?: boolean
  /** Maximum active renders. Defaults to 1 for functions and available CPUs for workers. */
  concurrency?: number | 'auto'
  /** Default image height. */
  height?: number
  /** Output directory relative to the project root. Defaults to public/og. */
  outputDirectory?: string
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
  concurrency?: number | 'auto'
  /** Regenerate every card. */
  force?: boolean
  /** Receives progress events. */
  onEvent?: (event: OgEvent) => void
}

export type OgEvent =
  | { output: string, type: 'clean' } |
  { output: string, type: 'skip' } |
  { output: string, type: 'write' }

export interface GenerateResult {
  checked: boolean
  cleaned: readonly string[]
  generated: readonly string[]
  skipped: readonly string[]
  stale: readonly string[]
  total: number
}
