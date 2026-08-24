export type InspectionStatus = 'error' | 'pass' | 'warning'

export interface InspectionCheck {
  code: string
  label: string
  message: string
  status: InspectionStatus
}

export interface InspectedImage {
  bytes?: number
  contentType?: string
  height?: number
  status?: number
  url: string
  width?: number
}

export interface InspectedMetadata {
  canonical?: string
  description?: string
  h1Count: number
  language?: string
  openGraph: Readonly<Record<string, string>>
  robots?: string
  schemaTypes: readonly string[]
  title?: string
  twitter: Readonly<Record<string, string>>
}

export interface UrlInspection {
  checks: readonly InspectionCheck[]
  elapsedMilliseconds: number
  finalUrl: string
  image?: InspectedImage
  metadata: InspectedMetadata
  redirects: readonly string[]
  requestedUrl: string
  responseStatus: number
  score: number
  summary: Readonly<Record<InspectionStatus, number>>
}

export interface InspectUrlOptions {
  authorizeUrl?: (url: URL) => Promise<void> | void
  fetcher?: typeof fetch
  maxHtmlBytes?: number
  maxImageBytes?: number
  maxRedirects?: number
  timeoutMilliseconds?: number
}

interface ParsedHtml {
  h1Count: number
  language?: string
  links: readonly Readonly<Record<string, string>>[]
  metaTags: readonly Readonly<Record<string, string>>[]
  schemas: readonly unknown[]
  title?: string
}

const attributePattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu

const decodeHtml = (value: string): string => value
  .replaceAll(/&#(\d+);/gu, (_, code: string) => String.fromCodePoint(Number(code)))
  .replaceAll(/&#x([\da-f]+);/giu, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replaceAll('&amp;', '&')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', '\'')

const attributes = (source: string): Readonly<Record<string, string>> => {
  const values: Record<string, string> = {}

  for (const match of source.matchAll(attributePattern)) {
    const name = match[1]?.toLowerCase()

    if (name) values[name] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '')
  }

  return values
}

const parseHtml = (html: string): ParsedHtml => {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(html)?.[1]?.trim()
  const language = attributes(/<html\b([^>]*)>/iu.exec(html)?.[1] ?? '').lang

  const schemas = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)]
    .filter(match => attributes(match[1] ?? '').type?.toLowerCase() === 'application/ld+json')
    .flatMap(match => {
      try {
        const value: unknown = JSON.parse(match[2]?.trim() ?? '')

        return value && typeof value === 'object' ? [value] : []
      } catch {
        return []
      }
    })

  return {
    h1Count: [...html.matchAll(/<h1\b/giu)].length,
    ...(language ? { language } : {}),
    links: [...html.matchAll(/<link\b([^>]*)>/giu)].map(match => attributes(match[1] ?? '')),
    metaTags: [...html.matchAll(/<meta\b([^>]*)>/giu)].map(match => attributes(match[1] ?? '')),
    schemas,
    ...(title ? { title: decodeHtml(title.replaceAll(/<[^>]+>/gu, '')) } : {})
  }
}

const collectSchemaTypes = (value: unknown, types = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) {
    value.forEach(item => collectSchemaTypes(item, types))

    return types
  }

  if (!value || typeof value !== 'object') return types

  const node = value as Readonly<Record<string, unknown>>
  const type = node['@type']

  if (typeof type === 'string') types.add(type)
  else if (Array.isArray(type)) type.forEach(item => {
    if (typeof item === 'string') types.add(item)
  })

  Object.values(node).forEach(item => collectSchemaTypes(item, types))

  return types
}

const meta = (parsed: ParsedHtml, key: string): string | undefined => parsed.metaTags.find(item => (
  item.name?.toLowerCase() === key || item.property?.toLowerCase() === key
))?.content

const link = (parsed: ParsedHtml, relationship: string): string | undefined => parsed.links.find(item => (
  item.rel?.toLowerCase().split(/\s+/u).includes(relationship)
))?.href

const recordWithPrefix = (parsed: ParsedHtml, prefix: string): Readonly<Record<string, string>> => Object.fromEntries(
  parsed.metaTags.flatMap(item => {
    const key = item.property ?? item.name

    return key?.toLowerCase().startsWith(prefix) && item.content ? [[key.toLowerCase(), item.content]] : []
  })
)

const resolveUrl = (value: string | undefined, base: string): string | undefined => {
  if (!value) return undefined

  try {
    return new URL(value, base).href
  } catch {
    return undefined
  }
}

const check = (
  status: InspectionStatus,
  code: string,
  label: string,
  message: string
): InspectionCheck => ({ code, label, message, status })

/** Score inspection checks from 0–100, with warnings earning half credit. */
export const scoreInspectionChecks = (checks: readonly InspectionCheck[]): number => {
  if (checks.length === 0) return 0

  const earned = checks.reduce((total, item) => {
    if (item.status === 'pass') return total + 1

    if (item.status === 'warning') return total + 0.5

    return total
  }, 0)

  return Math.round((earned / checks.length) * 100)
}

const requiredCheck = (
  value: string | undefined,
  code: string,
  label: string
): InspectionCheck => value ?
  check('pass', code, label, `${label} is present.`) :
  check('error', code, label, `${label} is missing.`)

const metadataChecks = (metadata: InspectedMetadata, finalUrl: string): InspectionCheck[] => {
  const checks = [
    requiredCheck(metadata.title, 'title', 'Title'),
    requiredCheck(metadata.description, 'description', 'Meta description'),
    requiredCheck(metadata.robots, 'robots', 'Robots metadata'),
    requiredCheck(metadata.language, 'html-language', 'HTML language'),
    requiredCheck(metadata.canonical, 'canonical', 'Canonical URL'),
    requiredCheck(metadata.openGraph['og:type'], 'og-type', 'og:type'),
    requiredCheck(metadata.openGraph['og:title'], 'og-title', 'og:title'),
    requiredCheck(metadata.openGraph['og:description'], 'og-description', 'og:description'),
    requiredCheck(metadata.openGraph['og:url'], 'og-url', 'og:url'),
    requiredCheck(metadata.openGraph['og:image'], 'og-image', 'og:image'),
    requiredCheck(metadata.openGraph['og:image:width'], 'og-image-width', 'og:image:width'),
    requiredCheck(metadata.openGraph['og:image:height'], 'og-image-height', 'og:image:height'),
    requiredCheck(metadata.openGraph['og:image:alt'], 'og-image-alt', 'og:image:alt'),
    requiredCheck(metadata.twitter['twitter:card'], 'twitter-card', 'twitter:card'),
    requiredCheck(metadata.twitter['twitter:url'], 'twitter-url', 'twitter:url'),
    requiredCheck(metadata.twitter['twitter:title'], 'twitter-title', 'twitter:title'),
    requiredCheck(metadata.twitter['twitter:description'], 'twitter-description', 'twitter:description'),
    requiredCheck(metadata.twitter['twitter:image'], 'twitter-image', 'twitter:image'),
    requiredCheck(metadata.twitter['twitter:image:alt'], 'twitter-image-alt', 'twitter:image:alt')
  ]

  checks.push(metadata.h1Count === 1 ?
    check('pass', 'h1-count', 'Primary heading', 'The page has exactly one h1.') :
    check('error', 'h1-count', 'Primary heading', `Expected one h1; found ${metadata.h1Count}.`))

  checks.push(metadata.schemaTypes.length > 0 ?
    check('pass', 'json-ld', 'Structured data', `Found ${metadata.schemaTypes.join(', ')}.`) :
    check('warning', 'json-ld', 'Structured data', 'No valid JSON-LD schema was found.'))

  if (metadata.title) {
    checks.push(metadata.title.length <= 60 ?
      check('pass', 'title-length', 'Title length', `${metadata.title.length} characters.`) :
      check('warning', 'title-length', 'Title length', `${metadata.title.length} characters; aim for 60 or fewer.`))
  }

  if (metadata.description) {
    checks.push(metadata.description.length >= 50 && metadata.description.length <= 160 ?
      check('pass', 'description-length', 'Description length', `${metadata.description.length} characters.`) :
      check('warning', 'description-length', 'Description length', `${metadata.description.length} characters; aim for 50–160.`))
  }

  if (metadata.canonical) {
    const canonical = resolveUrl(metadata.canonical, finalUrl)

    checks.push(canonical ?
      check(canonical === finalUrl ? 'pass' : 'warning', 'canonical-match', 'Canonical target', canonical === finalUrl ?
        'The canonical matches the final URL.' :
        `The canonical resolves to ${canonical}.`) :
      check('error', 'canonical-match', 'Canonical target', 'The canonical URL is invalid.'))
  }

  return checks
}

/** Parse one HTML document into portable metadata suitable for audits and interactive tools. */
export const inspectHtml = (html: string, finalUrl: string): Omit<UrlInspection, 'elapsedMilliseconds' | 'image' | 'redirects' | 'requestedUrl' | 'responseStatus' | 'score' | 'summary'> => {
  const parsed = parseHtml(html)
  const canonical = link(parsed, 'canonical')
  const description = meta(parsed, 'description')
  const robots = meta(parsed, 'robots')
  const openGraph = recordWithPrefix(parsed, 'og:')
  const twitter = recordWithPrefix(parsed, 'twitter:')

  const metadata: InspectedMetadata = {
    ...(canonical ? { canonical } : {}),
    ...(description ? { description } : {}),
    h1Count: parsed.h1Count,
    ...(parsed.language ? { language: parsed.language } : {}),
    openGraph,
    ...(robots ? { robots } : {}),
    schemaTypes: [...collectSchemaTypes(parsed.schemas)].sort(),
    ...(parsed.title ? { title: parsed.title } : {}),
    twitter
  }

  return { checks: metadataChecks(metadata, finalUrl), finalUrl, metadata }
}

const readLimited = async (response: Response, limit: number): Promise<Uint8Array> => {
  const declared = Number(response.headers.get('content-length'))

  if (Number.isFinite(declared) && declared > limit) {
    throw new Error(`Response exceeds the ${limit} byte limit.`)
  }

  if (!response.body) return new Uint8Array(await response.arrayBuffer())

  const reader: ReadableStreamDefaultReader<unknown> = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  let reading = true

  while (reading) {
    const { done, value } = await reader.read()

    if (done) {
      reading = false

      continue
    }

    if (!(value instanceof Uint8Array)) throw new Error('Response body returned a non-binary chunk.')

    length += value.byteLength

    if (length > limit) {
      await reader.cancel()

      throw new Error(`Response exceeds the ${limit} byte limit.`)
    }

    chunks.push(value)
  }

  const result = new Uint8Array(length)
  let offset = 0

  for (const chunk of chunks) {
    result.set(chunk, offset)

    offset += chunk.byteLength
  }

  return result
}

const uint24LittleEndian = (bytes: Uint8Array, offset: number): number => (
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)
)

const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10] as const

const imageDimensions = (bytes: Uint8Array, contentType: string): { height: number, width: number } | undefined => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (bytes.length >= 24 && bytes.slice(0, 8).every((value, index) => value === pngSignature[index])) {
    return { height: view.getUint32(20), width: view.getUint32(16) }
  }

  const signature = new TextDecoder().decode(bytes.slice(0, 12))

  if (bytes.length >= 10 && (signature.startsWith('GIF87a') || signature.startsWith('GIF89a'))) {
    return { height: view.getUint16(8, true), width: view.getUint16(6, true) }
  }

  if (bytes.length >= 30 && signature.startsWith('RIFF') && signature.slice(8) === 'WEBP') {
    const format = new TextDecoder().decode(bytes.slice(12, 16))

    if (format === 'VP8X') {
      return { height: uint24LittleEndian(bytes, 27) + 1, width: uint24LittleEndian(bytes, 24) + 1 }
    }

    if (format === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { height: view.getUint16(28, true) & 0x3fff, width: view.getUint16(26, true) & 0x3fff }
    }

    if (format === 'VP8L' && bytes[20] === 0x2f) {
      const first = bytes[21] ?? 0
      const second = bytes[22] ?? 0
      const third = bytes[23] ?? 0
      const fourth = bytes[24] ?? 0

      return {
        height: 1 + ((second >> 6) | (third << 2) | ((fourth & 0x0f) << 10)),
        width: 1 + first + ((second & 0x3f) << 8)
      }
    }
  }

  if ((contentType.includes('jpeg') || (bytes[0] === 0xff && bytes[1] === 0xd8)) && bytes.length >= 4) {
    let offset = 2

    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) break

      const marker = bytes[offset + 1] ?? 0
      const length = view.getUint16(offset + 2)

      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
      }

      if (length < 2) break

      offset += length + 2
    }
  }

  if (contentType.includes('svg')) {
    const source = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 65_536)))
    const tag = /<svg\b([^>]*)>/iu.exec(source)?.[1] ?? ''
    const values = attributes(tag)
    const width = Number.parseFloat(values.width ?? '')
    const height = Number.parseFloat(values.height ?? '')

    if (Number.isFinite(width) && Number.isFinite(height)) return { height, width }

    const viewBox = values.viewbox?.trim().split(/[\s,]+/u).map(Number)

    if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) {
      return { height: viewBox[3] ?? 0, width: viewBox[2] ?? 0 }
    }
  }

  return undefined
}

const fetchWithRedirects = async (
  input: URL,
  options: Required<Pick<InspectUrlOptions, 'fetcher' | 'maxRedirects'>> & Pick<InspectUrlOptions, 'authorizeUrl'>,
  signal: AbortSignal,
  accept = 'text/html,application/xhtml+xml'
): Promise<{ redirects: string[], response: Response, url: URL }> => {
  let url = input
  const redirects: string[] = []

  for (let index = 0; index <= options.maxRedirects; index += 1) {
    await options.authorizeUrl?.(url)

    const response = await options.fetcher(url, {
      headers: {
        accept,
        'user-agent': '@santi020k/og metadata inspector'
      },
      redirect: 'manual',
      signal
    })

    if (![301, 302, 303, 307, 308].includes(response.status)) return { redirects, response, url }

    const location = response.headers.get('location')

    if (!location) throw new Error(`Redirect from ${url.href} has no location header.`)

    if (index === options.maxRedirects) throw new Error(`More than ${options.maxRedirects} redirects.`)

    url = new URL(location, url)

    redirects.push(url.href)
  }

  throw new Error('Redirect limit exceeded.')
}

const inspectImage = async (
  imageUrl: string,
  baseUrl: string,
  options: Required<Pick<InspectUrlOptions, 'fetcher' | 'maxImageBytes' | 'maxRedirects'>> & Pick<InspectUrlOptions, 'authorizeUrl'>,
  signal: AbortSignal
): Promise<{ checks: InspectionCheck[], image: InspectedImage }> => {
  const resolved = new URL(imageUrl, baseUrl)

  const { response, url } = await fetchWithRedirects(
    resolved,
    options,
    signal,
    'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8,*/*;q=0.1'
  )

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()

  const image: InspectedImage = {
    ...(contentType ? { contentType } : {}),
    status: response.status,
    url: url.href
  }

  const checks: InspectionCheck[] = []

  if (!response.ok) {
    checks.push(check('error', 'image-response', 'Social image response', `Image returned HTTP ${response.status}.`))

    return { checks, image }
  }

  checks.push(check('pass', 'image-response', 'Social image response', `Image returned HTTP ${response.status}.`))

  if (!contentType?.startsWith('image/')) {
    checks.push(check('error', 'image-content-type', 'Image content type', contentType ?
      `Expected an image; received ${contentType}.` :
      'The response has no image content type.'))

    return { checks, image }
  }

  checks.push(check('pass', 'image-content-type', 'Image content type', contentType))

  const bytes = await readLimited(response, options.maxImageBytes)
  const dimensions = imageDimensions(bytes, contentType)
  const complete = { ...image, bytes: bytes.byteLength, ...dimensions }

  checks.push(dimensions?.width === 1200 && dimensions.height === 630 ?
    check('pass', 'image-dimensions', 'Image dimensions', 'The social image is 1200 × 630.') :
    check('warning', 'image-dimensions', 'Image dimensions', dimensions ?
      `The image is ${dimensions.width} × ${dimensions.height}; 1200 × 630 is recommended.` :
      'The image dimensions could not be determined.'))

  checks.push(bytes.byteLength <= 1_000_000 ?
    check('pass', 'image-size', 'Image file size', `${bytes.byteLength.toLocaleString('en-US')} bytes.`) :
    check('warning', 'image-size', 'Image file size', `${bytes.byteLength.toLocaleString('en-US')} bytes; aim for 1 MB or less.`))

  return { checks, image: complete }
}

const normalizeInputUrl = (input: string | URL): URL => {
  const source = input instanceof URL ? input.href : input.trim()
  const local = /^(?:localhost|127(?:\.\d+){3}|\[?::1\]?)(?::|\/|$)/iu.test(source)
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//iu.test(source) ? source : `${local ? 'http' : 'https'}://${source}`
  const url = new URL(withProtocol)

  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs can be inspected.')

  if (url.username || url.password) throw new Error('URLs containing credentials cannot be inspected.')

  return url
}

/** Fetch and inspect one public or localhost page without requiring a framework integration. */
export const inspectUrl = async (input: string | URL, options: InspectUrlOptions = {}): Promise<UrlInspection> => {
  const started = performance.now()
  const requestedUrl = normalizeInputUrl(input)
  const controller = new AbortController()

  const timeout = setTimeout(() => {
    controller.abort()
  }, options.timeoutMilliseconds ?? 10_000)

  const fetchOptions = {
    ...(options.authorizeUrl ? { authorizeUrl: options.authorizeUrl } : {}),
    fetcher: options.fetcher ?? ((resource, init) => fetch(resource, init)),
    maxHtmlBytes: options.maxHtmlBytes ?? 1_000_000,
    maxImageBytes: options.maxImageBytes ?? 8_000_000,
    maxRedirects: options.maxRedirects ?? 5
  }

  try {
    const { redirects, response, url } = await fetchWithRedirects(requestedUrl, fetchOptions, controller.signal)

    if (!response.ok) throw new Error(`${url.href} returned HTTP ${response.status}.`)

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''

    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error(`${url.href} returned ${contentType || 'an unknown content type'}, not HTML.`)
    }

    const html = new TextDecoder().decode(await readLimited(response, fetchOptions.maxHtmlBytes))
    const inspected = inspectHtml(html, url.href)
    const imageUrl = inspected.metadata.openGraph['og:image'] ?? inspected.metadata.twitter['twitter:image']
    let image: InspectedImage | undefined
    const checks = [...inspected.checks]

    if (imageUrl) {
      try {
        const imageResult = await inspectImage(imageUrl, url.href, fetchOptions, controller.signal)

        image = imageResult.image

        checks.push(...imageResult.checks)

        const declaredWidth = Number(inspected.metadata.openGraph['og:image:width'])
        const declaredHeight = Number(inspected.metadata.openGraph['og:image:height'])
        const declaredType = inspected.metadata.openGraph['og:image:type']

        if (image.width && image.height && Number.isFinite(declaredWidth) && Number.isFinite(declaredHeight)) {
          checks.push(image.width === declaredWidth && image.height === declaredHeight ?
            check('pass', 'image-declared-dimensions', 'Declared image dimensions', 'Declared and actual dimensions match.') :
            check('error', 'image-declared-dimensions', 'Declared image dimensions', `Metadata declares ${declaredWidth} × ${declaredHeight}, but the image is ${image.width} × ${image.height}.`))
        }

        if (declaredType && image.contentType) {
          checks.push(declaredType === image.contentType ?
            check('pass', 'image-declared-type', 'Declared image type', 'Declared and actual content types match.') :
            check('error', 'image-declared-type', 'Declared image type', `Metadata declares ${declaredType}, but the image returned ${image.contentType}.`))
        }
      } catch (error) {
        checks.push(check('error', 'image-fetch', 'Social image fetch', error instanceof Error ? error.message : String(error)))
      }
    }

    const summary = {
      error: checks.filter(item => item.status === 'error').length,
      pass: checks.filter(item => item.status === 'pass').length,
      warning: checks.filter(item => item.status === 'warning').length
    }

    return {
      checks,
      elapsedMilliseconds: Math.round(performance.now() - started),
      finalUrl: url.href,
      ...(image ? { image } : {}),
      metadata: inspected.metadata,
      redirects,
      requestedUrl: requestedUrl.href,
      responseStatus: response.status,
      score: scoreInspectionChecks(checks),
      summary
    }
  } finally {
    clearTimeout(timeout)
  }
}

const ipv4IsPrivate = (value: string): boolean => {
  const parts = value.split('.').map(Number)

  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false

  const [first = 0, second = 0, third = 0] = parts

  return first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && ((second === 0 && [0, 2].includes(third)) || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113)
}

const ipv6IsPrivate = (value: string): boolean => {
  if (!value.includes(':')) return false

  const sections = value.split('::')

  if (sections.length > 2) return true

  const left = sections[0]?.split(':').filter(Boolean) ?? []
  const right = sections[1]?.split(':').filter(Boolean) ?? []
  const missing = 8 - left.length - right.length

  if (missing < 0 || (sections.length === 1 && missing !== 0)) return true

  const expanded = [...left, ...Array.from({ length: missing }, () => '0'), ...right]

  if (expanded.length !== 8 || expanded.some(section => !/^[\da-f]{1,4}$/iu.test(section))) return true

  const numeric = expanded.reduce((result, section) => (result << 16n) | BigInt(`0x${section}`), 0n)
  const globalPrefix = numeric >> 125n
  const documentation = numeric >> 96n

  return globalPrefix !== 1n || documentation === 0x20010db8n
}

/** Reject obvious local hostnames and literal private addresses before applying DNS-aware policy. */
export const assertPublicInspectionUrl = (url: URL): void => {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are allowed.')

  if (url.username || url.password) throw new Error('URLs containing credentials are not allowed.')

  const hostname = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase()

  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
    hostname.endsWith('.internal') || hostname.endsWith('.home.arpa')) {
    throw new Error('Local and private hostnames can only be inspected with the CLI.')
  }

  if (ipv4IsPrivate(hostname) || ipv6IsPrivate(hostname)) {
    throw new Error('Private and reserved addresses can only be inspected with the CLI.')
  }
}
