import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { classifyPaths, gitEnvironment, planScope } from '../scripts/ci-scope.mjs'

test('only website changes use the web task graph', () => {
  for (const paths of [['apps/web/src/pages/docs.astro'], ['apps/web/tests/navigation.spec.ts'], ['apps/web/functions/api/inspect.ts']]) {
    assert.deepEqual(classifyPaths(paths), { mode: 'affected', web: true, package: false })
  }

  for (const paths of [[], ['packages/og/src/index.ts'], ['apps/web/package.json'], ['apps/web/astro.config.mjs'], ['scripts/check.mjs'], ['unknown.txt'], ['pnpm-lock.yaml'], ['.changeset/config.json']]) {
    assert.deepEqual(classifyPaths(paths), { mode: 'full', web: true, package: true })
  }
})

test('release, push, dispatch and uncertain history retain full validation', () => {
  for (const env of [{ GITHUB_HEAD_REF: 'release/v1.2.0' }, { GITHUB_HEAD_REF: 'changeset-release/main' }, { GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }]) {
    assert.equal(planScope({ base: 'HEAD', env }).mode, 'full')
  }

  assert.equal(planScope({ base: 'missing', env: {} }).mode, 'full')

  assert.equal(planScope({ base: 'HEAD', full: true, env: {} }).mode, 'full')
})

test('real Git history includes both rename sides, deletions and local files', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'og-ci-scope-'))
  const env = { ...gitEnvironment(), GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'ci/fixture' }
  const git = (...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' })

  const write = (path, content) => {
    mkdirSync(join(cwd, path, '..'), { recursive: true })

    writeFileSync(join(cwd, path), content)
  }

  try {
    git('init', '-q', '-b', 'main')

    git('config', 'user.name', 'CI fixture')

    git('config', 'user.email', 'ci@example.test')

    write('apps/web/src/deleted.astro', '<p>Original</p>')

    write('packages/og/src/moved.ts', '// Original')

    git('add', '.')

    git('commit', '-qm', 'fixture')

    git('branch', 'feature')

    write('unrelated-base-file', 'base only')

    git('add', '.')

    git('commit', '-qm', 'base')

    git('switch', 'feature')

    git('rm', 'apps/web/src/deleted.astro')

    git('commit', '-qm', 'remove website')

    const poisoned = { ...env, GIT_DIR: '/missing', GIT_WORK_TREE: '/missing' }

    assert.equal(planScope({ cwd, base: 'main', env: poisoned }).mode, 'affected')

    write('apps/web/src/ leading\nname.astro', '<p>New</p>')

    assert.equal(planScope({ cwd, base: 'main', env }).mode, 'affected')

    write('local-config.json', '{}')

    assert.equal(planScope({ cwd, base: 'main', env }).mode, 'full')

    git('add', 'local-config.json')

    assert.equal(planScope({ cwd, base: 'main', env }).mode, 'full')

    const head = git('rev-parse', 'HEAD').toString().trim()

    assert.equal(planScope({ cwd, base: 'main', head, env }).mode, 'affected')

    git('rm', '--cached', 'local-config.json')

    git('mv', 'packages/og/src/moved.ts', 'apps/web/src/moved.ts')

    git('commit', '-qm', 'move package source into docs')

    assert.equal(planScope({ cwd, base: 'main', head: git('rev-parse', 'HEAD').toString().trim(), env }).mode, 'full')
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('web validation tracks package build inputs in its task cache', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url))
  const cwd = mkdtempSync(join(tmpdir(), 'og-ci-cache-'))
  const env = gitEnvironment()
  const git = (...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' })

  try {
    for (const path of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', 'apps/web/package.json', 'packages/og/package.json', 'packages/og/src/version.ts', '.github/workflows/ci.yml', '.github/workflows/release.yml', 'cspell.config.yaml', 'quality-impact.json']) {
      mkdirSync(join(cwd, path, '..'), { recursive: true })

      writeFileSync(join(cwd, path), readFileSync(join(root, path)))
    }

    git('init', '-q', '-b', 'main')

    git('config', 'user.name', 'CI fixture')

    git('config', 'user.email', 'ci@example.test')

    git('add', '.')

    git('commit', '-qm', 'fixture')

    const graph = (runtime = 'node22-pnpm10-linux-x64') => JSON.parse(execFileSync(join(root, 'node_modules/.bin/turbo'), ['run', 'ci:web', 'validate', 'test', '--dry=json'], {
      cwd, env: { ...env, QUALITY_TASK_RUNTIME: runtime }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    }))

    const websiteTask = result => result.tasks.find(task => task.taskId === '@santi020k/og-web#ci:web')
    const before = websiteTask(graph())

    assert.deepEqual(before.dependencies, ['@santi020k/og#build'])

    writeFileSync(join(cwd, 'packages/og/src/version.ts'), 'export const GENERATOR_VERSION = \'changed\';\n')

    assert.notEqual(websiteTask(graph()).hash, before.hash)

    const identities = result => new Map(result.tasks.map(task => [task.taskId, task.hash]))
    let previous = identities(graph())

    for (const path of ['.github/workflows/ci.yml', '.github/workflows/release.yml', 'cspell.config.yaml', 'quality-impact.json']) {
      writeFileSync(join(cwd, path), `${readFileSync(join(cwd, path), 'utf8')}\n`)

      const changed = identities(graph())

      for (const [id, hash] of changed) assert.notEqual(hash, previous.get(id), `${path}: ${id}`)

      previous = changed
    }

    for (const [id, hash] of identities(graph('node24-pnpm10-linux-x64'))) {
      assert.notEqual(hash, previous.get(id), `runtime: ${id}`)
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('every cached workflow exports the actual runtime before using Turbo', () => {
  for (const file of ['ci.yml', 'release.yml', 'deploy-web.yml', 'site-inspection.yml']) {
    const source = readFileSync(new URL(`../../../.github/workflows/${file}`, import.meta.url), 'utf8')
    const setups = source.split('uses: santi020k/quality/actions/setup-pnpm@').slice(1)

    assert.ok(setups.length > 0, file)

    for (const setup of setups) {
      assert.match(setup, /QUALITY_TASK_RUNTIME=\$\(node --version\)-\$\(pnpm --version\)-/u, file)

      assert.match(setup, /node -p 'process.platform \+ "\/" \+ process.arch'\)" >> "\$GITHUB_ENV"/u, file)
    }
  }
})
