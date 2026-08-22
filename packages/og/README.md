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
  concurrency: 'auto',
  renderer: defineWorkerRenderer({
    module: new URL('./scripts/render-og-card.mjs', import.meta.url),
  }),
})
```

The renderer module default-exports the same `(data, context) => output` function used in a regular
config. Card data sent to workers must support structured cloning. Set a fixed concurrency when CI
or native image libraries have tighter memory limits.

## Cache and cleanup guarantees

The default `.og-cache.json` fingerprint includes each card's data, dimensions, output name, config
contents, and declared source-file contents. A worker renderer module is included automatically. If
generated images are committed and checked in CI, commit the manifest alongside them so a fresh
checkout can verify the fingerprints.

`clean: true` removes only obsolete outputs recorded in the previous manifest. It never scans and
deletes arbitrary files from the output directory. Output paths and the manifest are constrained to
the project root, preventing accidental traversal.

Use `santi-og check` in CI to fail when an output is missing or stale without changing files.

## Existing-project migration

See [docs/migrating-existing-projects.md](docs/migrating-existing-projects.md) for the recommended
adapter for Lumen, santi020k.com, santi020k-theme, astro-doctor, eslint-config-basic, commitprompt,
ContracTrack, Cult, PostLens, and workspace-organizer.

## Philosophy

The package owns generation mechanics. The consuming project owns its brand, content discovery,
fonts, assets, and visual composition. Shared brand presets can depend on `@santi020k/og`, but the
core package does not depend on a design system or theme.
