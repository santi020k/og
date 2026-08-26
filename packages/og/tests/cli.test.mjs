import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
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

test('comparison thresholds fail missing and dimension-changing outputs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'santi-og-cli-threshold-'))

  try {
    const configPath = path.join(root, 'og.config.mjs')
    const cli = path.resolve('dist/cli.js')

    const config = width => `export default {
  cards: [{ data: { title: 'Threshold' }, output: 'index.svg' }],
  renderer: data => \`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="10">\${data.title}</svg>\`,
}\n`

    await writeFile(configPath, config(10))

    const generated = await run(process.execPath, [cli, 'generate'], root)

    assert.equal(generated.code, 0, generated.stderr)

    await rm(path.join(root, 'public/og/index.svg'))

    const missing = await run(process.execPath, [cli, 'compare', '--threshold', '1'], root)

    assert.equal(missing.code, 1, missing.stderr)

    assert.match(missing.stdout, /missing\s+index\.svg/)

    const regenerated = await run(process.execPath, [cli, 'generate', '--force'], root)

    assert.equal(regenerated.code, 0, regenerated.stderr)

    await writeFile(configPath, config(20))

    const resized = await run(process.execPath, [cli, 'compare', '--threshold', '1'], root)

    assert.equal(resized.code, 1, resized.stderr)

    assert.match(resized.stdout, /changed\s+index\.svg/)
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

    assert.equal(generation.version, '1.1.1')

    assert.equal(generation.total, 2)

    assert.equal(report.logicalCards, 1)

    assert.equal(report.physicalOutputs, 2)

    assert.equal(report.customRenderer, true)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('audits a built site with JSON and SARIF output', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'santi-og-cli-audit-'))

  try {
    const site = path.join(root, 'dist')

    await mkdir(path.join(site, 'og'), { recursive: true })

    await writeFile(
      path.join(site, 'og/index.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" />'
    )

    await writeFile(path.join(site, 'robots.txt'), 'User-agent: *\nSitemap: https://example.com/sitemap.xml\n')

    await writeFile(
      path.join(site, 'sitemap.xml'),
      '<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url></urlset>'
    )

    await writeFile(path.join(site, 'index.html'), `<!doctype html>
<html lang="en"><head>
<title>Example</title>
<meta name="description" content="Example description">
<meta name="robots" content="index, follow">
<link rel="canonical" href="https://example.com/">
<meta property="og:type" content="website">
<meta property="og:title" content="Example">
<meta property="og:description" content="Example description">
<meta property="og:url" content="https://example.com/">
<meta property="og:image" content="https://example.com/og/index.svg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Example card">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:url" content="https://example.com/">
<meta name="twitter:title" content="Example">
<meta name="twitter:description" content="Example description">
<meta name="twitter:image" content="https://example.com/og/index.svg">
<meta name="twitter:image:alt" content="Example card">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite"}</script>
</head><body><h1>Example</h1></body></html>`)

    await writeFile(path.join(root, 'og.audit.config.mjs'), `export default {
  directory: 'dist',
  siteUrl: 'https://example.com',
}
`)

    const cli = path.resolve('dist/cli.js')

    const json = await run(
      process.execPath,
      [
        cli,
        'audit',
        '--root',
        root,
        '--site',
        'dist',
        '--site-url',
        'https://example.com',
        '--standards',
        '--json'
      ],
      root
    )

    const sarif = await run(
      process.execPath,
      [cli, 'audit', '--root', root, '--site', 'dist', '--site-url', 'https://example.com', '--sarif'],
      root
    )

    const configured = await run(process.execPath, [cli, 'audit', '--json'], root)

    assert.equal(json.code, 0, json.stderr)

    assert.equal(sarif.code, 0, sarif.stderr)

    assert.equal(configured.code, 0, configured.stderr)

    assert.equal(JSON.parse(json.stdout).passed, true)

    assert.equal(JSON.parse(sarif.stdout).version, '2.1.0')

    assert.equal(path.basename(JSON.parse(configured.stdout).directory), 'dist')
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('inspects localhost metadata with machine-readable output', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })

    response.end('<!doctype html><html lang="en"><head><title>Local project</title></head><body><h1>Local</h1></body></html>')
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)

    server.listen(0, '127.0.0.1', resolve)
  })

  try {
    const address = server.address()

    assert.ok(address && typeof address !== 'string')

    const result = await run(
      process.execPath,
      [path.resolve('dist/cli.js'), 'inspect', `http://127.0.0.1:${address.port}`, '--json'],
      process.cwd()
    )

    assert.equal(result.code, 1, result.stderr)

    const inspection = JSON.parse(result.stdout)

    assert.equal(inspection.metadata.title, 'Local project')

    assert.equal(inspection.finalUrl, `http://127.0.0.1:${address.port}/`)

    assert.ok(inspection.summary.error > 0)
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

test('upgrades nested workspace manifests, pnpm catalogs, and release-age exclusions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'santi-og-cli-upgrade-'))

  try {
    await writeFile(path.join(root, 'package.json'), `${JSON.stringify({
      devDependencies: { '@santi020k/og': 'catalog:' }
    }, null, 2)}\n`)

    await mkdir(path.join(root, 'apps', 'docs'), { recursive: true })

    await writeFile(path.join(root, 'apps', 'docs', 'package.json'), `${JSON.stringify({
      devDependencies: { '@santi020k/og': '0.3.0' }
    }, null, 2)}\n`)

    await writeFile(path.join(root, 'pnpm-workspace.yaml'), `packages:
  - apps/*
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

    assert.match(await readFile(path.join(root, 'apps', 'docs', 'package.json'), 'utf8'), /"@santi020k\/og": "0\.4\.0"/)

    assert.deepEqual(JSON.parse(result.stdout).changes.map(change => change.file), [
      'apps/docs/package.json',
      'pnpm-workspace.yaml',
      'pnpm-workspace.yaml'
    ])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test('does not add release-age exclusions when the package is absent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'santi-og-cli-upgrade-absent-'))

  try {
    await writeFile(path.join(root, 'package.json'), '{}\n')

    const workspacePath = path.join(root, 'pnpm-workspace.yaml')

    const workspace = `packages: []
minimumReleaseAge: 1440
`

    await writeFile(workspacePath, workspace)

    const result = await run(
      process.execPath,
      [path.resolve('dist/cli.js'), 'upgrade', '--root', root, '--to', '0.4.0'],
      root
    )

    assert.equal(result.code, 1)

    assert.match(result.stderr, /No @santi020k\/og dependency or pnpm catalog entry was found/)

    assert.equal(await readFile(workspacePath, 'utf8'), workspace)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
