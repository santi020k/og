# Migrating existing projects

Version 0.3 adds a default design layer. A consumer now chooses between a compact preset config and
a custom renderer; both use the same deterministic generation, caching, cleanup, and CI behavior.

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
tracks each content file as a card source. Custom callbacks can map data, output paths, and covers.

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

If a project publishes multiple names in the same format, use `aliases` to render once. Keep one
card per format when publishing both SVG and raster output because encoding is selected by extension.
Use `outputDirectories` for multi-app repositories and `assets` for pass-through files.

## Migrated repository pattern

The v0.3 migration uses presets for Lumen, commitprompt, Cult, PostLens, workspace-organizer,
santi020k-theme, Astro Doctor, eslint-config-basic, santi020k.com, and ContracTrack. Their route and
content definitions remain local, while their SVG escaping, text wrapping, Sharp setup, worker
wrappers, and repeated output mapping are removed.

Run `santi-og compare` when visual parity is required. It renders in a temporary directory and
reports format, dimensions, byte size, and decoded pixel differences without replacing outputs.
