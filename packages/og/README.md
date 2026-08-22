# @santi020k/og

Generate deterministic Open Graph images without giving a package ownership of your brand or
content model. Your project supplies cards and a renderer; `@santi020k/og` handles output paths,
content-aware caching, bounded concurrency, safe cleanup, image encoding, and CI checks.

It works with Astro, Next.js, plain Node.js, monorepos, Markdown collections, CMS data, or a static
array. There is no framework runtime.

## Quick start

```bash
pnpm add -D @santi020k/og
pnpm exec santi-og init
pnpm exec santi-og generate
```

Add stable package scripts:

```json
{
  "scripts": {
    "generate:og": "santi-og generate",
    "generate:og:force": "santi-og generate --force",
    "check:og": "santi-og check"
  }
}
```

The generated `og.config.mjs` is a complete SVG-to-WebP example. Change its card data and SVG to
match the project.

For compatibility with existing build scripts, `FORCE_OG=1` behaves like `--force` and
`OG_WORKER_THREADS=<number>` behaves like `--concurrency`. Explicit CLI flags take precedence.

## Configuration

```js
import { defineConfig } from '@santi020k/og'
import { createSharpRenderer } from '@santi020k/og/sharp'

export default defineConfig({
  outputDirectory: 'public/og/pages',
  clean: true,
  cache: {
    sources: [
      'scripts/render-og-card.mjs',
      'public/fonts/Inter-Bold.ttf',
      'public/logo.svg',
    ],
  },
  cards: async () => [
    {
      output: 'index.webp',
      data: { title: 'Home', description: 'Welcome to the project.' },
    },
  ],
  renderer: createSharpRenderer({
    renderSvg: ({ title }, { height, width }) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">...</svg>`,
    webp: { quality: 86 },
  }),
})
```

Card `data` can have any serializable shape. Each card may also declare `sources`, `width`, and
`height`. The output extension selects SVG, PNG, WebP, JPEG, or AVIF encoding.

Source collections accept literal paths, glob patterns, or an async callback. Relative paths resolve
from `root`; absolute paths are supported and remain outside the output traversal boundary:

```js
cache: { sources: ['public/fonts/*.ttf', '/shared/brand/logo.svg'] },
cards: async () => [{
  output: 'article.webp',
  data: article,
  sources: () => article.cover ? [article.cover] : [],
}],
```

## Existing encoded renderers

Wrap an existing function that already returns encoded PNG, WebP, JPEG, or AVIF bytes without
changing its implementation:

```js
import { createEncodedRenderer, fromLegacyCards, relativeOutput } from '@santi020k/og'

const cards = fromLegacyCards(legacySpecs) // [{ outFile, props }] -> [{ output, data }]
const renderer = createEncodedRenderer(props => renderExistingCard(props))
const output = relativeOutput('public/og', '/project/public/og/pages/home.webp')
```

`relativeOutput` rejects paths outside its output directory.

## Aliases, named directories, and static assets

One card can write the same rendered bytes to aliases and named output directories. Aliases must
use the primary output format and never invoke the renderer again. Use `assets` for pass-through
files referenced by generated SVG or published beside the cards:

```js
export default defineConfig({
  outputDirectory: 'public/og',
  outputDirectories: {
    docs: 'apps/docs/public',
    store: 'apps/store/public',
  },
  cards: [{
    output: 'og.png',
    aliases: ['og-image.png', { directory: 'docs', output: 'social/home.png' }],
    data: home,
  }],
  assets: [{
    source: 'assets/app-icon.png',
    directory: 'store',
    output: 'app-icon.png',
  }],
  renderer,
})
```

## Satori

The Satori entry point includes Satori, Resvg-compatible SVG output, Sharp encoding, and the
`satori-html` template helper:

```js
import { readFile } from 'node:fs/promises'
import { defineConfig } from '@santi020k/og'
import { createSatoriRenderer, html } from '@santi020k/og/satori'

const regular = await readFile('public/fonts/Inter-Regular.ttf')

export default defineConfig({
  cards: [{ output: 'index.webp', data: { title: 'Hello' } }],
  renderer: createSatoriRenderer({
    satori: {
      fonts: [{ data: regular, name: 'Inter', weight: 400 }],
    },
    template: ({ title }) => html`<div style="display:flex">${title}</div>`,
  }),
})
```

## Large collections and worker threads

For hundreds of cards, export a renderer from a separate module and let the CLI create a bounded
worker pool:

```js
import { defineConfig, defineWorkerRenderer } from '@santi020k/og'

export default defineConfig({
  cards: collectCards,
  concurrency: { mode: 'auto', max: 16 },
  renderer: defineWorkerRenderer({
    module: new URL('./scripts/render-og-card.mjs', import.meta.url),
  }),
})
```

The renderer module default-exports the same `(data, context) => output` function used in a regular
config. Card data sent to workers must support structured cloning. Use `'auto'` for every available
CPU, `{ mode: 'auto', max: 16 }` for detected-but-bounded concurrency, or a fixed integer.

For Satori, the worker helper can load a module that exports `SatoriRendererOptions`, avoiding a
wrapper module that only calls `createSatoriRenderer`:

```js
import { createSatoriWorkerRenderer } from '@santi020k/og/satori'

renderer: createSatoriWorkerRenderer({
  module: new URL('./scripts/satori-options.mjs', import.meta.url),
})
```

## Cache and cleanup guarantees

The default `.og-cache.json` fingerprint includes each card's data, dimensions, destinations, config
contents, and declared source-file contents. Worker entry modules, their statically imported local
modules, and literal `readFile(...)` or `new URL(...)` assets are discovered transitively. Dynamic
paths should still be declared with `cache.sources` or per-card `sources`.

Each manifest entry also stores the generated file's SHA-256 digest. `generate` and `check` therefore
detect missing, manually edited, or corrupted output bytes even when all inputs are unchanged. A
version 1 manifest is read safely and upgraded by regenerating entries without output digests. If
generated images are committed and checked in CI, commit the manifest alongside them.

`clean: true` removes only obsolete outputs recorded in the previous manifest. It never scans and
deletes arbitrary files from the output directory. Output paths and the manifest are constrained to
the project root, preventing accidental traversal.

Use `santi-og check` in CI to fail when an output is missing or stale without changing files.

Use `santi-og compare` during migrations. It renders into a temporary directory and reports the
format, dimensions, byte size, and decoded pixel difference against each existing output without
replacing committed files.

The CLI discovers root configs, `scripts/og.config.mjs`, and `scripts/generate-og-images.mjs`. A
package can also point to any config without repeating `--config` in every script:

```json
{
  "santi-og": { "config": "scripts/cards.mjs" }
}
```

## Existing-project migration

See [docs/migrating-existing-projects.md](docs/migrating-existing-projects.md) for the recommended
adapter for Lumen, santi020k.com, santi020k-theme, astro-doctor, eslint-config-basic, commitprompt,
ContracTrack, Cult, PostLens, and workspace-organizer.

## Philosophy

The package owns generation mechanics. The consuming project owns its brand, content discovery,
fonts, assets, and visual composition. Shared brand presets can depend on `@santi020k/og`, but the
core package does not depend on a design system or theme.
