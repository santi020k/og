import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  let stdout = ''

  child.stderr.on('data', chunk => {
    stderr += chunk
  })

  child.stdout.on('data', chunk => {
    stdout += chunk
  })

  child.on('error', reject)

  child.on('exit', code => resolve({ code, stderr, stdout }))
})

test('init creates a complete starter config', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'santi-og-cli-'))

  try {
    const result = await run(process.execPath, [path.resolve('dist/cli.js'), 'init'], root)

    assert.equal(result.code, 0, result.stderr)

    assert.match(result.stdout, /Created og\.config\.mjs/)

    assert.match(await readFile(path.join(root, 'og.config.mjs'), 'utf8'), /definePresetConfig/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('version matches the package manifest', async () => {
  const packageManifest = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
  const result = await run(process.execPath, [path.resolve('dist/cli.js'), '--version'], process.cwd())

  assert.equal(result.code, 0, result.stderr)

  assert.equal(result.stdout.trim(), packageManifest.version)
})

test('loads an explicitly requested config file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'santi-og-cli-explicit-'))

  try {
    const configPath = path.join(root, 'cards.mjs')

    await writeFile(configPath, `export default {
  cards: [{ data: { title: 'Explicit' }, output: 'index.svg' }],
  renderer: data => \`<svg>\${data.title}</svg>\`,
}\n`)

    const result = await run(
      process.execPath,
      [path.resolve('dist/cli.js'), 'generate', '--config', configPath],
      root
    )

    assert.equal(result.code, 0, result.stderr)

    assert.equal(await readFile(path.join(root, 'public/og/index.svg'), 'utf8'), '<svg>Explicit</svg>')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('discovers a package-level config shorthand and compares without writing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'santi-og-cli-package-'))

  try {
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ 'santi-og': { config: 'scripts/cards.mjs' } })
    )

    await mkdir(path.join(root, 'scripts'))

    await writeFile(path.join(root, 'scripts/cards.mjs'), `export default {
  cards: [{ data: { title: 'Package' }, output: 'index.svg' }],
  renderer: data => \`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">\${data.title}</svg>\`,
}\n`)

    const cli = path.resolve('dist/cli.js')
    const generated = await run(process.execPath, [cli, 'generate'], root)
    const compared = await run(process.execPath, [cli, 'compare'], root)

    assert.equal(generated.code, 0, generated.stderr)

    assert.equal(compared.code, 0, compared.stderr)

    assert.match(compared.stdout, /identical\s+index\.svg/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('prints machine-readable generation and migration reports', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'santi-og-cli-report-'))

  try {
    const configPath = path.join(root, 'og.config.mjs')

    await writeFile(configPath, `export default {
  cards: [{ data: { title: 'Report' }, formats: ['png'], output: 'index.svg' }],
  renderer: (data, context) => context.format === 'svg' ? \`<svg>\${data.title}</svg>\` : Buffer.from(data.title),
}\n`)

    const cli = path.resolve('dist/cli.js')
    const generated = await run(process.execPath, [cli, 'generate', '--json'], root)
    const migrated = await run(process.execPath, [cli, 'migrate', '--report', '--json'], root)

    assert.equal(generated.code, 0, generated.stderr)

    assert.equal(migrated.code, 0, migrated.stderr)

    const generation = JSON.parse(generated.stdout)
    const report = JSON.parse(migrated.stdout)

    assert.equal(generation.version, '0.4.0')

    assert.equal(generation.total, 2)

    assert.equal(report.logicalCards, 1)

    assert.equal(report.physicalOutputs, 2)

    assert.equal(report.customRenderer, true)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('upgrades pnpm catalogs and release-age exclusions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'santi-og-cli-upgrade-'))

  try {
    await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
      devDependencies: { '@santi020k/og': 'catalog:' }
    }, null, 2)}\n`)

    await writeFile(path.join(root, 'pnpm-workspace.yaml'), `packages: []
minimumReleaseAge: 1440
catalog:
  '@santi020k/og': 0.3.0
`)

    const result = await run(
      process.execPath,
      [path.resolve('dist/cli.js'), 'upgrade', '--root', root, '--to', '0.4.0', '--json'],
      root
    )

    assert.equal(result.code, 0, result.stderr)

    const upgraded = await readFile(path.join(root, 'pnpm-workspace.yaml'), 'utf8')

    assert.match(upgraded, /["']@santi020k\/og["']: 0\.4\.0/)

    assert.match(upgraded, /minimumReleaseAgeExclude:\n {2}- ["']@santi020k\/og["']/)

    assert.match(await readFile(path.join(root, 'package.json'), 'utf8'), /"catalog:"/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
