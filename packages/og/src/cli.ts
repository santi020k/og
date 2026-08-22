#!/usr/bin/env node

import { access, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { compare } from './compare.js'
import { generate } from './generate.js'
import type { OgConfig } from './types.js'

const VERSION = '0.2.1'

const CONFIG_NAMES = [
  'og.config.mjs',
  'og.config.js',
  'og.config.ts',
  'scripts/og.config.mjs',
  'scripts/generate-og-images.mjs'
] as const

const toUnknown = (value: unknown): unknown => value

const help = `\
santi-og ${VERSION}

Generate deterministic Open Graph images from a project-owned config.

Usage:
  santi-og generate [options]
  santi-og check [options]
  santi-og compare [options]
  santi-og init [options]

Options:
  --config <path>       Config file or package directory (default: discover config)
  --concurrency <n>     Active renders, or "auto"
  --force               Regenerate every card
  --clean               Remove outputs for cards deleted from the config
  --silent              Hide per-file progress
  --help                Show this help
  --version             Show the version
`

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath)

    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false

    throw error
  }
}

const findConfig = async (requested: string | undefined): Promise<string> => {
  const base = path.resolve(requested ?? '.')

  if (requested) {
    try {
      if ((await stat(base)).isFile()) return base
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return base

      throw error
    }
  }

  for (const name of CONFIG_NAMES) {
    const candidate = path.resolve(base, name)

    if (await exists(candidate)) return candidate
  }

  const packagePath = path.join(base, 'package.json')

  if (await exists(packagePath)) {
    const packageManifest = toUnknown(JSON.parse(await readFile(packagePath, 'utf8')))

    if (typeof packageManifest === 'object' && packageManifest !== null) {
      const configured = (packageManifest as Record<string, unknown>)['santi-og']

      if (typeof configured === 'string') return path.resolve(base, configured)

      if (typeof configured === 'object' && configured !== null && 'config' in configured) {
        const config = (configured as { config?: unknown }).config

        if (typeof config === 'string') return path.resolve(base, config)
      }
    }
  }

  throw new Error('No OG config found. Run "santi-og init" or pass --config.')
}

const loadConfig = async (configPath: string): Promise<OgConfig> => {
  const imported = toUnknown(await import(pathToFileURL(configPath).href))

  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError(`${configPath} must export an OG config.`)
  }

  const namespace = imported as Record<string, unknown>
  const candidate = namespace.default ?? namespace.config

  if (typeof candidate !== 'object' || candidate === null) {
    throw new TypeError(`${configPath} must default-export an OG config.`)
  }

  if (!('cards' in candidate) || !('renderer' in candidate)) {
    throw new TypeError(`${configPath} must define cards and renderer.`)
  }

  const configDirectory = path.dirname(configPath)
  const config = candidate as OgConfig

  return {
    ...config,
    root: path.resolve(configDirectory, config.root ?? '.')
  }
}

const parseConcurrency = (value: string | undefined): number | 'auto' | undefined => {
  if (value === undefined || value === 'auto') return value

  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('--concurrency must be a positive integer or "auto".')
  }

  return parsed
}

const initialConfig = `\
import { defineConfig } from '@santi020k/og'
import { createSharpRenderer } from '@santi020k/og/sharp'

const escapeXml = value => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

const cards = [
  {
    data: {
      description: 'A project with deterministic social cards.',
      title: 'My project',
    },
    output: 'index.webp',
  },
]

export default defineConfig({
  cards,
  clean: true,
  renderer: createSharpRenderer({
    renderSvg: ({ description, title }, { height, width }) => \`\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \${width} \${height}">
  <rect width="100%" height="100%" fill="#111827"/>
  <text x="72" y="260" fill="#ffffff" font-family="Arial, sans-serif" font-size="72" font-weight="700">\${escapeXml(title)}</text>
  <text x="76" y="330" fill="#cbd5e1" font-family="Arial, sans-serif" font-size="30">\${escapeXml(description)}</text>
</svg>\`,
    webp: { quality: 86 },
  }),
})
`

interface GenerationCommandOptions {
  clean: boolean
  concurrency: string | undefined
  config: string | undefined
  force: boolean | undefined
  silent: boolean
}

const initialize = async (requestedConfig: string | undefined): Promise<void> => {
  const configPath = path.resolve(requestedConfig ?? CONFIG_NAMES[0])

  if (await exists(configPath)) throw new Error(`${configPath} already exists.`)

  await writeFile(configPath, initialConfig)

  process.stdout.write(`Created ${path.relative(process.cwd(), configPath)}\n`)
}

const reportCheck = (stale: readonly string[], total: number): void => {
  if (stale.length > 0) {
    process.stderr.write(`${stale.length} OG image(s) are stale or missing.\n`)

    process.exitCode = 1

    return
  }

  process.stdout.write(`All ${total} OG image(s) are current.\n`)
}

const executeGeneration = async (
  command: string,
  commandOptions: GenerationCommandOptions
): Promise<void> => {
  const configPath = await findConfig(commandOptions.config)
  const configContents = await readFile(configPath, 'utf8')
  const loaded = await loadConfig(configPath)
  const config = commandOptions.clean ? { ...loaded, clean: true } : loaded
  const concurrency = parseConcurrency(commandOptions.concurrency)

  if (command === 'compare') {
    const comparisons = await compare(config, {
      configFingerprint: configContents,
      ...(concurrency === undefined ? {} : { concurrency })
    })

    for (const comparison of comparisons) {
      const actual = `${comparison.actual.width ?? '?'}x${comparison.actual.height ?? '?'} ${comparison.actual.format ?? 'unknown'} ${comparison.actual.bytes} B`
      const expected = comparison.expected ? `, previous ${comparison.expected.bytes} B` : ''

      const pixels = comparison.pixelDifference ?
        `, pixels ${comparison.pixelDifference.different}/${comparison.pixelDifference.total} (${(comparison.pixelDifference.ratio * 100).toFixed(4)}%)` :
        ''

      process.stdout.write(`  ${comparison.status.padEnd(9)} ${comparison.output}: ${actual}${expected}${pixels}\n`)
    }

    return
  }

  const result = await generate(config, {
    check: command === 'check',
    configFingerprint: configContents,
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(commandOptions.force === undefined ? {} : { force: commandOptions.force }),
    ...(commandOptions.silent ?
      {} :
      {
        onEvent: event => {
          process.stdout.write(`  ${event.type.padEnd(5)} ${event.output}\n`)
        }
      })
  })

  if (command === 'check') {
    reportCheck(result.stale, result.total)

    return
  }

  process.stdout.write(
    `Generated ${result.generated.length}, skipped ${result.skipped.length}, cleaned ${result.cleaned.length}.\n`
  )
}

const run = async (): Promise<void> => {
  const parsed = parseArgs({
    allowPositionals: true,
    options: {
      clean: { type: 'boolean' },
      concurrency: { type: 'string' },
      config: { short: 'c', type: 'string' },
      force: { short: 'f', type: 'boolean' },
      help: { short: 'h', type: 'boolean' },
      silent: { short: 's', type: 'boolean' },
      version: { short: 'v', type: 'boolean' }
    },
    strict: true
  })

  if (parsed.values.help) {
    process.stdout.write(help)

    return
  }

  if (parsed.values.version) {
    process.stdout.write(`${VERSION}\n`)

    return
  }

  const command = parsed.positionals[0] ?? 'generate'

  if (!['check', 'compare', 'generate', 'init'].includes(command)) {
    throw new Error(`Unknown command: ${command}`)
  }

  if (command === 'init') {
    await initialize(parsed.values.config)

    return
  }

  await executeGeneration(command, {
    clean: parsed.values.clean ?? false,
    concurrency: parsed.values.concurrency ?? process.env.OG_WORKER_THREADS,
    config: parsed.values.config,
    force: parsed.values.force ?? process.env.FORCE_OG === '1',
    silent: parsed.values.silent ?? false
  })
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)

  process.stderr.write(`santi-og: ${message}\n`)

  process.exitCode = 1
})
