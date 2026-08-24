# Parent-project audit, learnings, and next improvements

This document records the August 24, 2026 audit of every sibling directory under
`Projects/santi020k` and the resulting `@santi020k/og` 0.7 work. The historical release and
migration notes remain in `improvement.md`; this file focuses on the latest full parent-folder
review requested for 0.7.

## Audit coverage

The audit covered 24 sibling directories, including package manifests, workspace catalogs, Open
Graph generators, metadata layouts, structured data, SEO validators, dynamic image endpoints, and
AI-readable documentation outputs.

- Existing library adopters: ContracTrack, Astro Doctor, commitprompt, Cult, eslint-config-basic,
  Lumen, PostLens, santi020k-theme, santi020k.com (`website`), and workspace-organizer.
- Projects with independent Open Graph or metadata implementations: aaronmgz, Coolstead, Dep
  Beacon, Difftale, Fenix, the `lumen-production-cleanup` worktree, memudo.ai, Quality, and Roadscore.
- Directories without a relevant website image pipeline: `_to_delete`, extensions, homebrew-tap,
  observatory, and santi020k-way. Observatory catalogs the package but does not consume its image or
  metadata APIs.

## What was implemented in 0.7

- Portable hreflang page alternates and Next.js `alternates.languages` output.
- Locale-matrix helpers that derive metadata and audit expectations from the same route topology.
- Fetch-compatible runtime image responses for Astro endpoints and other standards-based runtimes.
- Pinned remote preset images with SHA-256 verification, size and timeout limits, atomic writes, and
  content-addressed local caching.
- A typed trusted SVG decoration slot for retaining preset typography and layout while adding a
  product-specific diagram or visual.
- Reusable `og.audit.config.*` files so local and CI audits share project policy.
- `llms.txt`, compatibility-copy, per-route Markdown, and `llms-full.txt` coverage auditing.
- Audit summaries grouped by shared issue code and severity.
- Event, FAQPage, ImageObject, Offer, and WebPage Schema.org recipes in addition to the existing
  open recipe mechanism.
- Workspace-aware upgrades across root and nested npm, Yarn, and pnpm manifests plus pnpm catalogs.

## What the sibling projects taught us

### Static generation and runtime rendering need the same renderer contract

Most projects generate cards before a framework build, while aaronmgz prerenders an Astro image
endpoint. Both paths use the same data-to-bytes operation. The reusable boundary is therefore a
standards-based response helper around `OgRenderer`, not an Astro-only endpoint abstraction.

### Localization needs one route matrix

aaronmgz and memudo.ai repeat canonical, hreflang, locale, and route-prefix logic. Metadata and
auditing drift when each surface rebuilds that matrix independently. Locale helpers now accept both
neutral and already-localized routes and feed portable HTML, Next.js metadata, and built-site audit
expectations.

### Remote images are safe only when content is pinned

CMS-friendly remote covers are useful, but fetching an unversioned URL during a build breaks
determinism and caching. A URL, MIME type, and expected SHA-256 digest make the remote input an
explicit build dependency. The verified bytes can then be cached and embedded like a local asset.

### Presets need narrow composition, not unlimited templating

Quality and several product sites keep bespoke diagrams while repeating typography, background,
and card framing. A single trusted SVG visual slot covers that case without turning the preset API
into a general template engine or moving product branding into the core package.

### Audits should cover crawler and agent-facing artifacts

Quality validates `llms.txt`, a singular compatibility copy, route Markdown, and a full aggregate in
the same post-build script as social metadata. These files are part of the deployed documentation
contract. A site-wide audit rule consolidates the mechanics while callbacks retain each project's
route-to-Markdown policy.

### Workspace upgrades must follow declared workspace topology

Several consumers place `@santi020k/og` only in nested app manifests. Scanning declared npm/Yarn
workspaces and pnpm package patterns is more accurate than recursively rewriting every
`package.json`, avoids examples and excluded workspaces, and keeps the reported changed file paths
reviewable.

## Possible next improvements

- Add ETag generation and conditional-request helpers to runtime responses when multiple consumers
  repeat that policy; cache-control remains caller-configurable today.
- Parse Markdown links structurally in the llms audit instead of using exact substring checks, and
  optionally validate outbound links without making network access part of the default audit.
- Add a generated JSON Schema for `og.config.*` and `og.audit.config.*` after the public contracts
  stabilize, enabling editor completion without importing the package.
- Extend the preset visual slot only from repeated consumer evidence—for example, a separately
  clipped screenshot slot or small badge row—rather than exposing arbitrary layout internals.
- Add an offline-only remote-image mode and an explicit cache-pruning command that removes only
  content-addressed files no longer referenced by current configs.
- Add an adoption-report command that inventories sibling or workspace projects, distinguishes
  shared mechanics from retained product policy, and measures generated cards, audited routes, and
  removable orchestration without mutating consumers.
- Migrate Quality next: its generator maps directly to custom preset decoration plus content cards,
  and its SEO/AI-resource validator is now largely covered by the audit APIs.
- Evaluate aaronmgz as the first runtime-response adopter and memudo.ai as the first full Next.js
  locale-metadata adopter before adding framework-specific runtime adapters.
- Keep single-image product sites such as Coolstead, Difftale, Fenix, and Roadscore on simple static
  assets unless per-route cards or repeated validation provide enough value to justify adoption.
