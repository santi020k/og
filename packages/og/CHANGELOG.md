# Changelog

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
