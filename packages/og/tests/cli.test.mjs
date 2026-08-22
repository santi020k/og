import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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

    assert.match(await readFile(path.join(root, 'og.config.mjs'), 'utf8'), /createSharpRenderer/)
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
