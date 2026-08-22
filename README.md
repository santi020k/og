# @santi020k/og

A Turborepo workspace for the renderer-agnostic Open Graph image generator and its website.

## Workspace

- [`packages/og`](packages/og) contains the publishable `@santi020k/og` package.
- [`apps/web`](apps/web) contains the Astro website and owns its branding, metadata, and social card.

## Development

```bash
pnpm install
pnpm dev
```

Run the complete package and website quality suite before shipping:

```bash
pnpm validate
```
