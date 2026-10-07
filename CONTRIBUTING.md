# Contributing

Install Node.js 22.22.3+ or a compatible Node.js 24 release and pnpm 10.32.1, then run:

```bash
pnpm install
pnpm run validate
```

Keep renderers project-neutral. New behavior should include tests and documentation.

The package runtime remains Node.js 22.18+. Contributor tooling requires the newer patch release.
TypeScript stays on 6.0 because the Astro checker and TypeScript lint tooling do not support 7.0.
Satori 0.36 uses its public CommonJS entry because its ESM WASM loader references `__dirname`.
Scoped workspace overrides patch its compression dependency and the Cloudflare development image
dependency. These overrides do not apply to npm consumers: upstream Satori still pins fflate 0.7.3,
which has a [moderate ZIP64 `unzipSync` advisory](https://github.com/advisories/GHSA-px8p-9vwx-vf98). Satori imports `inflateSync`, so the reported ZIP
extraction path is not used by this adapter. Consumers wanting a clean dependency audit can apply
an equivalent package-manager override to fflate 0.7.5. Recheck upstream metadata before publication;
do not claim the workspace audit establishes a clean consumer audit.

The docs consume Lumen 4 and the shared Santi020k Theme palette with locally served Montserrat.
Keep package presets brand-neutral; site-specific brand artwork belongs in `apps/web/og.config.mjs`.
`pnpm --filter @santi020k/og-web run generate:brand` rebuilds the raster app icons from `icon.svg`.
The website build regenerates icons before OG cards and tracks both source assets in the card cache.
