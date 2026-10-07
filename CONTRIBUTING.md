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

The docs retain OG’s mint-green palette with Lumen 4 and shared Santi020k typography, using locally
served Montserrat. Navigation follows the website’s inset ribbon reference (option 3), with an
attached keyboard-accessible menu on mobile. Light mode uses deeper green accents for contrast.
Keep package presets brand-neutral; site-specific brand artwork belongs in `apps/web/og.config.mjs`.
`pnpm --filter @santi020k/og-web run generate:brand` rebuilds the raster app icons from `icon.svg`.
The website build regenerates icons before OG cards and tracks both source assets in the card cache.

Website page definitions live in `apps/web/site.mjs`. They drive titles, descriptions, route-specific
social cards, schema requirements, and the generated route manifest. The head consumes fingerprinted
manifest URLs so regenerated cards get new public URLs. Gallery examples remain separate.
Every website build runs `audit:site` against final HTML, sitemap, robots, unique images, and the
manifest before compiling the Cloudflare function. Public build variables participate in Turbo
cache keys. Recheck rendered docs anchors, reduced motion, and back-to-top after navigation edits.

Cloudflare Pages serves directory routes with a trailing slash. Keep Astro's trailing-slash policy,
shared page definitions, and internal links aligned. The website audit additionally requires an
exact canonical match to each built HTML route; normalized route coverage alone misses this issue.
The release job pins npm 12.2.0 (compatible with its Node.js 22 runtime) so pnpm 10's publishing
client can use an existing npm trusted publisher, with the current token as fallback.
