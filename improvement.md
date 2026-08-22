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

## Findings for a future release

### Preset typography and layout

- Bundle or explicitly configure a portable preset font. The current neutral renderer uses common
  system font names, so exact glyph metrics can vary across operating systems even though output is
  deterministic on the same build image.
- Replace character-count wrapping with glyph-aware measurement for mixed-width scripts and very
  long unbroken tokens. The current wrapper is intentionally small but can leave excess space or
  overflow in unusual languages and code-heavy titles.
- Add narrow extension points for preset decorations. Consumers currently choose a complete preset
  or a complete custom renderer; a safe slot API could cover product screenshots and small diagrams
  without bringing back full SVG templates.

### Content adapters

- Add optional adapters for Astro's generated content metadata and non-file sources such as a CMS.
  The v0.3 helper deliberately reads Markdown/MDX directly so it works without an Astro runtime, but
  consumers with custom slug transforms still need a mapping callback.
- Support explicit include/exclude patterns for mixed content directories. Draft filtering exists,
  but a large collection may also want locale, schema, or directory filters before files are parsed.
- Define remote-image download and cache semantics before supporting HTTP cover images. Local and
  data-URL images are dependable today; silently relying on an SVG implementation to fetch remote
  resources would make builds non-deterministic.

### Migration reporting

- Add a `santi-og migrate --report` command that measures removed consumer files and lines, lists
  remaining custom renderer responsibilities, and flags renderer modules that became unreferenced.
- Let comparison reports accept a visual-difference threshold per card. Preset migrations are
  intentionally redesigns, while custom-renderer migrations often require pixel parity.
