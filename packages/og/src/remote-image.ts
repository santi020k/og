import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import { resolveInside } from './paths.js'

export type PresetRemoteImageType =
  | 'image/avif' |
  'image/gif' |
  'image/jpeg' |
  'image/png' |
  'image/svg+xml' |
  'image/webp'

export interface PresetRemoteImage {
  /** SHA-256 digest of the expected response bytes. */
  sha256: string
  /** MIME type used to validate and embed the cached image. */
  type: PresetRemoteImageType
  /** HTTPS or HTTP image URL. */
  url: string
}

export interface PresetRemoteImageOptions {
  /** Content-addressed cache inside the project root. Defaults to .santi-og/remote-images. */
  cacheDirectory?: string
  /** Maximum accepted response size. Defaults to 10 MiB. */
  maxBytes?: number
  /** Request timeout. Defaults to 30 seconds. */
  timeoutMilliseconds?: number
}

const extensions: Readonly<Record<PresetRemoteImageType, string>> = {
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp'
}

const formats: Readonly<Record<PresetRemoteImageType, string>> = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp'
}

const digest = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex')

const exists = async (file: string): Promise<boolean> => {
  try {
    await access(file)

    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false

    throw error
  }
}

const positiveInteger = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive integer.`)

  return value
}

const validateSource = (source: PresetRemoteImage): string => {
  let url: URL

  try {
    url = new URL(source.url)
  } catch {
    throw new Error(`Invalid remote preset image URL: ${source.url}`)
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Remote preset images require an HTTP(S) URL: ${source.url}`)
  }

  const sha256 = source.sha256.toLowerCase()

  if (!/^[a-f\d]{64}$/u.test(sha256)) {
    throw new Error(`Remote preset image SHA-256 must contain 64 hexadecimal characters: ${source.url}`)
  }

  return sha256
}

const validateFormat = async (bytes: Uint8Array, source: PresetRemoteImage): Promise<void> => {
  const metadata = await sharp(bytes).metadata()
  const expected = formats[source.type]

  if (metadata.format !== expected) {
    throw new Error(`Remote preset image type ${source.type} does not match ${metadata.format} bytes: ${source.url}`)
  }
}

/** Download a pinned remote image once and reuse its verified content-addressed cache file. */
export const materializeRemoteImage = async (
  source: PresetRemoteImage,
  root: string,
  options: PresetRemoteImageOptions = {}
): Promise<string> => {
  const resolvedRoot = path.resolve(root)
  const sha256 = validateSource(source)
  const maxBytes = positiveInteger(options.maxBytes ?? 10 * 1024 * 1024, 'remoteImages.maxBytes')
  const timeout = positiveInteger(options.timeoutMilliseconds ?? 30_000, 'remoteImages.timeoutMilliseconds')

  const directory = resolveInside(
    resolvedRoot,
    options.cacheDirectory ?? '.santi-og/remote-images',
    'remote image cache directory'
  )

  const destination = path.join(directory, `${sha256}${extensions[source.type]}`)

  if (await exists(destination)) {
    const cachedStats = await stat(destination)
    const cached = cachedStats.size <= maxBytes ? await readFile(destination) : undefined

    if (cached && digest(cached) === sha256) {
      await validateFormat(cached, source)

      return destination
    }
  }

  const response = await fetch(source.url, { signal: AbortSignal.timeout(timeout) })

  if (!response.ok) throw new Error(`Remote preset image request failed (${response.status}): ${source.url}`)

  const responseType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()

  if (responseType && responseType !== source.type) {
    throw new Error(`Remote preset image type mismatch for ${source.url}: expected ${source.type}, received ${responseType}`)
  }

  const declaredLength = Number(response.headers.get('content-length'))

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Remote preset image exceeds ${maxBytes} bytes: ${source.url}`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())

  if (bytes.byteLength > maxBytes) throw new Error(`Remote preset image exceeds ${maxBytes} bytes: ${source.url}`)

  const received = digest(bytes)

  if (received !== sha256) {
    throw new Error(`Remote preset image SHA-256 mismatch for ${source.url}: expected ${sha256}, received ${received}`)
  }

  await validateFormat(bytes, source)

  await mkdir(directory, { recursive: true })

  const temporary = path.join(directory, `.${sha256}.${randomUUID()}.tmp`)

  await writeFile(temporary, bytes, { flag: 'wx' })

  await rename(temporary, destination)

  return destination
}
