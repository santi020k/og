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

<!-- santi020k-quality-policy:start -->
## ESLint and TypeScript quality policy

- Treat every ESLint warning and TypeScript diagnostic as work to resolve, not successful output.
- Run the repository's canonical lint and type-check commands before handoff. Use
  `--max-warnings=0` for every direct ESLint command, including workspace scripts and
  `lint-staged`; never use `--quiet` to hide warnings.
- Fix the underlying implementation. Do not lower rule severity, widen ignores, or add
  `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `any`, unsafe casts, or non-null assertions
  merely to make a check pass.
- A narrow suppression is acceptable only when the root cause cannot be fixed safely. Explain why,
  scope it to the smallest surface, and leave a tracking path.
- Fix all safe and feasible diagnostics you encounter, including pre-existing ones exposed by the
  work. Never finish while feasible warnings or type errors remain.
- If an external or unrelated blocker cannot be resolved safely, report the exact command, file,
  and diagnostic instead of hiding it.
- Do not add ESLint or TypeScript to a repository that does not use that toolchain solely for
  uniformity; apply this policy when that toolchain exists or is introduced for project reasons.
<!-- santi020k-quality-policy:end -->
