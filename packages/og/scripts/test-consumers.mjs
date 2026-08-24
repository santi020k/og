import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const requestedVersionIndex = process.argv.indexOf('--version')
const requestedVersion = requestedVersionIndex >= 0 ? process.argv[requestedVersionIndex + 1] : undefined

if (requestedVersionIndex >= 0 && !requestedVersion) {
  throw new Error('Pass a package version after --version.')
}

const run = (command, arguments_, directory, environment = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, arguments_, {
    cwd: directory,
    env: { ...process.env, ...environment },
    stdio: 'inherit'
  })

  child.once('error', reject)

  child.once('exit', code => code === 0 ?
    resolve() :
    reject(new Error(
      `${command} ${arguments_.join(' ')} exited with code ${code ?? 'unknown'}.`
    )))
})

const writeJson = (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`)

const installAndBuild = async (directory, manifest, files, environment = {}) => {
  await mkdir(directory, { recursive: true })

  await writeJson(path.join(directory, 'package.json'), manifest)

  await Promise.all(Object.entries(files).map(async ([relativePath, source]) => {
    const destination = path.join(directory, relativePath)

    await mkdir(path.dirname(destination), { recursive: true })

    await writeFile(destination, source)
  }))

  await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel', 'error'], directory)

  await run('npm', ['run', 'build'], directory, environment)
}

const root = await mkdtemp(path.join(tmpdir(), 'santi-og-consumers-'))

try {
  let packageSource = requestedVersion

  if (!packageSource) {
    const artifacts = path.join(root, 'artifacts')

    await mkdir(artifacts)

    await run('npm', ['pack', '--ignore-scripts', '--pack-destination', artifacts], process.cwd())

    const archives = (await readdir(artifacts)).filter(file => file.endsWith('.tgz'))

    assert.equal(archives.length, 1, 'Expected one packed @santi020k/og artifact.')

    packageSource = `file:${path.join(artifacts, archives[0])}`
  }

  const plainDirectory = path.join(root, 'plain-node')

  await installAndBuild(plainDirectory, {
    dependencies: { '@santi020k/og': packageSource },
    private: true,
    scripts: { build: 'node index.mjs' },
    type: 'module'
  }, {
    'index.mjs': `import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { generate } from '@santi020k/og'
import { createMetaTags, definePageMetadata } from '@santi020k/og/metadata'
import { definePresetConfig } from '@santi020k/og/presets'

const page = definePageMetadata({
  description: 'Registry-installed plain Node consumer.',
  image: { alt: 'Consumer card', output: 'index.webp' },
  pathname: '/',
  title: 'Plain Node consumer'
})

assert.ok(createMetaTags(page, { siteUrl: 'https://example.com' }).length > 10)

await generate(definePresetConfig({
  cards: [{ data: { description: page.description, title: page.title }, output: 'index.webp' }],
  outputDirectory: 'public/og',
  preset: { brand: { name: 'Consumer' } }
}))

await access('public/og/index.webp')
`
  })

  const astroDirectory = path.join(root, 'astro')

  await installAndBuild(astroDirectory, {
    dependencies: {
      '@santi020k/og': packageSource,
      astro: '7.2.5'
    },
    private: true,
    scripts: { build: 'astro build' },
    type: 'module'
  }, {
    'src/pages/index.astro': `---
import MetadataHead from '@santi020k/og/astro/head'
import { definePageMetadata } from '@santi020k/og/metadata'

const page = definePageMetadata({
  description: 'Registry-installed Astro consumer.',
  pathname: '/',
  title: 'Astro consumer'
})
---
<!doctype html>
<html lang="en">
  <head><MetadataHead page={page} site={{ siteUrl: 'https://example.com' }} /></head>
  <body><main><h1>{page.title}</h1></main></body>
</html>
`
  })

  assert.match(await readFile(path.join(astroDirectory, 'dist/index.html'), 'utf8'), /Astro consumer/u)

  const nextDirectory = path.join(root, 'next')

  await installAndBuild(nextDirectory, {
    dependencies: {
      '@santi020k/og': packageSource,
      next: '16.3.2',
      react: '19.2.8',
      'react-dom': '19.2.8'
    },
    private: true,
    scripts: { build: 'next build' },
    type: 'module'
  }, {
    'app/layout.js': `import React from 'react'

export default function RootLayout({ children }) {
  return React.createElement('html', { lang: 'en' }, React.createElement('body', null, children))
}
`,
    'app/page.js': `import { definePageMetadata } from '@santi020k/og/metadata'
import { toNextMetadata } from '@santi020k/og/metadata/next'
import React from 'react'

const page = definePageMetadata({
  description: 'Registry-installed Next.js consumer.',
  pathname: '/',
  title: 'Next.js consumer'
})

export const metadata = toNextMetadata(page, { siteUrl: 'https://example.com' })

export default function Page() {
  return React.createElement('main', null, React.createElement('h1', null, page.title))
}
`
  }, { NEXT_TELEMETRY_DISABLED: '1' })

  await readFile(path.join(nextDirectory, '.next/BUILD_ID'), 'utf8')

  process.stdout.write(`Consumer smoke tests passed for ${requestedVersion ?? 'the packed release candidate'}.\n`)
} finally {
  await rm(root, { force: true, recursive: true })
}
