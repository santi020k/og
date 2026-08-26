# Migrating existing projects

Version 0.5 adds bound site definitions, an Astro head component, route manifests, extensible
JSON-LD recipes, declarative content archives, and final-output auditing on top of the portable
metadata and content APIs introduced in 0.4. Preset and custom renderers use the same generation,
caching, cleanup, and CI behavior.

## Prefer a preset for conventional cards

Use a preset when the old renderer mainly provided a branded background, logo, title, description,
badge, and optional image. Keep route lists, product copy, content discovery, assets, and colors in
the consumer:

```js
import { createPathCards } from '@santi020k/og'
import { definePresetConfig } from '@santi020k/og/presets'

const pages = [
  {
    pathname: '/',
    data: {
      badge: 'Home',
      description: 'Consumer-owned copy.',
      title: 'A reusable product card',
      variant: 'product',
    },
  },
]

export default definePresetConfig({
  cards: createPathCards(pages),
  outputDirectory: 'public/og/pages',
  preset: {
    brand: { name: 'Product', domain: 'example.com', logo: 'public/icon.png' },
    theme: { accent: '#7c3aed', background: '#0f172a' },
  },
})
```

`createPathCards` turns `/`, `/docs/api`, and encoded URL segments into stable WebP outputs. Set
`extension` or `directory` once instead of repeating output mapping for every page.

### Present covers and logos without preprocessing

Preset images use cover cropping by default. For transparent logos or product marks, set an image
surface, contain fitting, and an inset directly on the card. The renderer preserves the source
format and aspect ratio, including SVG, WebP, PNG, and pinned remote images:

```js
{
  image: 'public/project-logo.svg',
  imagePresentation: {
    background: '#f8fafc',
    fit: 'contain',
    padding: 64,
  },
  title: 'Project name',
  variant: 'product',
}
```

Set `preset.imagePresentation` to establish site-wide defaults. A card's
`imagePresentation` fields override those defaults without changing existing cover cards.

## Reuse page data for metadata

Replace separate page SEO objects and card definitions with one portable page definition. Map
renderer-only fields explicitly, then derive HTML descriptors or Next.js metadata from the same
title, description, URL, and image contract:

```js
import { createMetaTags, createPageCard, definePageMetadata } from '@santi020k/og/metadata'
import { toNextMetadata } from '@santi020k/og/metadata/next'

const page = definePageMetadata({
  pathname: '/docs',
  title: 'Documentation',
  description: 'Learn the product.',
  image: { output: 'docs.webp', alt: 'Documentation social card' },
})

const card = createPageCard(page, {
  data: ({ description, title }) => ({ description, title, variant: 'docs' }),
})

const site = { siteUrl: 'https://example.com', siteName: 'Example' }
const tags = createMetaTags(page, site)
const metadata = toNextMetadata(page, site)
```

For repeated site options, replace the individual calls with `defineSite`. Astro projects can render
the result with `@santi020k/og/astro/head`, and `routeManifest` lets the build audit verify that every
indexable route has the expected card and JSON-LD types.

Use `renderMetaTags` from `@santi020k/og/metadata/html` for escaped static or server-rendered HTML.
Run image generation before the web-framework build so every referenced static image exists.

## Framework-neutral Markdown and MDX

Replace custom recursive directory walking and YAML parsing with the content helper:

```js
import { collectContentCards } from '@santi020k/og/content'
import { definePresetConfig } from '@santi020k/og/presets'

export default definePresetConfig({
  cards: () => collectContentCards({
    directory: 'src/content/docs',
    map: entry => ({
      title: String(entry.frontmatter.title),
      description: String(entry.frontmatter.description ?? ''),
      badge: 'Docs',
      variant: 'docs',
    }),
  }),
  preset: { brand: { name: 'Documentation' }, variant: 'docs' },
})
```

The helper understands nested `index.md` routes, excludes drafts by default, and automatically
tracks each content file as a card source. Use `include` and `exclude` before parsing, `filter` and a
custom `draft` predicate after parsing, `coverFields` for fallbacks, and `aggregate` for tag,
pagination, or locale cards. Use `route` when the published URL differs from the content folder
structure. Existing `collectAstroContentCards` and `readAstroContent` imports from
`@santi020k/og/astro` remain compatibility aliases.

## Typed data catalogs and multiple formats

Use `createCards` for typed arrays, JSON, CMS results, pagination, or derived archives. It maps the
catalog once and can apply shared destinations, aliases, dimensions, and formats:

```ts
const cards = createCards(products, product => ({
  title: product.name,
  variant: 'product',
}), {
  output: product => `products/${product.slug}.webp`,
  formats: ['png', 'svg'],
  formatAliases: product => ({ png: [`share/${product.slug}.png`] }),
})
```

For Markdown collections, prefer `paginateArchive` and `groupArchive` over consumer-owned loops.
Nested cover fields and `resolveCover` replace local frontmatter traversal and asset resolution.

## Replace common SEO validators

Run the shared audit against final framework output, then keep a small project script only for
genuinely product-specific contracts such as native-icon byte parity or language alternates:

```bash
santi-og audit \
  --site apps/website/dist \
  --site-url https://example.com \
  --manifest apps/website/dist/og/manifest.json \
  --unique-images \
  --max-image-bytes 5000000
```

Use `schemaTypes` on page or route definitions to declare route-specific JSON-LD expectations.
The manifest carries those expectations into the audit without coupling the renderer core to a
particular Schema.org vocabulary.

## Keep a custom renderer when it is meaningful

Complex editorial art, bespoke data visualizations, and strict legacy pixel parity still justify a
consumer renderer. Use `createSharpRenderer`, `createSatoriRenderer`, or `createEncodedRenderer`
without duplicating orchestration. Large Satori collections can use `createSatoriWorkerRenderer`.

```js
import { defineConfig } from '@santi020k/og'
import { createSharpRenderer } from '@santi020k/og/sharp'

export default defineConfig({
  cards,
  renderer: createSharpRenderer({ renderSvg: createCardSvg }),
})
```

If a project publishes multiple names in the same format, use `aliases` to reuse the primary bytes.
Use `formats` and `formatAliases` when one logical card publishes SVG and raster variants. Use
`outputDirectories` for multi-app repositories and `assets` for pass-through files.

Keep unrelated media pipelines separate. A preset `og.config.mjs` can replace the old social-card
renderer while a launch-video or diagram script keeps its specialized renderer and dependencies.

## Migrated repository pattern

The migration uses presets for Lumen, commitprompt, Cult, PostLens, workspace-organizer,
santi020k-theme, Astro Doctor, eslint-config-basic, santi020k.com, and ContracTrack. Their route and
content definitions remain local, while their SVG escaping, text wrapping, Sharp setup, worker
wrappers, and repeated output mapping are removed.

Start with `santi-og migrate --report --json` to inventory the remaining work. Run
`santi-og compare --threshold 0.01` when visual parity is required; it renders in a temporary
directory and can fail CI when decoded pixel differences exceed the chosen ratio. Missing outputs
and dimension changes always fail because they have no comparable pixel ratio. Use
`santi-og upgrade --to 1.0.0` to update root and declared workspace package manifests or pnpm
catalogs, then run the package manager install command yourself.
