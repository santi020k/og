# AI Working Guide

`@santi020k/og` is a renderer-agnostic Open Graph image generator. Keep the orchestration core
independent from any product brand or framework.

- Public types and generation behavior live in `src`.
- Sharp and Satori integrations live behind the `@santi020k/og/sharp` and
  `@santi020k/og/satori` exports.
- Project-specific content discovery, copy, assets, and card design belong in consumer configs.
- Preserve deterministic output, path traversal protection, content-aware caching, and tracked-only
  cleanup.
- Add tests for public behavior changes and update the README or migration guide for user-facing API
  changes.
- Run `pnpm run validate` before handoff. Treat every lint warning and TypeScript diagnostic as a
  failure to resolve.
