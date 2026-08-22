# @santi020k/og

Deterministic Open Graph image generation that keeps your brand, content model, and renderer in
your project.

[Website](https://og.santi020k.com) ·
[npm](https://www.npmjs.com/package/@santi020k/og) ·
[Package guide](packages/og/README.md) ·
[Releases](https://github.com/santi020k/og/releases) ·
[Issues](https://github.com/santi020k/og/issues) ·
[Contributing](CONTRIBUTING.md)

[![CI](https://github.com/santi020k/og/actions/workflows/ci.yml/badge.svg)](https://github.com/santi020k/og/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@santi020k/og.svg)](https://www.npmjs.com/package/@santi020k/og)
[![npm downloads](https://img.shields.io/npm/dm/@santi020k/og.svg)](https://www.npmjs.com/package/@santi020k/og)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Use `@santi020k/og` with Astro, Next.js, plain Node.js, monorepos, Markdown collections, CMS data,
or a static array. You supply the cards and renderer; the package handles output paths,
content-aware caching, bounded concurrency, safe cleanup, encoding, and CI verification.

## Quick start

```bash
pnpm add -D @santi020k/og
pnpm exec santi-og init
pnpm exec santi-og generate
```

The generated `og.config.mjs` is a complete SVG-to-WebP example. Replace its card data and SVG
with your project content and visual identity. See the [package guide](packages/og/README.md) for
configuration, Satori, static assets, worker threads, caching, cleanup, and migration guidance.

## Workspace

| Workspace | Purpose | Destination |
| --- | --- | --- |
| [`packages/og`](packages/og) | Publishable generator, CLI, renderers, and programmatic API | [npm](https://www.npmjs.com/package/@santi020k/og) · [Package guide](packages/og/README.md) |
| [`apps/web`](apps/web) | Astro website, branding, metadata, and social card | [Website](https://og.santi020k.com) |

## Development

```bash
pnpm install
pnpm dev
```

Run the complete package and website quality suite before shipping:

```bash
pnpm validate
```

## Deployment and release

The static website deploys to the `santi020k-og` Cloudflare Pages project when changes reach
`main`. GitHub uses the `website-production` environment, the `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` secrets, and these repository variables:

- `CLOUDFLARE_PAGES_PROJECT_NAME=santi020k-og`
- `PUBLIC_SITE_URL=https://og.santi020k.com`

Package releases are deliberate. Run the **Release** GitHub workflow with a version matching
`packages/og/package.json`. The `release` environment must provide `NPM_TOKEN`; the workflow
validates the repository, publishes with npm provenance, verifies the registry result, and then
creates the matching Git tag and GitHub release.

## License

MIT. See [LICENSE](LICENSE).
