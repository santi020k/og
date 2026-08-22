# Improvements for the next version

These findings come from migrating Lumen, commitprompt, Cult, PostLens, workspace-organizer,
santi020k-theme, Astro Doctor, eslint-config-basic, santi020k.com, and ContracTrack.

## Completed in 0.2

- Output-content digests, transitive renderer-source discovery, source globs, and source callbacks.
- Encoded-renderer and legacy-card adapters.
- Output aliases, named output directories, copied assets, and tracked-only cleanup.
- Non-destructive image comparison and bounded automatic concurrency.
- Package config discovery and the Satori worker renderer helper.

## Completed in 0.3

- Neutral `simple`, `article`, `docs`, and `product` card presets.
- Configurable brand, domain, logo, image, palette, accent, and Sharp encoding options.
- Shared title wrapping, escaping, layout, SVG composition, and raster encoding.
- Deterministic URL-path output mapping with `pathnameOutput` and `createPathCards`.
- Astro Markdown/MDX discovery with YAML frontmatter, nested index slugs, draft filtering, and custom
  data, output, and source callbacks.
- A preset-based CLI starter that is useful without writing a renderer.

## Completed in 0.4

- Generic typed `createCards` mapping for data catalogs, derived archives, pagination, and CMS
  results.
- First-class multi-format cards and per-format aliases without repeated logical card definitions.
- Pre-parse include/exclude patterns, custom filters and draft predicates, cover fallbacks, and
  collection aggregation for Markdown/MDX content.
- Generator- and preset-version-aware manifests, semantic cache keys, elapsed-time summaries, and
  documented tracked-manifest workflows.
- Bundled portable Inter typography, real glyph measurement, safe long-token wrapping, embedded
  fonts, and SVG-compatible hex-alpha colors.
- Machine-readable CLI summaries, migration inventory reports, visual-difference thresholds, and a
  package-manager-aware upgrade command for package manifests and pnpm workspaces.
- A documented hybrid workflow for preset social cards alongside specialized custom media scripts.

## Findings for a future release

### Preset typography and layout

- Add narrow extension points for preset decorations. Consumers currently choose a complete preset
  or a complete custom renderer; a safe slot API could cover product screenshots and small diagrams
  without bringing back full SVG templates.

### Content adapters

- Add optional adapters for Astro's generated content metadata and non-file sources such as a CMS.
  The v0.3 helper deliberately reads Markdown/MDX directly so it works without an Astro runtime, but
  consumers with custom slug transforms still need a mapping callback.
- Define remote-image download and cache semantics before supporting HTTP cover images. Local and
  data-URL images are dependable today; silently relying on an SVG implementation to fetch remote
  resources would make builds non-deterministic.

### Findings from the published 0.3.0 consumer rollout

- Add an optional data-only manifest format for large static route catalogs. Astro Doctor and
  ContracTrack now have small renderer orchestration, but most of their remaining OG files are long
  JavaScript arrays containing titles, badges, locale variants, and image paths that could be YAML
  or JSON validated by the library.
