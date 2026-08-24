import {
  type PageMetadata,
  type PageOpenGraphType,
  resolvePageMetadata,
  type SiteMetadataOptions,
  type TwitterCardType
} from './metadata.js'

export interface NextImageMetadata {
  alt: string
  height: number
  secureUrl?: string
  type?: string
  url: string
  width: number
}

interface NextOpenGraphBaseMetadata {
  alternateLocale?: string[]
  description: string
  images?: NextImageMetadata[]
  locale: string
  siteName?: string
  title: string
  url: string
}

export type NextOpenGraphMetadata = NextOpenGraphBaseMetadata & (
  | {
    authors?: string[]
    modifiedTime?: string
    publishedTime?: string
    section?: string
    tags?: string[]
    type: 'article'
  } |
  { type: Exclude<PageOpenGraphType, 'article'> }
)

export interface NextTwitterMetadata {
  card: TwitterCardType
  creator?: string
  description: string
  images?: NextImageMetadata[]
  site?: string
  title: string
}

export interface NextCompatibleMetadata {
  alternates: { canonical: string, languages?: Readonly<Record<string, string>> }
  authors?: { name: string }[]
  description: string
  keywords?: string[]
  metadataBase: URL
  openGraph: NextOpenGraphMetadata
  robots: NextRobotsMetadata
  title: string
  twitter: NextTwitterMetadata
}

export interface NextRobotsMetadata {
  follow: boolean
  index: boolean
  'max-image-preview': 'large' | 'none' | 'standard'
  'max-snippet': number
  'max-video-preview': number
}

const formattedDate = (value: Date | string | undefined): string | undefined => {
  if (!value) return undefined

  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.valueOf())) throw new Error('Article metadata contains an invalid date')

  return date.toISOString()
}

/** Convert a portable page definition to the shape accepted by the Next.js Metadata API. */
export const toNextMetadata = (
  page: PageMetadata,
  options: SiteMetadataOptions
): NextCompatibleMetadata => {
  const metadata = resolvePageMetadata(page, options)

  const images: NextImageMetadata[] | undefined = metadata.image ?
    [{
      ...metadata.image,
      ...(metadata.image.url.startsWith('https://') ? { secureUrl: metadata.image.url } : {})
    }] :
    undefined

  const publishedTime = formattedDate(metadata.article?.publishedTime)
  const modifiedTime = formattedDate(metadata.article?.modifiedTime)

  const openGraphBase: NextOpenGraphBaseMetadata = {
    ...(metadata.alternateLocales.length > 0 ? { alternateLocale: [...metadata.alternateLocales] } : {}),
    description: metadata.description,
    ...(images ? { images } : {}),
    locale: metadata.locale,
    ...(metadata.siteName ? { siteName: metadata.siteName } : {}),
    title: metadata.title,
    url: metadata.canonical
  }

  const openGraph: NextOpenGraphMetadata = metadata.type === 'article' ?
    {
      ...openGraphBase,
      ...(metadata.article?.authors ? { authors: [...metadata.article.authors] } : {}),
      ...(modifiedTime ? { modifiedTime } : {}),
      ...(publishedTime ? { publishedTime } : {}),
      ...(metadata.article?.section ? { section: metadata.article.section } : {}),
      ...(metadata.article?.tags ? { tags: [...metadata.article.tags] } : {}),
      type: 'article'
    } :
    {
      ...openGraphBase,
      type: metadata.type
    }

  return {
    alternates: {
      canonical: metadata.canonical,
      ...(metadata.alternates.length > 0 ?
        {
          languages: Object.fromEntries(metadata.alternates.map(alternate => [alternate.language, alternate.href]))
        } :
        {})
    },
    ...(metadata.authors.length > 0 ? { authors: metadata.authors.map(name => ({ name })) } : {}),
    description: metadata.description,
    ...(metadata.keywords.length > 0 ? { keywords: [...metadata.keywords] } : {}),
    metadataBase: new URL(metadata.siteUrl),
    openGraph,
    robots: {
      follow: metadata.robots.follow,
      index: metadata.robots.index,
      'max-image-preview': metadata.robots.maxImagePreview,
      'max-snippet': metadata.robots.maxSnippet,
      'max-video-preview': metadata.robots.maxVideoPreview
    },
    title: metadata.title,
    twitter: {
      card: metadata.twitter.card,
      ...(metadata.twitter.creator ? { creator: metadata.twitter.creator } : {}),
      description: metadata.description,
      ...(images ? { images } : {}),
      ...(metadata.twitter.site ? { site: metadata.twitter.site } : {}),
      title: metadata.title
    }
  }
}
