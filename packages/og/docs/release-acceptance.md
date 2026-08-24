# Release acceptance

Version 1.0 establishes the stable public contract after the 0.9 validation cycle. The release is
accepted only when every required item below has evidence from the release commit.

## Repository state

- The release branch starts from the latest `main` and contains every unique change from remaining
  local and remote branches.
- The package version, generator version, changelog, documentation, and Release workflow input
  agree on the same SemVer version.
- The public export contract tests show no accidental subpath or root-export changes.
- Dependency manifests and the lockfile use the latest stable releases compatible with Node.js 22,
  Node.js 24, and the declared peer graph. Incompatible next-major tools are not forced into the
  release.

## Automated validation

- `pnpm run validate` passes without lint warnings, TypeScript diagnostics, test failures, spelling
  findings, package-layout findings, or build failures.
- GitHub runs the complete suite on Node.js 22 and 24.
- `pnpm run test:consumers` packs the candidate, installs it without workspace links, renders an
  image in plain Node.js, builds the Astro metadata component, and builds the Next.js metadata
  adapter.
- The Release workflow repeats the consumer suite against the exact package downloaded from npm
  before creating the Git tag and GitHub release.

## Hosted checker

- Requests must originate from the checker site, pass a server-validated single-use Cloudflare
  Turnstile challenge, and target HTTP or HTTPS on a standard port.
- Literal and DNS-resolved private or reserved destinations are rejected before fetch, including
  every redirect and social-image request.
- HTML and image response limits, redirect limits, and a shared timeout bound outbound work.
- The Cloudflare Workers runtime supplies the public-network egress boundary; deployments must not
  add a private-network or VPC binding to the checker.

## Release and deployment

- The packed artifact passes `publint`, contains the documented Astro components and stability
  contract, and exposes only the reviewed package subpaths.
- npm publication uses provenance and is verified from the registry.
- The website deployment succeeds and the live checker accepts a verified public URL, rejects
  missing or invalid verification, and rejects a private address.
- The matching Git tag and GitHub release are created only after registry verification succeeds.
