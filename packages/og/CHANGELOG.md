# Changelog

## 0.4.0 - 2026-08-22

- Add portable page metadata, card derivation, safe HTML rendering, and a dependency-free Next.js
  Metadata API adapter.
- Add a framework-neutral Markdown/MDX content entry point while preserving the Astro helpers as
  compatibility aliases.
- Add generic typed card collection mapping, multi-format output, generator and preset cache
  versioning, JSON summaries, migration reporting, and project upgrades.
- Bundle deterministic Inter typography and use glyph-aware wrapping in preset layouts.

## 0.3.0 - 2026-08-22

- Add neutral `simple`, `article`, `docs`, and `product` presets with configurable brand and theme.
- Add Markdown/MDX Astro content discovery and frontmatter-to-card mapping.
- Add deterministic `pathnameOutput` and `createPathCards` composition helpers.
- Make the CLI starter config use the preset API instead of shipping a custom SVG renderer.

## 0.2.1 - 2026-08-22

- Fix explicit `--config` file paths being treated as package directories.

## 0.2.0 - 2026-08-22

- Verify output-content digests and discover transitive worker sources.
- Add source globs and callbacks, output aliases, named output directories, and copied assets.
- Add encoded-renderer and legacy-card composition helpers plus a Satori worker helper.
- Add non-destructive image comparison, bounded automatic concurrency, and package config shorthand.

## 0.1.0

- Initial renderer-agnostic generator, CLI, content cache, tracked cleanup, Sharp renderer, Satori
  renderer, and worker-module support.
