# Migrating existing projects

The shared boundary is the generation pipeline. Keep route discovery and card composition inside the
consumer so a design-system site, a personal site, and an independent product do not inherit one
another's branding.

## Current project map

| Project | Existing renderer | Recommended adapter | Project-owned pieces |
| --- | --- | --- | --- |
| Lumen | SVG templates and Sharp | `createSharpRenderer` | Component-doc discovery, Lumen badges, logo, launch-video reuse |
| commitprompt | SVG templates and Sharp | `createSharpRenderer` | Terminal illustration and route list |
| Cult | SVG templates and Sharp | `createSharpRenderer` | Avatar, bilingual copy, Cult palette |
| PostLens | SVG templates and Sharp | `createSharpRenderer` | iOS icon and product cards |
| workspace-organizer | SVG templates and Sharp | `createSharpRenderer` | macOS icon and product cards |
| santi020k-theme | SVG templates and Sharp | `createSharpRenderer` | Theme-family card catalog and editor/browser illustrations |
| astro-doctor | Satori, Resvg, and Sharp | `createSatoriRenderer` | Rule catalog, favicon, fonts, category colors |
| eslint-config-basic | Satori, Resvg, Sharp, workers | `defineWorkerRenderer` plus `createSatoriRenderer` | Starlight content discovery, favicon, fonts |
| santi020k.com | Satori, Resvg, Sharp, workers | `defineWorkerRenderer` plus `createSatoriRenderer` | Markdown/frontmatter discovery, brand assets, cover images |
| ContracTrack | Satori, Resvg, and Sharp | `createSatoriRenderer` with `concurrency: 1` | Bilingual routes, medical product visuals, local fonts |

## SVG and Sharp projects

Move the existing SVG-producing function into a renderer module or keep it directly in
`og.config.mjs`:

```js
import { defineConfig } from '@santi020k/og'
import { createSharpRenderer } from '@santi020k/og/sharp'
import { cards, createCardSvg } from './scripts/og-cards.mjs'

export default defineConfig({
  outputDirectory: 'public/og/pages',
  cards,
  cache: { sources: ['scripts/og-cards.mjs', 'public/logo.svg'] },
  clean: true,
  renderer: createSharpRenderer({
    renderSvg: createCardSvg,
    webp: { effort: 4, quality: 86 },
  }),
})
```

If a project intentionally publishes both SVG and PNG versions, add two cards with the same data
and different output extensions. The extension controls encoding.

## Satori projects

Retain the existing Satori template and fonts, replacing only orchestration and output encoding:

```js
import { readFile } from 'node:fs/promises'
import { defineConfig } from '@santi020k/og'
import { createSatoriRenderer, html } from '@santi020k/og/satori'
import { collectSpecs } from './scripts/collect-og-specs.mjs'

const regular = await readFile('public/fonts/Montserrat-Regular.ttf')

export default defineConfig({
  outputDirectory: 'public/og',
  cards: collectSpecs,
  cache: {
    sources: ['scripts/collect-og-specs.mjs', 'public/fonts/Montserrat-Regular.ttf'],
  },
  renderer: createSatoriRenderer({
    satori: { fonts: [{ data: regular, name: 'Montserrat', weight: 400 }] },
    template: ({ title }) => html`<div style="display:flex">${title}</div>`,
    sharp: { webp: { quality: 86 } },
  }),
})
```

ContracTrack should set `concurrency: 1`, preserving its current sequential rendering decision.

## Worker-backed projects

The website and eslint-config-basic currently use custom worker pools. Export their renderer from a
module instead:

```js
// scripts/render-og-card.mjs
import { createSatoriRenderer, html } from '@santi020k/og/satori'

export default createSatoriRenderer({
  satori: { fonts },
  template: props => html`<div style="display:flex">${props.title}</div>`,
})
```

```js
// og.config.mjs
import { defineConfig, defineWorkerRenderer } from '@santi020k/og'
import { collectSpecs } from './scripts/collect-og-specs.mjs'

export default defineConfig({
  cards: collectSpecs,
  concurrency: process.env.OG_WORKERS ? Number(process.env.OG_WORKERS) : 'auto',
  renderer: defineWorkerRenderer({
    module: new URL('./scripts/render-og-card.mjs', import.meta.url),
  }),
})
```

This replaces each project's worker-pool and worker-protocol copies. Keep content parsing local
because the schemas differ across Starlight, Astro content collections, portfolio projects, blog
series, and manually declared routes.

## Personal-brand preset

After the core package is published, `@santi020k/theme` can add an `./og` export containing shared
wallpaper, logo, typography, and a Satori template factory. That export should depend on
`@santi020k/og`; the generic generator should not depend on the personal theme.

Projects can then choose either a fully independent renderer or the branded preset:

```js
import { defineConfig } from '@santi020k/og'
import { createSanti020kRenderer } from '@santi020k/theme/og'

export default defineConfig({
  cards: collectCards,
  renderer: createSanti020kRenderer(),
})
```

## Migration order

1. PostLens and workspace-organizer, because their generators are the closest pair.
2. commitprompt, Cult, and santi020k-theme.
3. Lumen, retaining its launch-video renderer import.
4. astro-doctor and ContracTrack.
5. eslint-config-basic and santi020k.com after validating worker performance and memory use.

During migration, generate with `--force` once and compare file dimensions and representative cards
before deleting the original orchestration script.
