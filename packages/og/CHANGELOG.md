# Changelog

## Unreleased

## 1.1.1 - 2026-08-25

- Normalize WebP, AVIF, and GIF card images to deterministic embedded PNG data so Sharp's SVG
  renderer preserves visible pixels for contain and cover presentation modes.

## 1.1.0 - 2026-08-25

- Add backward-compatible per-preset and per-card image presentation controls for contain/cover
  fitting, background surfaces, and deterministic padding.
- Keep cover cropping as the default while allowing transparent square, wide, and tall logos to
  render directly without consumer-side raster preprocessing.

## 1.0.0 - 2026-08-24

- Establish the documented package subpaths, runtime exports, configuration shapes, CLI commands,
  and machine-readable results as the stable public contract.
- Add a transparent 0–100 score to hosted, CLI, visual, and JSON inspection results while keeping
  the underlying pass, warning, and error evidence visible.
- Support the hosted checker during local Astro development while preserving production Turnstile
  verification requirements.

## 0.9.0 - 2026-08-24

- Harden the hosted checker with same-origin enforcement, server-validated single-use Cloudflare
  Turnstile tokens, stricter DNS response validation, and fail-closed deployment configuration.
- Test packed release candidates and published registry artifacts in plain Node.js, Astro, and
  Next.js consumers before completing a release.
- Upgrade every outdated runtime and development dependency to the latest stable version compatible
  with the supported Node.js and peer-dependency contract.
- Define and automate the final pre-1.0 release acceptance checklist while preserving the frozen
  public export surface.

## 0.8.0 - 2026-08-24

- Define the public compatibility and deprecation contract ahead of 1.0.
- Lock documented package subpaths and runtime exports with public API contract tests.
- Validate the complete package suite on Node.js 22 and 24.
- Add `santi-og inspect`, portable inspection APIs, localhost-capable reports, and a hosted checker
  for live metadata, redirects, structured data, and social image responses.
- Exercise pinned remote images in the documentation website build and the portable Next.js locale
  adapter in a real consumer.

## 0.7.0 - 2026-08-24

- Add portable hreflang alternates, locale-matrix helpers, and Next.js language alternate output.
- Add Fetch-compatible runtime image responses for prerendered or on-demand framework routes.
- Add pinned remote preset images with verified content-addressed caching and a typed SVG decoration
  slot for product-specific visuals.
- Add reusable audit config files, `llms.txt` and per-route Markdown auditing, and grouped audit
  summaries.
- Add Event, FAQPage, ImageObject, Offer, and WebPage Schema.org recipes.
- Upgrade nested npm, Yarn, and pnpm workspace manifests in addition to root manifests and pnpm
  catalogs.

## 0.6.0 - 2026-08-24

- Add an official Starlight metadata head adapter with deterministic route-to-image mapping.
- Add opt-in sitemap, robots, hreflang alternate, and redirect audit rules plus the
  `santi-og audit --standards` bundle.

## 0.5.0 - 2026-08-24

- Add `defineSite`, an official Astro metadata head component, deterministic route manifests, and
  built-site metadata/image auditing with human, JSON, and SARIF output.
- Add extensible JSON-LD recipes, arbitrary schema nodes, composition, extension helpers, and safe
  script serialization.
- Add nested content fields, local cover resolution, and declarative pagination and grouped archive
  cards.
- Emit canonical `twitter:url` metadata and expand common final-HTML audit coverage.

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
