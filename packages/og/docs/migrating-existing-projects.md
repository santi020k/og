# Migrating existing projects

Version 0.4 adds typed catalog mapping, multi-format cards, deterministic typography,
version-aware caching, richer content filters, and migration automation on top of the default design
layer introduced in 0.3. Preset and custom renderers use the same generation, caching, cleanup, and
CI behavior.

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

## Astro Markdown and MDX

Replace custom recursive directory walking and YAML parsing with the Astro helper:

```js
import { collectAstroContentCards } from '@santi020k/og/astro'
import { definePresetConfig } from '@santi020k/og/presets'

export default definePresetConfig({
  cards: () => collectAstroContentCards({
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
pagination, or locale cards.

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
directory and can fail CI when decoded pixel differences exceed the chosen ratio. Use
`santi-og upgrade --to 0.4.0` to update package manifests or pnpm catalogs, then run the package
manager install command yourself.
