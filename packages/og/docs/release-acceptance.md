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
- npm publication uses GitHub OIDC trusted publishing without a token, includes provenance, and
  is verified from the registry. The package publisher allows direct publishing and matches
  `santi020k/og`, `release.yml`, and environment `release`.
- The website deployment succeeds and the live checker accepts a verified public URL, rejects
  missing or invalid verification, and rejects a private address.
- The matching Git tag and GitHub release are created only after registry verification succeeds.

## Publication and recovery

Open the release branch as a pull request into `main`, resolve review findings, and wait for
required CI and the Node.js 22/24 consumer gates before merging. Dispatch the Release workflow
from `main` with the matching package version; publication is refused from other branches.
Verify that the workflow, npm artifact, tag, and GitHub Release all refer to that merged commit.
The website deployment also runs only from `main`.

A published npm version or Git tag must never be replaced. If package validation fails after
publication, fix forward with a new patch version through the same pull-request and Actions
workflow. If publication has not happened, fix the candidate and rerun the failed workflow.
For a website regression, revert the offending changes through a reviewed pull request into
`main`; the normal deployment workflow restores the previous behavior. Preserve the release
evidence and rerun live metadata, sitemap, and checker smoke checks after recovery.
