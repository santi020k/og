import type { AuditedPage } from './audit.js'
import type { PageAlternateMetadata } from './metadata.js'

export interface LocaleRoute {
  /** BCP 47 language tag used by hreflang. */
  language: string
  /** URL path prefix. Use an empty string for an unprefixed default locale. */
  prefix?: string
}

export interface LocaleAlternatesOptions {
  /** Locale routes in deterministic output order. */
  locales: readonly LocaleRoute[]
  /** Locale used by x-default. Defaults to the first locale. */
  defaultLanguage?: string
  /** Include an x-default entry. Defaults to true. */
  includeXDefault?: boolean
  /** Resolve returned hrefs to absolute URLs when supplied. */
  siteUrl?: string | URL
}

const normalizePrefix = (value: string | undefined): string => value?.replace(/^\/+|\/+$/gu, '') ?? ''

const normalizePathname = (value: string): string => {
  const pathname = value.split(/[?#]/u)[0]?.replace(/^\/+/, '') ?? ''

  return pathname ? `/${pathname}` : '/'
}

const validateLocales = (options: LocaleAlternatesOptions): readonly Readonly<Required<LocaleRoute>>[] => {
  if (options.locales.length === 0) throw new Error('At least one locale route is required')

  const languages = new Set<string>()
  const prefixes = new Set<string>()

  return options.locales.map(locale => {
    const language = locale.language.trim()
    const prefix = normalizePrefix(locale.prefix)
    const normalizedLanguage = language.toLowerCase()

    if (!language) throw new Error('Locale language must not be empty')

    if (languages.has(normalizedLanguage)) throw new Error(`Duplicate locale language: ${language}`)

    if (prefixes.has(prefix)) throw new Error(`Duplicate locale prefix: ${prefix || '(empty)'}`)

    languages.add(normalizedLanguage)

    prefixes.add(prefix)

    return { language, prefix }
  })
}

const neutralPathname = (pathname: string, locales: readonly Readonly<Required<LocaleRoute>>[]): string => {
  const normalized = normalizePathname(pathname)

  const prefixed = [...locales]
    .filter(locale => locale.prefix)
    .sort((left, right) => right.prefix.length - left.prefix.length)
    .find(locale => normalized === `/${locale.prefix}` || normalized.startsWith(`/${locale.prefix}/`))

  if (!prefixed) return normalized

  const stripped = normalized.slice(prefixed.prefix.length + 1)

  return stripped ? normalizePathname(stripped) : '/'
}

const localizedPathname = (pathname: string, prefix: string): string => {
  const neutral = normalizePathname(pathname)

  if (!prefix) return neutral

  return neutral === '/' ? `/${prefix}/` : `/${prefix}${neutral}`
}

const href = (pathname: string, siteUrl: string | URL | undefined): string => (
  siteUrl ? new URL(pathname, siteUrl).href : pathname
)

/** Build portable hreflang alternates from a neutral or already-localized pathname. */
export const createLocaleAlternates = (
  pathname: string,
  options: LocaleAlternatesOptions
): PageAlternateMetadata[] => {
  const locales = validateLocales(options)
  const neutral = neutralPathname(pathname, locales)

  const alternates: PageAlternateMetadata[] = locales.map(locale => ({
    href: href(localizedPathname(neutral, locale.prefix), options.siteUrl),
    language: locale.language
  }))

  if (options.includeXDefault ?? true) {
    const configuredDefault = options.defaultLanguage?.toLowerCase()

    const defaultLocale = configuredDefault ?
      locales.find(locale => locale.language.toLowerCase() === configuredDefault) :
      locales[0]

    if (!defaultLocale) throw new Error(`Unknown default locale: ${options.defaultLanguage ?? '(not configured)'}`)

    alternates.push({
      href: href(localizedPathname(neutral, defaultLocale.prefix), options.siteUrl),
      language: 'x-default'
    })
  }

  return alternates
}

/** Create the expectedHrefs callback consumed by createAlternateLinksAuditRule. */
export const createLocaleAuditHrefs = (
  options: LocaleAlternatesOptions
): ((page: AuditedPage) => readonly string[]) => page => (
  createLocaleAlternates(page.route, options).map(alternate => alternate.href.toString())
)
