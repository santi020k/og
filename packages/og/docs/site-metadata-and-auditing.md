# Site metadata, schemas, and auditing

The site APIs turn one page definition into framework metadata, a generated social card, a route
manifest, and build-time verification. They are optional: the rendering core remains independent of
web frameworks and Schema.org.

## Bind site defaults once

`defineSite` removes repeated site URLs, title templates, social-image paths, locales, and defaults:

```ts
import { defineSite } from '@santi020k/og/site'

export const site = defineSite({
  siteUrl: 'https://example.com',
  siteName: 'Example',
  publicImagePath: '/og',
  titleTemplate: '%s — Example',
  twitter: { site: '@example' },
  defaults: {
    image: { width: 1200, height: 630 },
    robots: { index: true, follow: true },
  },
})

export const docs = site.page({
  pathname: '/docs',
  title: 'Documentation',
  description: 'Learn how the product works.',
  image: { output: 'docs.webp', alt: 'Example documentation card' },
})

export const card = site.card(docs, {
  data: page => ({ title: page.title, description: page.description, variant: 'docs' }),
})

export const tags = site.tags(docs)
export const html = site.html(docs)
export const nextMetadata = site.next(docs)
```

## Localized alternates

Use one locale matrix for portable metadata and built-site expectations:

```ts
import { createLocaleAlternates, createLocaleAuditHrefs } from '@santi020k/og/locales'

const localeOptions = {
  defaultLanguage: 'es',
  locales: [
    { language: 'es', prefix: '' },
    { language: 'en', prefix: 'en' },
  ],
  siteUrl: 'https://example.com',
}

const page = site.page({
  alternates: createLocaleAlternates('/en/docs/', localeOptions),
  description: 'Localized documentation.',
  pathname: '/en/docs/',
  title: 'Documentation',
})

const expectedHrefs = createLocaleAuditHrefs(localeOptions)
```

The metadata HTML renderer emits hreflang links, the Next.js adapter emits
`alternates.languages`, and `expectedHrefs` plugs into `createAlternateLinksAuditRule`.

## Astro head integration

Astro projects can render the portable descriptors without maintaining a conditional meta-tag
component:

```astro
---
import MetadataHead from '@santi020k/og/astro/head'
import { page, site } from '../metadata'
---

<head>
  <MetadataHead page={page} site={site.options} />
</head>
```

Pass `noindexPolicy="minimal"` to keep only title, description, and robots on noindex pages. Use
`extra` for project-specific descriptors such as verification or theme metadata.

### Starlight

Starlight component overrides can preserve the framework's descriptors while adding deterministic
social-image metadata:

```astro
---
import StarlightMetadataHead from '@santi020k/og/astro/starlight'
---

<StarlightMetadataHead {...Astro.props} />
```

The adapter maps `/guide/getting-started/` to `/og/guide--getting-started.webp`. Frontmatter can
override the defaults with `ogImage` and `ogImageAlt` when the content schema permits those fields.

## Route manifest

Enable `routeManifest` to publish a deterministic map from routes to every generated image and
alias:

```ts
export default definePresetConfig({
  routeManifest: {
    file: 'public/og/manifest.json',
    publicPath: '/og',
    publicPaths: { admin: '/admin/og' },
  },
  cards: createPathCards(pages),
  // renderer or preset...
})
```

`createPathCards` and `createPageCard` attach route information automatically. Typed catalogs can
provide it with the `route` callback in `createCards`. The manifest has no timestamp, participates
in `santi-og check`, and includes dimensions, formats, aliases, named output directories, and
public URLs.

## Extensible JSON-LD recipes

Built-in recipes cover websites, web pages, articles, software applications, events, FAQs, offers,
images, breadcrumbs, collections, people, and organizations. Compose them into a graph when nodes
share stable `@id` references:

```ts
import { articleSchema, composeJsonLd, organizationSchema, serializeJsonLd } from '@santi020k/og/schema'

const publisher = organizationSchema({
  id: 'https://example.com/#organization',
  name: 'Example',
  url: 'https://example.com',
})

const jsonLd = composeJsonLd(publisher, articleSchema({
  name: 'A useful guide',
  datePublished: '2026-08-24',
  publisher,
  url: 'https://example.com/guides/useful',
}))

const safeScriptContents = serializeJsonLd(jsonLd)
```

Recipes are deliberately open. Extend a known recipe with additional Schema.org properties, define
an arbitrary node, or create a reusable domain recipe:

```ts
import {
  defineSchema,
  defineSchemaRecipe,
  extendSchema,
  softwareApplicationSchema,
} from '@santi020k/og/schema'

const app = extendSchema(
  softwareApplicationSchema({ name: 'Example', url: 'https://example.com' }),
  { featureList: ['Fast', 'Accessible'], screenshot: 'https://example.com/app.png' },
)

const faqSchema = defineSchemaRecipe((questions: readonly { answer: string; question: string }[]) =>
  defineSchema({
    '@type': 'FAQPage',
    mainEntity: questions.map(item => defineSchema({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: defineSchema({ '@type': 'Answer', text: item.answer }),
    })),
  }),
)
```

The library does not reject properties it does not know. That keeps new Schema.org vocabulary and
specialized scenarios available without waiting for a library release.

## Declarative content archives

Content collections can generate detail cards plus pagination and grouped archives in one pass:

```ts
import { collectContentCards, groupArchive, paginateArchive } from '@santi020k/og/content'

cards: () => collectContentCards({
  directory: 'src/content/blog',
  coverFields: ['coverImage.ogImage', 'cover'],
  resolveCover: true,
  route: entry => `/blog/${entry.slug.split('/').at(-1)}/`,
  archives: [
    paginateArchive({
      pageSize: 10,
      basePath: '/blog/',
      data: page => ({ title: `Blog · Page ${page.pageNumber}` }),
    }),
    groupArchive({
      field: 'tags',
      basePath: '/blog/tags/',
      data: group => ({ title: `${group.group} posts` }),
    }),
  ],
})
```

Nested cover fields use dot notation. With `resolveCover`, relative cover values resolve beside the
content file and are tracked as card sources. The entry-level `route` mapper supports sites whose
content folders do not mirror their URLs. Archive callbacks customize data, outputs, and route
naming while the helper owns sorting and grouping.

## Audit the built site

The audit reads final HTML and images, so it catches template wiring and missing build artifacts
that source-only validators miss:

```bash
santi-og audit --site dist --site-url https://example.com
santi-og audit --site dist --site-url https://example.com --manifest public/og/manifest.json
santi-og audit --site dist --site-url https://example.com --json
santi-og audit --site dist --site-url https://example.com --sarif > results.sarif
santi-og audit --site dist --site-url https://example.com --standards
santi-og audit --site dist --site-url https://example.com --llms
```

To share the same policy between local development and CI, create `og.audit.config.mjs`:

```js
import { standardAuditRules } from '@santi020k/og/audit/rules'
import { defineAuditConfig } from '@santi020k/og/audit/config'

export default defineAuditConfig({
  directory: 'dist',
  manifest: 'public/og/manifest.json',
  siteUrl: 'https://example.com',
  ...standardAuditRules({
    sitemap: { reportOrphans: true },
    alternates: { requireXDefault: true },
  }),
})
```

Run `santi-og audit` with no repeated path or policy flags. CLI flags override scalar config values;
`--standards` and `--llms` append their rules to configured `siteRules`. Human output also groups
repeated issue codes into a compact root-cause summary after the detailed findings.

It checks titles, descriptions, robots, canonicals, Open Graph, X metadata, canonical-route
consistency, local image existence and dimensions, duplicate titles, optional duplicate images,
manifest coverage, and orphaned route cards. `auditSite` also accepts project-specific asynchronous
rules for product requirements that do not belong in the core library.

For programmatic audits, `standardAuditRules()` enables sitemap, robots, hreflang alternate, and
redirect rules together. Each rule is independently configurable:

```ts
import { auditSite } from '@santi020k/og/audit'
import {
  createAlternateLinksAuditRule,
  createLlmsAuditRule,
  createRobotsAuditRule,
  createSitemapAuditRule,
} from '@santi020k/og/audit/rules'

const result = await auditSite({
  directory: 'dist',
  siteUrl: 'https://example.com',
  siteRules: [
    createSitemapAuditRule({ reportOrphans: true }),
    createRobotsAuditRule({
      requiredDirectives: [{ name: 'Allow', value: '/' }],
      expectedSitemaps: ['https://example.com/sitemap.xml'],
    }),
    createAlternateLinksAuditRule({ requireXDefault: true }),
    createLlmsAuditRule({ compatibilityFiles: ['llm.txt'] }),
  ],
})
```
