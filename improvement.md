# Migration learnings

These findings come from migrating Lumen, commitprompt, Cult, PostLens, workspace-organizer,
santi020k-theme, Astro Doctor, eslint-config-basic, santi020k.com, and ContracTrack.

Completed release work is tracked in [`packages/og/CHANGELOG.md`](packages/og/CHANGELOG.md).

## What the consumer migrations taught us

### Share mechanics, preserve product policy

- The best library boundary is repeated mechanics: parsing built HTML, normalizing routes and URLs,
  discovering sitemap files, reading robots directives, resolving image outputs, and formatting
  diagnostics.
- Product copy, locale topology, required robots directives, exclusions, redirects, and severity
  choices remain consumer configuration. Moving those policies into the package would make it
  brand-specific and less reusable.
- A small callback such as `expectedHrefs(page)` can replace a large validator loop without hiding
  the site's localization model.

### Audit the deployed shape, not only source code

- Source components do not prove what crawlers receive. Framework defaults, integrations, and
  rendering order can add, replace, or omit tags, so the reliable boundary is the final built HTML.
- Route manifests connect generation and auditing: they let the audit verify that every declared
  social image exists and that pages reference tracked outputs.
- Site-wide standards do not belong in the per-page audit loop. The `siteRules` extension point
  keeps one HTML parse per page while allowing sitemap, robots, alternate-link, and redirect checks
  to operate on the complete route set.

### Framework adapters should compose with framework output

- The Starlight adapter must preserve `route.head`; replacing it would lose canonical links,
  integration-provided tags, and future framework behavior.
- Framework-specific runtime imports can fail when a package is linked or packed because optional
  peer modules resolve from a different package boundary. The adapter therefore depends on
  Starlight types only and renders the supplied head descriptors itself.
- Framework frontmatter extensions such as `ogImage` and `ogImageAlt` need an explicit consumer
  schema. The adapter can support the fields, but it should not silently redefine the framework's
  content schema.
- Metadata fallbacks must always be useful and non-empty. A deterministic image path is not enough
  if a page can still emit an empty description or inaccessible image text.

### Release and migration discipline matters

- Consumer migrations that import a new public subpath cannot be considered complete while they
  depend on a temporary local link. Publishing first and reinstalling from the registry catches
  missing package files and export-map mistakes.
- `publint`, package packing, type checks, final consumer builds, and registry-resolution checks
  cover different failure modes; none is a complete substitute for the others.
- Version changes must update the generator constant, cache expectations, CLI result tests,
  changelog, documentation examples, and consumer lock files together.
- Package-manager versions are part of the workspace contract. Installing a pnpm 11 workspace with
  a pnpm 10 store can force a modules-directory rebuild even when application code is correct.
- Strict zero-warning linting and spell checking caught real release drift, including stale version
  assertions and undocumented public vocabulary.

### Measured result

- Across the ten migrated projects, the shared library now removes approximately **585 net lines**
  of consumer code compared with the original implementations.
- The 0.6 audit rules and Starlight adapter removed another **62 net lines** after the 0.5 rollout.
- The largest focused reductions are 218 net lines in the PostLens SEO validator, 198 in the
  workspace-organizer validator, and 30 in the eslint-config-basic Starlight head component.
- Line count is only a proxy. The larger benefit is that fixes to URL normalization, crawler-facing
  metadata, sitemap coverage, and diagnostic formatting now happen once and reach every consumer.
