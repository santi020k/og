# Stability and compatibility

`@santi020k/og` 0.9 is the final acceptance release before 1.0. The 0.8 cycle made the compatibility
boundary explicit; 0.9 verifies that boundary from packed and registry-installed artifacts in real
framework builds before the first stable major.

## Supported runtime

- Node.js 22.18 or newer is required.
- The complete validation suite runs on Node.js 22 and 24.
- The package uses standard `Response` objects for runtime image routes and does not import a web
  framework at runtime.

## Build-time dependency model

The package intentionally ships Sharp, Satori, Resvg, Fontkit, and the bundled Inter font as regular
dependencies. The primary workflow installs `@santi020k/og` as a development dependency, generates
static images before the application build, and deploys only the generated assets. Keeping both
renderers available makes the CLI, presets, and custom-renderer escape hatches work immediately and
avoids optional-native-dependency failures across package managers.

These dependencies do not enter a browser bundle or static deployment unless a consumer imports
the package into its application runtime. A project using on-demand image responses should treat
the renderer and its native binaries as server deployment dependencies.

## Public contract

The subpaths declared in `package.json#exports`, their exported TypeScript declarations, documented
CLI commands, machine-readable JSON output, configuration shapes, cache safety, route-manifest
format, and tracked-only cleanup behavior are the public contract.

From 1.0 onward:

- Removing or incompatibly changing a public export, documented configuration field, manifest
  field, or JSON result field requires a major release.
- New optional fields, new exports, additional diagnostics, and new CLI commands may ship in a
  minor release.
- Fixes that make validation stricter may ship in a minor release when they enforce an already
  documented invariant. Newly introduced policy remains opt-in.
- Deprecated APIs remain available for at least one minor release and include a documented
  migration path before removal in the next major.

The stable package subpaths are:

- `@santi020k/og`
- `@santi020k/og/astro`, `@santi020k/og/astro/head`, and `@santi020k/og/astro/starlight`
- `@santi020k/og/audit`, `@santi020k/og/audit/config`, and `@santi020k/og/audit/rules`
- `@santi020k/og/inspect`
- `@santi020k/og/content`
- `@santi020k/og/locales`
- `@santi020k/og/metadata`, `@santi020k/og/metadata/html`, and
  `@santi020k/og/metadata/next`
- `@santi020k/og/presets`
- `@santi020k/og/runtime`
- `@santi020k/og/schema`
- `@santi020k/og/sharp` and `@santi020k/og/satori`
- `@santi020k/og/site`

## Intentionally outside the compatibility promise

- Files under `dist` that are not reachable through the export map are private.
- Human-readable CLI wording and diagnostic ordering may improve without a major release. Use JSON
  or SARIF output for automation.
- Exact preset pixels are not a semantic-versioning boundary. Rendering changes update the preset
  cache version; consumers requiring visual parity should pin the package and run `santi-og compare`.
- Product copy, brand policy, locale topology, redirects, severity choices, and remote image digests
  remain consumer-owned configuration.

## Before 1.0

The 0.9 cycle keeps the export surface frozen, runs the complete suite on Node.js 22 and 24, and
builds plain Node.js, Astro, and Next.js consumers from both the packed candidate and the published
registry artifact. The hosted checker is protected by application URL policy, same-origin request
validation, Cloudflare rate limiting, and the Workers public-network egress boundary.

The executable acceptance criteria live in [the release checklist](./docs/release-acceptance.md).
Any required breaking correction discovered during this cycle should ship before 1.0 instead of
being carried into the stable contract.
