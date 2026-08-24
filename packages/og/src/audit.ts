import { createHash } from 'node:crypto'
import { access, glob, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import type { OgRouteManifest } from './route-manifest.js'

export type AuditSeverity = 'error' | 'warning'

export interface AuditIssue {
  code: string
  file: string
  message: string
  route: string
  severity: AuditSeverity
}

export interface AuditedPage {
  alternates: readonly AuditedAlternateLink[]
  canonical?: string
  description?: string
  file: string
  image?: string
  indexable: boolean
  redirect?: string
  route: string
  schemaTypes: readonly string[]
  title?: string
}

export interface AuditedAlternateLink {
  href: string
  language: string
}

export interface AuditRuleContext {
  directory: string
  page: AuditedPage
  siteUrl?: URL
}

export type AuditRule = (context: AuditRuleContext) => readonly AuditIssue[] | Promise<readonly AuditIssue[]>

export interface AuditSiteRuleContext {
  directory: string
  pages: readonly AuditedPage[]
  siteUrl?: URL
}

export type AuditSiteRule = (
  context: AuditSiteRuleContext
) => readonly AuditIssue[] | Promise<readonly AuditIssue[]>

export interface SiteAuditOptions {
  directory: string
  exclude?: readonly string[]
  expectedHeight?: number
  expectedWidth?: number
  manifest?: OgRouteManifest | string
  maxImageBytes?: number
  requireUniqueImages?: boolean
  requireUniqueTitles?: boolean
  root?: string
  rules?: readonly AuditRule[]
  siteRules?: readonly AuditSiteRule[]
  siteUrl?: string | URL
}

export interface SiteAuditResult {
  directory: string
  errors: number
  issues: readonly AuditIssue[]
  pages: readonly AuditedPage[]
  passed: boolean
  warnings: number
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

const attributes = (source: string): Readonly<Record<string, string>> => {
  const values: Record<string, string> = {}

  for (const match of source.matchAll(attributePattern)) {
    const name = match[1]?.toLowerCase()

    if (name) values[name] = match[2] ?? match[3] ?? match[4] ?? ''
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

        if (!value || typeof value !== 'object') return []

        return [value]
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
    ...(title ? { title } : {})
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

const routeFromFile = (file: string, directory: string): string => {
  const relative = path.relative(directory, file).split(path.sep).join('/')

  if (relative === 'index.html') return '/'

  if (relative.endsWith('/index.html')) return `/${relative.slice(0, -'index.html'.length)}`

  return `/${relative}`
}

const normalizeRoute = (value: string): string => {
  const pathname = value.split(/[?#]/u)[0] ?? '/'

  if (pathname === '/') return pathname

  return pathname.endsWith('/') || path.posix.extname(pathname) ? pathname : `${pathname}/`
}

const meta = (parsed: ParsedHtml, key: string): string | undefined => parsed.metaTags.find(item => (
  item.name?.toLowerCase() === key || item.property?.toLowerCase() === key
))?.content

const redirect = (parsed: ParsedHtml): string | undefined => {
  const refresh = parsed.metaTags.find(item => item['http-equiv']?.toLowerCase() === 'refresh')?.content

  return /^\s*\d+\s*;\s*url=(.+)$/iu.exec(refresh ?? '')?.[1]?.trim()
}

const canonical = (parsed: ParsedHtml): string | undefined => parsed.links.find(item => (
  item.rel?.toLowerCase().split(/\s+/u).includes('canonical')
))?.href

const fileExists = async (file: string): Promise<boolean> => {
  try {
    await access(file)

    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false

    throw error
  }
}

const issue = (
  page: Pick<AuditedPage, 'file' | 'route'>,
  code: string,
  message: string,
  severity: AuditSeverity = 'error'
): AuditIssue => ({ code, file: page.file, message, route: page.route, severity })

const localImagePath = (
  image: string,
  directory: string,
  siteUrl: URL | undefined
): string | undefined => {
  try {
    const url = new URL(image, siteUrl)

    if (siteUrl && url.origin !== siteUrl.origin) return undefined

    return path.join(directory, decodeURIComponent(url.pathname).replace(/^\/+/, ''))
  } catch {
    return undefined
  }
}

const readRouteManifest = async (
  value: SiteAuditOptions['manifest'],
  root: string
): Promise<OgRouteManifest | undefined> => {
  if (!value) return undefined

  if (typeof value !== 'string') return value

  return JSON.parse(await readFile(path.resolve(root, value), 'utf8')) as OgRouteManifest
}

const requiredMetadata = (page: AuditedPage, parsed: ParsedHtml): AuditIssue[] => {
  if (page.redirect) return []

  const issues: AuditIssue[] = []
  const description = meta(parsed, 'description')
  const robots = meta(parsed, 'robots')

  if (!page.title) issues.push(issue(page, 'missing-title', 'Missing title element.'))

  if (!description) issues.push(issue(page, 'missing-description', 'Missing meta description.'))

  if (!robots) issues.push(issue(page, 'missing-robots', 'Missing robots metadata.'))

  if (parsed.h1Count !== 1) {
    issues.push(issue(page, 'invalid-h1-count', `Expected exactly one h1 element; found ${parsed.h1Count}.`))
  }

  if (!parsed.language) issues.push(issue(page, 'missing-html-language', 'Missing html lang attribute.'))

  if (!page.indexable) return issues

  const required = [
    ['canonical', page.canonical],
    ['og:type', meta(parsed, 'og:type')],
    ['og:title', meta(parsed, 'og:title')],
    ['og:description', meta(parsed, 'og:description')],
    ['og:url', meta(parsed, 'og:url')],
    ['og:image', page.image],
    ['og:image:width', meta(parsed, 'og:image:width')],
    ['og:image:height', meta(parsed, 'og:image:height')],
    ['og:image:alt', meta(parsed, 'og:image:alt')],
    ['twitter:card', meta(parsed, 'twitter:card')],
    ['twitter:url', meta(parsed, 'twitter:url')],
    ['twitter:title', meta(parsed, 'twitter:title')],
    ['twitter:description', meta(parsed, 'twitter:description')],
    ['twitter:image', meta(parsed, 'twitter:image')],
    ['twitter:image:alt', meta(parsed, 'twitter:image:alt')]
  ] as const

  for (const [name, value] of required) {
    if (!value) issues.push(issue(page, `missing-${name.replaceAll(':', '-')}`, `Missing ${name} metadata.`))
  }

  if (parsed.schemas.length === 0) {
    issues.push(issue(page, 'missing-json-ld', 'Missing valid JSON-LD structured data.', 'warning'))
  }

  return issues
}

/** Audit built HTML, local social images, canonical consistency, and route-manifest coverage. */
export const auditSite = async (options: SiteAuditOptions): Promise<SiteAuditResult> => {
  const root = path.resolve(options.root ?? process.cwd())
  const directory = path.resolve(root, options.directory)
  const siteUrl = options.siteUrl ? new URL(options.siteUrl) : undefined
  const files: string[] = []

  for await (const file of glob('**/*.html', { cwd: directory, exclude: options.exclude ?? [] })) {
    files.push(path.resolve(directory, file))
  }

  files.sort()

  const pages: AuditedPage[] = []
  const issues: AuditIssue[] = []

  for (const file of files) {
    const parsed = parseHtml(await readFile(file, 'utf8'))
    const route = routeFromFile(file, directory)
    const robots = meta(parsed, 'robots')?.toLowerCase()
    const pageCanonical = canonical(parsed)
    const pageDescription = meta(parsed, 'description')
    const pageImage = meta(parsed, 'og:image')
    const pageRedirect = redirect(parsed)

    const alternates = parsed.links.flatMap(link => {
      const relationships = link.rel?.toLowerCase().split(/\s+/u) ?? []

      return relationships.includes('alternate') && link.href && link.hreflang ?
        [{
          href: link.href,
          language: link.hreflang
        }] :
        []
    })

    const page: AuditedPage = {
      alternates,
      ...(pageCanonical ? { canonical: pageCanonical } : {}),
      ...(pageDescription ? { description: pageDescription } : {}),
      file,
      ...(pageImage ? { image: pageImage } : {}),
      indexable: !pageRedirect && !robots?.split(',').map(value => value.trim()).includes('noindex'),
      ...(pageRedirect ? { redirect: pageRedirect } : {}),
      route,
      schemaTypes: [...collectSchemaTypes(parsed.schemas)].sort(),
      ...(parsed.title ? { title: parsed.title } : {})
    }

    pages.push(page)

    issues.push(...requiredMetadata(page, parsed))

    if (page.indexable && page.canonical) {
      try {
        const canonicalUrl = new URL(page.canonical, siteUrl)
        const canonicalRoute = normalizeRoute(canonicalUrl.pathname)

        if ((!siteUrl || canonicalUrl.origin === siteUrl.origin) && canonicalRoute !== normalizeRoute(route)) {
          issues.push(issue(page, 'canonical-route-mismatch', `Canonical path ${canonicalRoute} does not match ${route}.`))
        }
      } catch {
        issues.push(issue(page, 'invalid-canonical', `Canonical URL is invalid: ${page.canonical}`))
      }
    }

    if (page.indexable && page.image) {
      const imagePath = localImagePath(page.image, directory, siteUrl)

      if (imagePath && !await fileExists(imagePath)) {
        issues.push(issue(page, 'missing-image-file', `Social image does not exist: ${imagePath}`))
      } else if (imagePath) {
        const details = await sharp(imagePath).metadata()
        const imageStats = await stat(imagePath)
        const expectedWidth = options.expectedWidth ?? 1200
        const expectedHeight = options.expectedHeight ?? 630
        const declaredWidth = Number(meta(parsed, 'og:image:width'))
        const declaredHeight = Number(meta(parsed, 'og:image:height'))
        const declaredType = meta(parsed, 'og:image:type')
        let actualType = `image/${details.format}`

        if (details.format === 'svg') actualType = 'image/svg+xml'

        if (details.width !== expectedWidth || details.height !== expectedHeight) {
          issues.push(issue(
            page,
            'invalid-image-dimensions',
            `Social image is ${details.width}x${details.height}; expected ${expectedWidth}x${expectedHeight}.`
          ))
        }

        if (declaredWidth !== details.width || declaredHeight !== details.height) {
          issues.push(issue(
            page,
            'image-metadata-dimensions-mismatch',
            `Declared image dimensions ${declaredWidth}x${declaredHeight} do not match ${details.width}x${details.height}.`
          ))
        }

        if (declaredType && declaredType !== actualType) {
          issues.push(issue(
            page,
            'image-metadata-type-mismatch',
            `Declared image type ${declaredType} does not match ${actualType}.`
          ))
        }

        if (options.maxImageBytes !== undefined && imageStats.size > options.maxImageBytes) {
          issues.push(issue(
            page,
            'image-too-large',
            `Social image is ${imageStats.size} bytes; maximum is ${options.maxImageBytes}.`
          ))
        }
      }
    }

    for (const rule of options.rules ?? []) {
      issues.push(...await rule({ directory, page, ...(siteUrl ? { siteUrl } : {}) }))
    }
  }

  const duplicateIssues = (
    field: 'image' | 'title',
    enabled: boolean,
    code: string
  ): void => {
    if (!enabled) return

    const values = new Map<string, AuditedPage[]>()

    for (const page of pages.filter(candidate => candidate.indexable)) {
      const value = page[field]

      if (value) values.set(value, [...values.get(value) ?? [], page])
    }

    for (const [value, duplicates] of values) {
      if (duplicates.length < 2) continue

      for (const page of duplicates) {
        issues.push(issue(page, code, `Duplicate ${field} across ${duplicates.length} routes: ${value}`, 'warning'))
      }
    }
  }

  duplicateIssues('title', options.requireUniqueTitles ?? true, 'duplicate-title')

  if (options.requireUniqueImages) {
    const digests = new Map<string, AuditedPage>()

    for (const page of pages.filter(candidate => candidate.indexable && candidate.image)) {
      const imagePath = localImagePath(page.image ?? '', directory, siteUrl)

      if (!imagePath || !await fileExists(imagePath)) continue

      const digest = createHash('sha256').update(await readFile(imagePath)).digest('hex')
      const duplicate = digests.get(digest)

      if (duplicate) {
        issues.push(issue(page, 'duplicate-image', `Social image duplicates ${duplicate.route}.`))
      } else {
        digests.set(digest, page)
      }
    }
  }

  const manifest = await readRouteManifest(options.manifest, root)

  if (manifest) {
    const manifestRoutes = new Set(Object.keys(manifest.routes).map(normalizeRoute))
    const pageRoutes = new Set(pages.filter(page => page.indexable).map(page => normalizeRoute(page.route)))

    for (const page of pages.filter(candidate => candidate.indexable)) {
      if (!manifestRoutes.has(normalizeRoute(page.route))) {
        issues.push(issue(page, 'missing-route-card', 'Indexable route is missing from the OG route manifest.'))
      }
    }

    for (const route of manifestRoutes) {
      if (!pageRoutes.has(route)) {
        issues.push({
          code: 'orphan-route-card',
          file: typeof options.manifest === 'string' ? path.resolve(root, options.manifest) : '(manifest)',
          message: 'Manifest route has no built indexable HTML page.',
          route,
          severity: 'warning'
        })
      }
    }

    for (const page of pages.filter(candidate => candidate.indexable)) {
      const manifestRoute = Object.values(manifest.routes).find(candidate => (
        normalizeRoute(candidate.pathname) === normalizeRoute(page.route)
      ))

      for (const type of manifestRoute?.schemaTypes ?? []) {
        if (!page.schemaTypes.includes(type)) {
          issues.push(issue(page, 'missing-schema-type', `JSON-LD is missing required @type ${type}.`))
        }
      }

      const manifestImage = manifestRoute?.images.find(image => image.primary && image.url)?.url

      if (manifestImage && page.image && siteUrl) {
        const expectedImage = new URL(manifestImage, siteUrl).href

        if (page.image !== expectedImage) {
          issues.push(issue(
            page,
            'route-card-image-mismatch',
            `Page social image ${page.image} does not match route manifest image ${expectedImage}.`
          ))
        }
      }
    }
  }

  for (const rule of options.siteRules ?? []) {
    issues.push(...await rule({ directory, pages, ...(siteUrl ? { siteUrl } : {}) }))
  }

  const errors = issues.filter(item => item.severity === 'error').length
  const warnings = issues.length - errors

  return { directory, errors, issues, pages, passed: errors === 0, warnings }
}

export interface SarifLog {
  $schema: string
  runs: readonly unknown[]
  version: '2.1.0'
}

/** Convert audit findings to SARIF for GitHub code scanning and other CI consumers. */
export const auditToSarif = (result: SiteAuditResult): SarifLog => ({
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
  runs: [{
    results: result.issues.map(item => ({
      level: item.severity,
      locations: [{ physicalLocation: { artifactLocation: { uri: item.file } } }],
      message: { text: `${item.route}: ${item.message}` },
      ruleId: item.code
    })),
    tool: {
      driver: {
        name: '@santi020k/og',
        rules: [...new Set(result.issues.map(item => item.code))].map(id => ({ id }))
      }
    }
  }],
  version: '2.1.0'
})
