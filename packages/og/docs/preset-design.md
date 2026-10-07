# Preset design and image presentation

The four presets share an editorial shell: a compact brand header, measured copy, quiet dividing
rules, and room for the content. The default palette uses charcoal, warm white, and lilac. Brand
colors, fonts, names, domains, and assets remain consumer configuration; the package does not depend
on a theme or UI framework.

| Variant | Default composition | Useful for |
| --- | --- | --- |
| `simple` | Wide typography with a subtle circular detail | Homepages, announcements, general pages |
| `article` | A layered editorial page beside the copy | Articles, release notes, essays |
| `docs` | Stacked reference sheets with a code motif | Guides, API references, documentation |
| `product` | A sculpted sphere and orbit, or your supplied image | Product pages, tools, launches |

## Make the card yours

```js
import { definePresetConfig } from '@santi020k/og/presets'

export default definePresetConfig({
  cards: [{
    output: 'product.webp',
    data: {
      variant: 'product',
      badge: 'New release',
      title: 'Good defaults. Room for your ideas.',
      description: 'Useful social previews from the content you already have.',
      image: 'public/product-logo.webp',
      imagePresentation: { fit: 'contain', padding: 48 },
    },
  }],
  preset: {
    brand: { name: 'Example studio', domain: 'example.com', logo: 'public/brand.webp' },
    theme: {
      accent: '#6d28d9',
      background: '#faf9f6',
      foreground: '#18181b',
      muted: '#52525b',
      panel: '#eceae5',
    },
  },
})
```

Decorations use the configured foreground and panel colors, so a light theme also changes their
surfaces and outlines. Choose sufficient contrast for your copy and accent against the background.
An image replaces the variant decoration, including on a `simple` card. `cover` fills and crops the
visual slot; `contain` preserves the complete asset. A contrasting `background` and optional
`padding` make transparent product marks easier to read. Local WebP and AVIF assets are normalized
to embedded PNG for both the visual slot and the header mark before raster rendering.

## Long copy and output sizes

Titles choose among three measured sizes and wrap into at most three lines. Descriptions use at
most two lines beneath the title and remain above the footer. Brand names, domains, and category
labels shorten with an ellipsis when they exceed their allocated space. Keep the essential message
at the start of each field; a social card is a preview, not a replacement for the page content.

Built-in layouts use a 1200 × 630 composition and scale the complete card to the requested output
size. Prefer that aspect ratio, including 600 × 315 or 2400 × 1260, to preserve the typography and
image proportions. Other aspect ratios stretch the composition; use a custom renderer for a
purpose-built square or portrait layout.

The trusted `preset.decoration` callback can replace the visual decoration while preserving the
shell. Its SVG fragment uses the actual output coordinates supplied by `context.width` and
`context.height`. At the default size, the visual slot is x=778, y=156, width=350, height=352.
Return `undefined` to retain the built-in visual, or an empty string to remove it.

## Regenerate after upgrading

Preset appearance can improve without changing card data. `definePresetConfig` includes the preset
version in its cache key, so upgrading a changed preset regenerates affected cards. Commit regenerated
outputs when your project tracks them, and inspect representative cards with long titles, images,
and both themes before publishing. Custom renderers remain available when exact pixel stability
or a project-specific composition is required.
