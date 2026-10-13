import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./website-inputs.sh', import.meta.url));

const fixture = (context) => {
  const directory = mkdtempSync(join(tmpdir(), 'og-website-inputs-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Workflow test');
  const commit = (file, content) => {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), content);
    git('add', '--', file);
    git('-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'test: change input');
    return git('rev-parse', 'HEAD');
  };
  const compare = (base, head) => spawnSync('bash', [script, base, head], { cwd: directory, encoding: 'utf8' }).status;
  const base = commit('README.md', 'Initial documentation');
  return { commit, compare, base };
};

for (const file of ['apps/web/src/index.astro', 'packages/og/src/index.ts', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', '.npmrc', '.nvmrc', '.github/workflows/ci.yml', '.github/scripts/website-inputs.sh', 'scripts/build.mjs', 'future.config.json']) {
  test(`detects website input ${file}`, (context) => {
    const { commit, compare, base } = fixture(context);
    assert.equal(compare(base, commit(file, 'changed')), 1);
  });
}

for (const file of ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', 'improvement.md', 'improvements.md']) {
  test(`ignores root prose ${file}`, (context) => {
    const { commit, compare, base } = fixture(context);
    assert.equal(compare(base, commit(file, 'updated documentation')), 0);
  });
}

test('a later prose update preserves the pending validated website change', (context) => {
  const { commit, compare, base } = fixture(context);
  const website = commit('apps/web/src/index.astro', 'website A');
  const docs = commit('README.md', 'documentation B');
  assert.equal(compare(base, website), 1);
  assert.equal(compare(website, docs), 0);
  assert.equal(compare(base, docs), 1);
});

test('a later website update prevents an older validated site from replacing it', (context) => {
  const { commit, compare, base } = fixture(context);
  const older = commit('apps/web/src/index.astro', 'website A');
  const newer = commit('apps/web/src/index.astro', 'website B');
  assert.equal(compare(base, newer), 1);
  assert.equal(compare(older, newer), 1);
  assert.equal(compare(newer, newer), 0);
});

test('missing comparison revisions fail closed', (context) => {
  const { compare, base } = fixture(context);
  assert.ok(compare('missing-revision', base) > 1);
});
