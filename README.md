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
