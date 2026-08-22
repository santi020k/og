import { describe, expect, it } from 'vitest'

import {
  createMetaTags,
  createPageCard,
  definePageMetadata,
  type PageMetadata,
  resolvePageMetadata,
  type SiteMetadataOptions
} from '../src/metadata.js'
import { renderMetaTags } from '../src/metadata-html.js'
import { toNextMetadata } from '../src/metadata-next.js'

const site: SiteMetadataOptions = {
  locale: 'en_GB',
  publicImagePath: '/social/',
  siteName: 'Example',
  siteUrl: 'https://example.com/base/',
  titleTemplate: '%s — Example',
  twitter: { site: '@example' }
}

const article = definePageMetadata({
  alternateLocales: ['es_ES'],
  article: {
    authors: ['Ada Lovelace'],
    modifiedTime: '2026-08-22T12:00:00-05:00',
    publishedTime: new Date('2026-08-20T14:00:00Z'),
    section: 'Engineering',
    tags: ['metadata', 'open graph']
  },
  description: 'One definition for the image and every social metadata format.',
  image: {
    alt: 'A diagram showing one page definition feeding several metadata formats',
    height: 630,
    output: 'articles/portable.webp',
    width: 1200
  },
  keywords: ['open graph', 'metadata'],
  pathname: '/articles/portable?ref=canonical#overview',
  title: 'Portable metadata',
  twitter: { creator: '@author' }
})

describe('portable metadata', () => {
  it('resolves canonical and image URLs with safe defaults', () => {
    const metadata = resolvePageMetadata(article, site)

    expect(metadata).toMatchObject({
      canonical: 'https://example.com/articles/portable?ref=canonical',
      image: {
        height: 630,
        type: 'image/webp',
        url: 'https://example.com/social/articles/portable.webp',
        width: 1200
      },
      locale: 'en_GB',
      siteName: 'Example',
      title: 'Portable metadata — Example',
      twitter: {
        card: 'summary_large_image',
        creator: '@author',
        site: '@example'
      },
      type: 'article'
    })

    expect(metadata.robots).toEqual({
      follow: true,
      index: true,
      maxImagePreview: 'large',
      maxSnippet: -1,
      maxVideoPreview: -1
    })
  })

  it('creates complete Open Graph, article, and X metadata descriptors', () => {
    const tags = createMetaTags(article, site)

    expect(tags).toContainEqual({
      content: 'https://example.com/social/articles/portable.webp',
      property: 'og:image:secure_url',
      tag: 'meta'
    })

    expect(tags).toContainEqual({
      content: '2026-08-20T14:00:00.000Z',
      property: 'article:published_time',
      tag: 'meta'
    })

    expect(tags).toContainEqual({ content: '@author', name: 'twitter:creator', tag: 'meta' })

    expect(tags).toContainEqual({ content: 'es_ES', property: 'og:locale:alternate', tag: 'meta' })
  })

  it('renders escaped HTML for framework-free templates', () => {
    const page = definePageMetadata({
      description: 'Design & build <safely>',
      image: { alt: 'A "safe" card', output: 'safe.png' },
      pathname: '/safe',
      title: 'Docs <Guide>'
    })

    const html = renderMetaTags(createMetaTags(page, {
      siteUrl: 'https://example.com'
    }))

    expect(html).toContain('<title>Docs &lt;Guide&gt;</title>')

    expect(html).toContain('content="Design &amp; build &lt;safely&gt;"')

    expect(html).toContain('content="A &quot;safe&quot; card"')
  })

  it('creates a card from the same definition with explicit renderer mapping', () => {
    const card = createPageCard(article, {
      data: page => ({
        badge: 'Guide',
        description: page.description,
        title: page.title,
        variant: 'docs' as const
      }),
      sources: ['content/article.md']
    })

    expect(card).toEqual({
      data: {
        badge: 'Guide',
        description: article.description,
        title: article.title,
        variant: 'docs'
      },
      height: 630,
      output: 'articles/portable.webp',
      sources: ['content/article.md'],
      width: 1200
    })

    expect(createPageCard({
      description: 'Home description',
      pathname: '/',
      title: 'Home'
    })).toEqual({
      data: { description: 'Home description', title: 'Home' },
      output: 'index.webp'
    })
  })

  it('converts the shared definition to Next.js Metadata API fields', () => {
    const metadata = toNextMetadata(article, site)

    expect(metadata.metadataBase).toEqual(new URL('https://example.com/base/'))

    expect(metadata.alternates.canonical).toBe('https://example.com/articles/portable?ref=canonical')

    expect(metadata.openGraph).toMatchObject({
      authors: ['Ada Lovelace'],
      images: [{
        alt: article.image.alt,
        height: 630,
        type: 'image/webp',
        url: 'https://example.com/social/articles/portable.webp',
        width: 1200
      }],
      publishedTime: '2026-08-20T14:00:00.000Z',
      type: 'article'
    })

    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      creator: '@author',
      site: '@example'
    })

    expect(metadata.robots).toEqual({
      follow: true,
      index: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1
    })
  })

  it('uses summary cards without images and honors robots overrides', () => {
    const metadata = resolvePageMetadata({
      description: 'Private page',
      pathname: '/private',
      robots: { follow: false, index: false },
      title: 'Private'
    }, { siteUrl: 'http://localhost:3000' })

    expect(metadata.twitter.card).toBe('summary')

    expect(metadata.robots).toMatchObject({ follow: false, index: false })

    expect(createMetaTags({
      description: 'Private page',
      image: { alt: 'Preview', url: 'http://localhost:3000/preview.png' },
      pathname: '/private',
      title: 'Private'
    }, { siteUrl: 'http://localhost:3000' })).not.toContainEqual(expect.objectContaining({
      property: 'og:image:secure_url'
    }))
  })

  it.each([
    [{ description: '', pathname: '/', title: 'Title' }, site, 'description must not be empty'],
    [{ description: 'Description', pathname: '/', title: '' }, site, 'title must not be empty'],
    [{ description: 'Description', pathname: '/', title: 'Title' }, {
      siteUrl: 'file:///tmp/site'
    }, 'siteUrl must use http or https'],
    [{ description: 'Description', image: { alt: 'Card', width: 0 }, pathname: '/', title: 'Title' }, {
      siteUrl: 'https://example.com'
    }, 'image.width must be a positive integer'],
    [{
      article: {},
      description: 'Description',
      pathname: '/',
      title: 'Title',
      type: 'website'
    }, site, 'article metadata requires the Open Graph article type']
  ] satisfies readonly [PageMetadata, SiteMetadataOptions, string][])('rejects invalid metadata %#', (
    page,
    options,
    message
  ) => {
    expect(() => resolvePageMetadata(page, options)).toThrow(message)
  })
})
