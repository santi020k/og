import path from 'node:path'

import type { OgFormat, OgRenderer } from './types.js'

export type ImageResponseHeaders =
  Headers |
  Record<string, string> |
  [string, string][]

export interface ImageResponseOptions {
  /** Browser and CDN cache policy. Defaults to one year and immutable. */
  cacheControl?: string
  /** Output format passed to the renderer. Defaults to png. */
  format?: OgFormat
  /** Additional response headers. Content-Type and Cache-Control may be overridden. */
  headers?: ImageResponseHeaders
  height?: number
  /** Logical output path exposed to renderers. */
  outputPath?: string
  /** Project root used to resolve renderer assets. */
  root?: string
  status?: number
  width?: number
}

const contentTypes: Readonly<Record<OgFormat, string>> = {
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml; charset=utf-8',
  webp: 'image/webp'
}

const positiveInteger = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive integer`)

  return value
}

/** Render one image and return a standards-based Response for Astro, Next.js, or any Fetch runtime. */
export const createImageResponse = async <T>(
  renderer: OgRenderer<T>,
  data: T,
  options: ImageResponseOptions = {}
): Promise<Response> => {
  const format = options.format ?? 'png'
  const width = positiveInteger(options.width ?? 1200, 'width')
  const height = positiveInteger(options.height ?? 630, 'height')
  const root = path.resolve(options.root ?? process.cwd())
  const outputPath = path.resolve(root, options.outputPath ?? `runtime.${format}`)
  const rendered = await renderer(data, { format, height, outputPath, root, width })
  const body = typeof rendered === 'string' ? rendered : new Uint8Array(rendered)
  const headers = new Headers(options.headers)

  if (!headers.has('content-type')) headers.set('content-type', contentTypes[format])

  if (!headers.has('cache-control')) {
    headers.set('cache-control', options.cacheControl ?? 'public, max-age=31536000, immutable')
  }

  return new Response(body, { headers, status: options.status ?? 200 })
}
