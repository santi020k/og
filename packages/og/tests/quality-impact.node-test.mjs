import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

import { gitEnvironment } from '../scripts/ci-scope.mjs'

test('Quality v2 plans transitive consumers and conservative fallbacks', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'og-quality-v2-'))
  const env = gitEnvironment()
  const git = (...args) => execFileSync('git', args, { cwd, env, stdio: 'pipe' }).toString().trim()

  const write = path => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true })

    writeFileSync(join(cwd, path), 'fixture\n')
  }

  const plan = base => JSON.parse(execFileSync(process.env.QUALITY_BINARY || 'quality', ['impact', 'plan', '--base', base, '--head', 'HEAD', '--format', 'json'], { cwd, env, encoding: 'utf8' }))

  try {
    git('init', '-q')

    git('config', 'user.name', 'CI fixture')

    git('config', 'user.email', 'ci@example.test')

    copyFileSync(new URL('../../../quality-impact.json', import.meta.url), join(cwd, 'quality-impact.json'))

    git('add', '.')

    git('commit', '-qm', 'initial policy')

    const all = ['consumers', 'package', 'security', 'website']

    for (const [path, expected] of [
      ['apps/web/src/index.astro', ['package', 'security', 'website']],
      ['packages/og/src/index.ts', all],
      ['pnpm-lock.yaml', all],
      ['unknown.txt', all]
    ]) {
      const base = git('rev-parse', 'HEAD')

      write(path)

      git('add', '.')

      git('commit', '-qm', 'change fixture')

      assert.deepEqual(plan(base).selected.map(node => node.id).sort(), expected, path)
    }

    assert.equal(plan('missing-ref').selected.length, 4)

    const base = git('rev-parse', 'HEAD')

    git('rm', 'packages/og/src/index.ts')

    git('commit', '-qm', 'delete shared source')

    assert.equal(plan(base).selected.length, 4)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('required gate rejects skipped, cancelled and failed validation jobs', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const source = workflow.match(/node --input-type=module -e '([^']+)'/u)?.[1]

  assert.ok(source)

  const names = ['impact', 'validate', 'validate-node-24', 'consumer-smoke']
  const results = Object.fromEntries(names.map(name => [name, { result: 'success' }]))

  const run = value => spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, RESULTS: JSON.stringify(value) }, stdio: 'pipe'
  }).status

  assert.equal(run(results), 0)

  for (const name of names) {
    for (const result of ['skipped', 'cancelled', 'failure']) {
      assert.equal(run({ ...results, [name]: { result } }), 1, `${name}: ${result}`)
    }
  }
})
