import { access, glob, readFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  AuditedPage,
  AuditIssue,
  AuditSeverity,
  AuditSiteRule
} from './audit.js'

export interface SitemapAuditRuleOptions {
  excludeRoutes?: readonly string[]
  filePatterns?: readonly string[]
  reportOrphans?: boolean
  severity?: AuditSeverity
}

export interface RobotsAuditRuleOptions {
  expectedSitemaps?: readonly string[]
  file?: string
  requiredDirectives?: readonly Readonly<{ name: string, value?: string }>[]
  requireSitemap?: boolean
  severity?: AuditSeverity
}

export interface AlternateLinksAuditRuleOptions {
  expectedHrefs?: (page: AuditedPage) => readonly string[]
  requireLinks?: boolean
  requireLocalTargets?: boolean
  requireXDefault?: boolean
  severity?: AuditSeverity
}

export interface RedirectsAuditRuleOptions {
  requireLocalTargets?: boolean
  severity?: AuditSeverity
}

export interface LlmsAuditRuleOptions {
  /** Compatibility copies that must exactly match the index file. */
  compatibilityFiles?: readonly string[]
  /** Full aggregated Markdown file. Set false to skip. Defaults to llms-full.txt. */
  fullFile?: false | string
  /** Compact link index. Defaults to llms.txt. */
  indexFile?: string
  /** Map an indexable page to its published Markdown path. Return undefined to skip a route. */
  markdownPath?: (page: AuditedPage) => string | undefined
  /** Require each Markdown page heading in the full file. */
  requireFullHeadings?: boolean
  /** Require each Markdown path in the compact index. */
  requireIndexLinks?: boolean
  severity?: AuditSeverity
}

export interface StandardAuditRulesOptions {
  alternates?: AlternateLinksAuditRuleOptions | false
  llms?: LlmsAuditRuleOptions | false
  redirects?: RedirectsAuditRuleOptions | false
  robots?: RobotsAuditRuleOptions | false
  sitemap?: SitemapAuditRuleOptions | false
}

export interface StandardAuditRules {
  siteRules: readonly AuditSiteRule[]
}

const normalizeRoute = (value: string): string => {
  const pathname = value.split(/[?#]/u)[0] ?? '/'

  if (pathname === '/') return pathname

  return pathname.endsWith('/') || path.posix.extname(pathname) ? pathname : `${pathname}/`
}

const issue = (
  file: string,
  route: string,
  code: string,
  message: string,
  severity: AuditSeverity
): AuditIssue => ({ code, file, message, route, severity })

const resolveUrl = (value: string, siteUrl: URL | undefined): URL => (
  new URL(value, siteUrl ?? 'https://audit.invalid/')
)

const isLocalUrl = (url: URL, siteUrl: URL | undefined): boolean => (
  siteUrl ? url.origin === siteUrl.origin : url.origin === 'https://audit.invalid'
)

const localRoutes = (pages: readonly AuditedPage[]): Set<string> => new Set(
  pages.map(page => normalizeRoute(page.route))
)

const decodeXml = (value: string): string => value
  .replaceAll('&amp;', '&')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', '\'')

const fileExists = async (file: string): Promise<boolean> => {
  try {
    await access(file)

    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false

    throw error
  }
}

const defaultMarkdownPath = (page: AuditedPage): string | undefined => {
  if (page.route === '/') return undefined

  return `${page.route.replace(/^\/+|\/+$/gu, '')}.md`
}

const safeSiteFile = (directory: string, configured: string): string => {
  const file = path.resolve(directory, configured)
  const relative = path.relative(directory, file)

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Audit file must stay inside the built site: ${configured}`)
  }

  return file
}

/** Verify llms.txt, compatibility copies, per-route Markdown, and an optional full aggregate. */
export const createLlmsAuditRule = (
  options: LlmsAuditRuleOptions = {}
): AuditSiteRule => async context => {
  const indexName = options.indexFile ?? 'llms.txt'
  const fullName = options.fullFile === false ? undefined : options.fullFile ?? 'llms-full.txt'
  const fullLabel = fullName ?? 'llms-full.txt'
  const indexFile = safeSiteFile(context.directory, indexName)
  const severity = options.severity ?? 'warning'

  if (!await fileExists(indexFile)) {
    return [issue(indexFile, '/', 'missing-llms-index', `Missing AI-readable index: ${indexName}`, severity)]
  }

  const index = await readFile(indexFile, 'utf8')
  const issues: AuditIssue[] = []
  const fullFile = fullName ? safeSiteFile(context.directory, fullName) : undefined
  const full = fullFile && await fileExists(fullFile) ? await readFile(fullFile, 'utf8') : undefined

  if (fullFile && full === undefined) {
    issues.push(issue(fullFile, '/', 'missing-llms-full', `Missing AI-readable aggregate: ${fullLabel}`, severity))
  }

  for (const compatibilityName of options.compatibilityFiles ?? []) {
    const compatibilityFile = safeSiteFile(context.directory, compatibilityName)

    if (!await fileExists(compatibilityFile)) {
      issues.push(issue(
        compatibilityFile,
        '/',
        'missing-llms-compatibility-file',
        `Missing AI-readable compatibility file: ${compatibilityName}`,
        severity
      ))
    } else if (await readFile(compatibilityFile, 'utf8') !== index) {
      issues.push(issue(
        compatibilityFile,
        '/',
        'llms-compatibility-mismatch',
        `${compatibilityName} must exactly match ${indexName}.`,
        severity
      ))
    }
  }

  const markdownPath = options.markdownPath ?? defaultMarkdownPath

  for (const page of context.pages.filter(candidate => candidate.indexable)) {
    const configuredPath = markdownPath(page)

    if (!configuredPath) continue

    const relativePath = configuredPath.replace(/^\/+/, '')
    const markdownFile = safeSiteFile(context.directory, relativePath)

    if (!await fileExists(markdownFile)) {
      issues.push(issue(page.file, page.route, 'missing-route-markdown', `Missing route Markdown: /${relativePath}`, severity))

      continue
    }

    if ((options.requireIndexLinks ?? true) && !index.includes(`/${relativePath}`)) {
      issues.push(issue(
        indexFile,
        page.route,
        'missing-llms-index-link',
        `${indexName} does not link to /${relativePath}.`,
        severity
      ))
    }

    if (full !== undefined && (options.requireFullHeadings ?? true)) {
      const markdown = await readFile(markdownFile, 'utf8')
      const heading = /^#\s+(.+)$/mu.exec(markdown)?.[1]?.trim()

      if (!heading) {
        issues.push(issue(markdownFile, page.route, 'missing-markdown-title', 'Route Markdown has no level-one heading.', severity))
      } else if (!full.includes(`# ${heading}\n`) && !full.endsWith(`# ${heading}`)) {
        issues.push(issue(
          fullFile ?? context.directory,
          page.route,
          'missing-llms-full-page',
          `${fullLabel} does not include the heading from /${relativePath}.`,
          severity
        ))
      }
    }
  }

  return issues
}

/** Verify that sitemap XML files cover the built site's indexable routes. */
export const createSitemapAuditRule = (
  options: SitemapAuditRuleOptions = {}
): AuditSiteRule => async context => {
  const patterns = options.filePatterns ?? ['sitemap*.xml', '**/sitemap*.xml']
  const files = new Set<string>()

  for (const pattern of patterns) {
    for await (const file of glob(pattern, { cwd: context.directory })) files.add(file)
  }

  const severity = options.severity ?? 'warning'

  if (files.size === 0) {
    return [issue(
      context.directory,
      '/',
      'missing-sitemap',
      'No sitemap XML file was found.',
      severity
    )]
  }

  const sitemapRoutes = new Set<string>()
  const issues: AuditIssue[] = []

  for (const relative of [...files].sort()) {
    const file = path.resolve(context.directory, relative)
    const contents = await readFile(file, 'utf8')

    for (const match of contents.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/giu)) {
      const value = decodeXml(match[1]?.trim() ?? '')

      try {
        const url = resolveUrl(value, context.siteUrl)

        if (url.pathname.endsWith('.xml') || !isLocalUrl(url, context.siteUrl)) continue

        sitemapRoutes.add(normalizeRoute(url.pathname))
      } catch {
        issues.push(issue(file, '/', 'invalid-sitemap-url', `Invalid sitemap URL: ${value}`, 'error'))
      }
    }
  }

  const excluded = new Set((options.excludeRoutes ?? []).map(normalizeRoute))
  const pages = context.pages.filter(page => page.indexable && !excluded.has(normalizeRoute(page.route)))

  for (const page of pages) {
    if (!sitemapRoutes.has(normalizeRoute(page.route))) {
      issues.push(issue(
        page.file,
        page.route,
        'missing-sitemap-route',
        'Indexable route is missing from the sitemap.',
        severity
      ))
    }
  }

  if (options.reportOrphans) {
    const routes = new Set(pages.map(page => normalizeRoute(page.route)))
    const sitemapFile = path.resolve(context.directory, [...files].sort()[0] ?? 'sitemap.xml')

    for (const route of sitemapRoutes) {
      if (!routes.has(route)) {
        issues.push(issue(
          sitemapFile,
          route,
          'orphan-sitemap-route',
          'Sitemap route has no built indexable HTML page.',
          severity
        ))
      }
    }
  }

  return issues
}

/** Verify that the built robots.txt is parseable and advertises a sitemap. */
export const createRobotsAuditRule = (
  options: RobotsAuditRuleOptions = {}
): AuditSiteRule => async context => {
  const file = path.resolve(context.directory, options.file ?? 'robots.txt')
  const severity = options.severity ?? 'error'
  let contents: string

  try {
    contents = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [issue(file, '/', 'missing-robots-file', 'Missing robots.txt file.', severity)]
    }

    throw error
  }

  const issues: AuditIssue[] = []

  const parsedDirectives = [...contents.matchAll(/^\s*([^#:\s]+)\s*:\s*(.*?)\s*$/gimu)].map(match => ({
    name: (match[1] ?? '').toLowerCase(),
    value: match[2] ?? ''
  }))

  if (!/^\s*user-agent\s*:/imu.test(contents)) {
    issues.push(issue(file, '/', 'missing-robots-user-agent', 'robots.txt has no User-agent directive.', severity))
  }

  for (const required of options.requiredDirectives ?? []) {
    const found = parsedDirectives.some(directive => directive.name === required.name.toLowerCase() &&
      (required.value === undefined || directive.value === required.value))

    if (!found) {
      const expected = required.value === undefined ? required.name : `${required.name}: ${required.value}`

      issues.push(issue(
        file,
        '/',
        'missing-robots-directive',
        `robots.txt is missing required directive: ${expected}`,
        severity
      ))
    }
  }

  if (options.requireSitemap ?? true) {
    const directives = [...contents.matchAll(/^\s*sitemap\s*:\s*(\S+)\s*$/gimu)]

    if (directives.length === 0) {
      issues.push(issue(file, '/', 'missing-robots-sitemap', 'robots.txt has no Sitemap directive.', severity))
    }

    for (const directive of directives) {
      const value = directive[1] ?? ''

      try {
        resolveUrl(value, context.siteUrl)
      } catch {
        issues.push(issue(file, '/', 'invalid-robots-sitemap', `Invalid Sitemap URL: ${value}`, 'error'))
      }
    }

    const sitemapUrls = new Set(directives.map(directive => {
      try {
        return resolveUrl(directive[1] ?? '', context.siteUrl).href
      } catch {
        return directive[1] ?? ''
      }
    }))

    for (const expected of options.expectedSitemaps ?? []) {
      const expectedUrl = resolveUrl(expected, context.siteUrl).href

      if (!sitemapUrls.has(expectedUrl)) {
        issues.push(issue(
          file,
          '/',
          'missing-robots-sitemap',
          `robots.txt is missing configured Sitemap: ${expectedUrl}`,
          severity
        ))
      }
    }
  }

  return issues
}

/** Verify hreflang alternates, uniqueness, and optional local target coverage. */
export const createAlternateLinksAuditRule = (
  options: AlternateLinksAuditRuleOptions = {}
): AuditSiteRule => context => {
  const issues: AuditIssue[] = []
  const routes = localRoutes(context.pages)
  const severity = options.severity ?? 'warning'

  for (const page of context.pages.filter(candidate => candidate.indexable)) {
    const alternateHrefs = new Set(page.alternates.map(alternate => {
      try {
        return resolveUrl(alternate.href, context.siteUrl).href
      } catch {
        return alternate.href
      }
    }))

    for (const expected of options.expectedHrefs?.(page) ?? []) {
      const expectedUrl = resolveUrl(expected, context.siteUrl).href

      if (!alternateHrefs.has(expectedUrl)) {
        issues.push(issue(
          page.file,
          page.route,
          'missing-configured-alternate',
          `Page is missing configured alternate: ${expectedUrl}`,
          severity
        ))
      }
    }

    if (page.alternates.length === 0) {
      if (options.requireLinks) {
        issues.push(issue(page.file, page.route, 'missing-alternate-links', 'Page has no hreflang links.', severity))
      }

      continue
    }

    const languages = new Set<string>()

    for (const alternate of page.alternates) {
      const language = alternate.language.toLowerCase()

      if (languages.has(language)) {
        issues.push(issue(
          page.file,
          page.route,
          'duplicate-alternate-language',
          `Duplicate hreflang value: ${alternate.language}`,
          'error'
        ))
      }

      languages.add(language)

      try {
        const url = resolveUrl(alternate.href, context.siteUrl)

        if ((options.requireLocalTargets ?? true) && isLocalUrl(url, context.siteUrl) &&
          !routes.has(normalizeRoute(url.pathname))) {
          issues.push(issue(
            page.file,
            page.route,
            'missing-alternate-target',
            `Alternate target has no built HTML page: ${url.pathname}`,
            severity
          ))
        }
      } catch {
        issues.push(issue(
          page.file,
          page.route,
          'invalid-alternate-url',
          `Invalid alternate URL: ${alternate.href}`,
          'error'
        ))
      }
    }

    if (options.requireXDefault && !languages.has('x-default')) {
      issues.push(issue(page.file, page.route, 'missing-x-default', 'Page has no x-default alternate.', severity))
    }
  }

  return issues
}

/** Verify redirect targets, detect loops, and optionally require local targets to exist. */
export const createRedirectsAuditRule = (
  options: RedirectsAuditRuleOptions = {}
): AuditSiteRule => context => {
  const issues: AuditIssue[] = []
  const routes = localRoutes(context.pages)
  const severity = options.severity ?? 'warning'

  for (const page of context.pages.filter(candidate => candidate.redirect)) {
    try {
      const url = resolveUrl(page.redirect ?? '', context.siteUrl)
      const target = normalizeRoute(url.pathname)

      if (isLocalUrl(url, context.siteUrl) && target === normalizeRoute(page.route)) {
        issues.push(issue(page.file, page.route, 'redirect-loop', 'Redirect points to its own route.', 'error'))
      } else if ((options.requireLocalTargets ?? true) && isLocalUrl(url, context.siteUrl) && !routes.has(target)) {
        issues.push(issue(
          page.file,
          page.route,
          'missing-redirect-target',
          `Redirect target has no built HTML page: ${url.pathname}`,
          severity
        ))
      }
    } catch {
      issues.push(issue(
        page.file,
        page.route,
        'invalid-redirect-url',
        `Invalid redirect URL: ${page.redirect ?? ''}`,
        'error'
      ))
    }
  }

  return issues
}

/** Opt into the standard sitemap, robots, alternate-link, redirect, and optional llms rule bundle. */
export const standardAuditRules = (
  options: StandardAuditRulesOptions = {}
): StandardAuditRules => ({
  siteRules: [
    ...(options.sitemap === false ? [] : [createSitemapAuditRule(options.sitemap)]),
    ...(options.robots === false ? [] : [createRobotsAuditRule(options.robots)]),
    ...(options.alternates === false ? [] : [createAlternateLinksAuditRule(options.alternates)]),
    ...(options.redirects === false ? [] : [createRedirectsAuditRule(options.redirects)]),
    ...(options.llms ? [createLlmsAuditRule(options.llms)] : [])
  ]
})
