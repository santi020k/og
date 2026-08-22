# Improvements for the next version

These findings came from migrating Lumen, commitprompt, Cult, PostLens, workspace-organizer,
santi020k-theme, Astro Doctor, eslint-config-basic, santi020k.com, and ContracTrack to
`@santi020k/og`.

## Cache integrity

- Store and verify an output-content digest in the manifest. `santi-og check` currently verifies that
  an output exists and that its input fingerprint is current, but it cannot detect a manually changed
  or corrupted generated image.
- Track transitive renderer imports automatically. Worker configs fingerprint the worker entry module,
  but consumers must also list the renderer imported by that module, its fonts, and its static assets in
  `cache.sources`.
- Support glob patterns or a `sources()` callback for collections whose local cover images are discovered
  dynamically. Per-card `sources` works, but migration code is repetitive.

## Migration ergonomics

- Add a renderer adapter for existing functions that already return encoded WebP or PNG buffers. Several
  mature projects could reuse their renderer only through a custom function instead of
  `createSharpRenderer` or `createSatoriRenderer`.
- Add first-class output aliases so one rendered home card can be written as `og.png`, `og-image.png`, and
  a route-specific name without rendering it repeatedly.
- Support multiple named output directories. The theme-family repository writes cards into several
  `apps/*/public` directories and currently has to set `outputDirectory: '.'` and place repository-relative
  paths in every card.
- Add a pass-through asset card or copy helper for assets referenced by generated SVG files. Product sites
  commonly publish both SVG and raster cards alongside a shared app icon.
- Let the CLI discover a config from a package-level conventional location or accept a package script
  shorthand. Monorepo consumers currently repeat `--config scripts/generate-og-images.mjs` in every command.

## Validation and performance

- Add a migration comparison command that renders to a temporary directory and reports dimensions,
  format, file size, and pixel differences without replacing committed images. Forced generation across
  the migrated projects produced visually equivalent but byte-different binaries, creating noisy diffs.
- Allow bounded automatic concurrency such as `{ mode: 'auto', max: 16 }`. Large Satori catalogs previously
  capped their worker pools explicitly; using every reported CPU is not always appropriate in CI.
- Report source and output paths in configuration errors. A missing font or cover currently surfaces as a
  lower-level file read error, which is harder to associate with the card that declared it.
- Document whether absolute paths are supported in `cache.sources` and per-card `sources`; migrations with
  assets outside an app package need that behavior.

## Configuration composition

- Export small helpers for converting legacy `{ outFile, props }` specs into `OgCard` entries and for
  deriving an output relative to `outputDirectory`. This mapping appeared in every Satori migration.
- Consider an optional `createSatoriWorkerRenderer` helper that owns the worker entry module. The current
  worker API is flexible, but every consumer still needs a one-line module that default-exports its renderer.
