import path from 'node:path'

import { type PathCardOptions, pathnameOutput } from './composition.js'
import type { OgCard, OgSourceCollection } from './types.js'

export type PageOpenGraphType = 'article' | 'profile' | 'website'
export type TwitterCardType = 'summary' | 'summary_large_image'

export interface PageArticleMetadata {
  authors?: readonly string[]
  modifiedTime?: Date | string
  publishedTime?: Date | string
  section?: string
  tags?: readonly string[]
}

export interface PageImageMetadata {
  /** Accessible description of the social image. */
  alt: string
  /** Generated path relative to the configured Open Graph output directory. */
  output?: string
  /** Public image URL. Derived from output and publicImagePath when omitted. */
  url?: string | URL
  height?: number
  type?: string
  width?: number
}

export interface PageRobotsMetadata {
  follow?: boolean
  index?: boolean
  maxImagePreview?: 'large' | 'none' | 'standard'
  maxSnippet?: number
  maxVideoPreview?: number
}

export interface PageTwitterMetadata {
  card?: TwitterCardType
  creator?: string
  site?: string
}

/** Portable page information shared by HTML metadata and social-card generation. */
export interface PageMetadata {
  article?: PageArticleMetadata
  authors?: readonly string[]
  canonical?: string | URL
  description: string
  image?: PageImageMetadata
  keywords?: readonly string[]
  locale?: string
  alternateLocales?: readonly string[]
  pathname: string
  robots?: PageRobotsMetadata
  /** JSON-LD @type values that the built page audit should require. */
  schemaTypes?: readonly string[]
  title: string
  twitter?: PageTwitterMetadata
  type?: PageOpenGraphType
}

export interface SiteMetadataOptions {
  defaultImage?: PageImageMetadata
  locale?: string
  publicImagePath?: string
  siteName?: string
  siteUrl: string | URL
  titleTemplate?: string
  twitter?: PageTwitterMetadata
}

export interface ResolvedPageImageMetadata {
  alt: string
  height: number
  type?: string
  url: string
  width: number
}

export interface ResolvedPageMetadata {
  alternateLocales: readonly string[]
  article?: PageArticleMetadata
  authors: readonly string[]
  canonical: string
  description: string
  image?: ResolvedPageImageMetadata
  keywords: readonly string[]
  locale: string
  robots: Required<PageRobotsMetadata>
  siteName?: string
  siteUrl: string
  title: string
  twitter: Required<Pick<PageTwitterMetadata, 'card'>> & Omit<PageTwitterMetadata, 'card'>
  type: PageOpenGraphType
}

export interface MetadataTitleTag {
  content: string
  tag: 'title'
}

export interface MetadataLinkTag {
  href: string
  rel: 'canonical'
  tag: 'link'
}

export interface MetadataMetaTag {
  content: string
  name?: string
  property?: string
  tag: 'meta'
}

export type MetadataTag = MetadataLinkTag | MetadataMetaTag | MetadataTitleTag

export interface PageCardData {
  description: string
  title: string
}

export interface PageCardOptions<T> extends PathCardOptions {
  aliases?: OgCard<T>['aliases']
  data?: (page: PageMetadata) => T
  height?: number
  output?: string
  outputDirectory?: string
  sources?: OgSourceCollection
  width?: number
}

const imageTypes: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

const assertText = (value: string, field: string): void => {
  if (value.trim().length === 0) throw new Error(`${field} must not be empty`)
}

const absoluteHttpUrl = (value: string | URL, field: string): URL => {
  const url = value instanceof URL ? new URL(value) : new URL(value)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${field} must use http or https: ${url.href}`)
  }

  return url
}

const absoluteUrl = (value: string | URL, base: URL, field: string): URL => {
  const url = value instanceof URL ? new URL(value) : new URL(value, base)

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${field} must use http or https: ${url.href}`)
  }

  return url
}

const positiveDimension = (value: number | undefined, fallback: number, field: string): number => {
  const dimension = value ?? fallback

  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error(`${field} must be a positive integer`)
  }

  return dimension
}

const formatDate = (value: Date | string, field: string): string => {
  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.valueOf())) throw new Error(`${field} must be a valid date`)

  return date.toISOString()
}

const applyTitleTemplate = (title: string, template: string | undefined): string => {
  if (!template) return title

  if (!template.includes('%s')) throw new Error('titleTemplate must include %s')

  return template.replaceAll('%s', title)
}

const publicImageUrl = (
  image: PageImageMetadata,
  page: PageMetadata,
  options: SiteMetadataOptions,
  siteUrl: URL
): URL => {
  if (image.url) return absoluteUrl(image.url, siteUrl, 'image.url')

  const output = image.output ?? pathnameOutput(page.pathname)
  const publicPath = options.publicImagePath?.replace(/^\/+|\/+$/gu, '') ?? 'og'

  return new URL(`/${[publicPath, output].filter(Boolean).join('/')}`, siteUrl)
}

const resolveImage = (
  page: PageMetadata,
  options: SiteMetadataOptions,
  siteUrl: URL
): ResolvedPageImageMetadata | undefined => {
  const image = page.image ?? options.defaultImage

  if (!image) return undefined

  assertText(image.alt, 'image.alt')

  const url = publicImageUrl(image, page, options, siteUrl)
  const type = image.type ?? imageTypes[path.extname(url.pathname).toLowerCase()]

  return {
    alt: image.alt,
    height: positiveDimension(image.height, 630, 'image.height'),
    ...(type ? { type } : {}),
    url: url.href,
    width: positiveDimension(image.width, 1200, 'image.width')
  }
}

/** Preserve type inference while validating a reusable page definition. */
export const definePageMetadata = <T extends PageMetadata>(page: T): T => {
  assertText(page.pathname, 'pathname')

  assertText(page.title, 'title')

  assertText(page.description, 'description')

  if (page.image) assertText(page.image.alt, 'image.alt')

  return page
}

/** Resolve URLs, defaults, image details, and title composition for a page. */
export const resolvePageMetadata = (
  page: PageMetadata,
  options: SiteMetadataOptions
): ResolvedPageMetadata => {
  definePageMetadata(page)

  const siteUrl = absoluteHttpUrl(options.siteUrl, 'siteUrl')
  const canonical = absoluteUrl(page.canonical ?? page.pathname, siteUrl, 'canonical')
  const type = page.type ?? (page.article ? 'article' : 'website')
  const twitter = { ...options.twitter, ...page.twitter }
  const image = resolveImage(page, options, siteUrl)

  canonical.hash = ''

  if (page.article && type !== 'article') {
    throw new Error('article metadata requires the Open Graph article type')
  }

  if (twitter.creator) assertText(twitter.creator, 'twitter.creator')

  if (twitter.site) assertText(twitter.site, 'twitter.site')

  return {
    alternateLocales: page.alternateLocales ?? [],
    ...(page.article ? { article: page.article } : {}),
    authors: page.authors ?? page.article?.authors ?? [],
    canonical: canonical.href,
    description: page.description,
    ...(image ? { image } : {}),
    keywords: page.keywords ?? [],
    locale: page.locale ?? options.locale ?? 'en_US',
    robots: {
      follow: page.robots?.follow ?? true,
      index: page.robots?.index ?? true,
      maxImagePreview: page.robots?.maxImagePreview ?? 'large',
      maxSnippet: page.robots?.maxSnippet ?? -1,
      maxVideoPreview: page.robots?.maxVideoPreview ?? -1
    },
    ...(options.siteName ? { siteName: options.siteName } : {}),
    siteUrl: siteUrl.href,
    title: applyTitleTemplate(page.title, options.titleTemplate),
    twitter: {
      card: twitter.card ?? (image ? 'summary_large_image' : 'summary'),
      ...(twitter.creator ? { creator: twitter.creator } : {}),
      ...(twitter.site ? { site: twitter.site } : {})
    },
    type
  }
}

const robotsContent = (robots: Required<PageRobotsMetadata>): string => [
  robots.index ? 'index' : 'noindex',
  robots.follow ? 'follow' : 'nofollow',
  `max-image-preview:${robots.maxImagePreview}`,
  `max-snippet:${robots.maxSnippet}`,
  `max-video-preview:${robots.maxVideoPreview}`
].join(', ')

const metaName = (name: string, content: string): MetadataMetaTag => ({ content, name, tag: 'meta' })
const metaProperty = (property: string, content: string): MetadataMetaTag => ({ content, property, tag: 'meta' })

/** Create stable, renderer-neutral descriptors for HTML metadata. */
export const createMetaTags = (
  page: PageMetadata,
  options: SiteMetadataOptions
): MetadataTag[] => {
  const metadata = resolvePageMetadata(page, options)

  const tags: MetadataTag[] = [
    { content: metadata.title, tag: 'title' },
    metaName('description', metadata.description),
    { href: metadata.canonical, rel: 'canonical', tag: 'link' },
    metaName('robots', robotsContent(metadata.robots))
  ]

  for (const author of metadata.authors) tags.push(metaName('author', author))

  if (metadata.keywords.length > 0) tags.push(metaName('keywords', metadata.keywords.join(', ')))

  tags.push(
    metaProperty('og:type', metadata.type),
    metaProperty('og:title', metadata.title),
    metaProperty('og:description', metadata.description),
    metaProperty('og:url', metadata.canonical),
    metaProperty('og:locale', metadata.locale)
  )

  if (metadata.siteName) tags.push(metaProperty('og:site_name', metadata.siteName))

  for (const locale of metadata.alternateLocales) tags.push(metaProperty('og:locale:alternate', locale))

  if (metadata.image) {
    tags.push(
      metaProperty('og:image', metadata.image.url),
      metaProperty('og:image:width', String(metadata.image.width)),
      metaProperty('og:image:height', String(metadata.image.height)),
      metaProperty('og:image:alt', metadata.image.alt)
    )

    if (metadata.image.url.startsWith('https://')) {
      tags.push(metaProperty('og:image:secure_url', metadata.image.url))
    }

    if (metadata.image.type) tags.push(metaProperty('og:image:type', metadata.image.type))
  }

  if (metadata.article) {
    if (metadata.article.publishedTime) {
      tags.push(metaProperty(
        'article:published_time',
        formatDate(metadata.article.publishedTime, 'article.publishedTime')
      ))
    }

    if (metadata.article.modifiedTime) {
      tags.push(metaProperty(
        'article:modified_time',
        formatDate(metadata.article.modifiedTime, 'article.modifiedTime')
      ))
    }

    if (metadata.article.section) tags.push(metaProperty('article:section', metadata.article.section))

    for (const author of metadata.article.authors ?? []) tags.push(metaProperty('article:author', author))

    for (const tag of metadata.article.tags ?? []) tags.push(metaProperty('article:tag', tag))
  }

  tags.push(
    metaName('twitter:card', metadata.twitter.card),
    metaName('twitter:url', metadata.canonical),
    metaName('twitter:title', metadata.title),
    metaName('twitter:description', metadata.description)
  )

  if (metadata.twitter.site) tags.push(metaName('twitter:site', metadata.twitter.site))

  if (metadata.twitter.creator) tags.push(metaName('twitter:creator', metadata.twitter.creator))

  if (metadata.image) {
    tags.push(
      metaName('twitter:image', metadata.image.url),
      metaName('twitter:image:alt', metadata.image.alt)
    )
  }

  return tags
}

export function createPageCard(page: PageMetadata, options?: PageCardOptions<PageCardData>): OgCard<PageCardData>
export function createPageCard<T>(
  page: PageMetadata,
  options: PageCardOptions<T> & { data: (page: PageMetadata) => T }
): OgCard<T>
export function createPageCard<T>(
  page: PageMetadata,
  options: PageCardOptions<T | PageCardData> = {}
): OgCard<T | PageCardData> {
  definePageMetadata(page)

  const data = options.data ?
    options.data(page) :
    { description: page.description, title: page.title }

  const height = options.height ?? page.image?.height
  const width = options.width ?? page.image?.width

  return {
    data,
    output: options.output ?? page.image?.output ?? pathnameOutput(page.pathname, options),
    ...(options.aliases ? { aliases: options.aliases } : {}),
    ...(height === undefined ? {} : { height }),
    ...(options.outputDirectory ? { outputDirectory: options.outputDirectory } : {}),
    route: {
      ...(page.image?.alt ? { alt: page.image.alt } : {}),
      description: page.description,
      pathname: page.pathname.split(/[?#]/u)[0] || '/',
      ...(page.schemaTypes?.length ? { schemaTypes: page.schemaTypes } : {}),
      title: page.title
    },
    ...(options.sources ? { sources: options.sources } : {}),
    ...(width === undefined ? {} : { width })
  }
}
