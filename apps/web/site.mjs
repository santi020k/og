import { defineSite } from '@santi020k/og/site'
import packageMetadata from '../../packages/og/package.json' with { type: 'json' }

export const packageVersion = packageMetadata.version
export const siteUrl = process.env.PUBLIC_SITE_URL ?? 'https://og.santi020k.com'
export const site = defineSite({
  locale: 'en_US',
  publicImagePath: '/og',
  siteName: '@santi020k/og',
  siteUrl,
  titleTemplate: '%s — @santi020k/og'
})

export const pages = {
  home: site.page({
    pathname: '/',
    title: 'Open Graph image generation',
    cardDescription: 'Useful presets. Portable metadata. Deterministic output, ready for every framework.',
    description: 'Generate polished, deterministic Open Graph images from reusable presets or your own renderer. Built for Astro, Next.js, and plain Node.js.',
    image: { output: 'pages/home.webp', alt: 'Generate deterministic Open Graph images with @santi020k/og', width: 1200, height: 630 },
    schemaTypes: ['WebPage', 'SoftwareSourceCode'],
    variant: 'product'
  }),
  docs: site.page({
    pathname: '/docs/',
    title: 'Documentation',
    cardDescription: 'Create social cards, share metadata, and audit every route from one config.',
    description: 'Learn visual presets, portable metadata, content discovery, runtime responses, JSON-LD, and built-site audits with @santi020k/og.',
    image: { output: 'pages/docs.webp', alt: '@santi020k/og documentation: from content to social cards', width: 1200, height: 630 },
    schemaTypes: ['WebPage', 'BreadcrumbList'],
    variant: 'docs'
  }),
  checker: site.page({
    pathname: '/checker/',
    title: 'OG & metadata checker',
    cardDescription: 'Check social previews, canonical URLs, and structured data before you ship.',
    description: 'Inspect Open Graph images, social metadata, canonical URLs, robots directives, and structured data for public or localhost websites.',
    image: { output: 'pages/checker.webp', alt: 'Inspect social previews and website metadata with the OG checker', width: 1200, height: 630 },
    schemaTypes: ['WebPage', 'WebApplication'],
    variant: 'simple'
  })
}
