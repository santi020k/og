#!/usr/bin/env node

import { access, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { auditSite, auditToSarif } from './audit.js'
import { standardAuditRules } from './audit-rules.js'
import { compare } from './compare.js'
import { generate } from './generate.js'
import { createMigrationReport } from './report.js'
import type { OgConfig } from './types.js'
import { upgradeProject } from './upgrade.js'
import { GENERATOR_VERSION } from './version.js'

const VERSION = GENERATOR_VERSION

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
  santi-og audit --site <directory> [options]
  santi-og init [options]
  santi-og migrate --report [options]
  santi-og upgrade [options]

Options:
  --config <path>       Config file or package directory (default: discover config)
  --concurrency <n>     Active renders, or "auto"
  --force               Regenerate every card
  --clean               Remove outputs for cards deleted from the config
  --silent              Hide per-file progress
  --json                Print a machine-readable JSON result
  --sarif               Print SEO audit findings as SARIF
  --site <directory>    Built site directory audited by the audit command
  --site-url <url>      Public site URL used to resolve canonical and image URLs
  --manifest <path>     Generated OG route manifest checked by the audit command
  --max-image-bytes <n> Fail social images larger than this byte count
  --unique-images       Require distinct social-image bytes for every route
  --standards           Audit sitemap, robots, hreflang alternates, and redirects
  --threshold <ratio>   Maximum changed-pixel ratio accepted by compare
  --report              Analyze a config without changing consumer code
  --root <path>         Project root for upgrade (default: current directory)
  --to <version>        Upgrade target (default: this CLI version)
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
import { definePresetConfig } from '@santi020k/og/presets'

const cards = [
  {
    data: {
      description: 'A project with deterministic social cards.',
      title: 'My project',
    },
    output: 'index.webp',
  },
]

export default definePresetConfig({
  cards,
  clean: true,
  preset: {
    brand: { domain: 'example.com', name: 'My project' },
    variant: 'product',
  },
})
`

interface GenerationCommandOptions {
  clean: boolean
  concurrency: string | undefined
  config: string | undefined
  force: boolean | undefined
  json: boolean
  silent: boolean
  threshold: string | undefined
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
    const threshold = commandOptions.threshold === undefined ? undefined : Number(commandOptions.threshold)

    if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
      throw new Error('--threshold must be a ratio between 0 and 1.')
    }

    const comparisons = await compare(config, {
      configFingerprint: configContents,
      ...(concurrency === undefined ? {} : { concurrency })
    })

    const exceedsThreshold = threshold !== undefined && comparisons.some(comparison => (
      comparison.status !== 'identical' && (
        comparison.pixelDifference === undefined || comparison.pixelDifference.ratio > threshold
      )
    ))

    if (commandOptions.json) {
      process.stdout.write(`${JSON.stringify({ command, comparisons, version: VERSION }, null, 2)}\n`)

      if (threshold !== undefined && exceedsThreshold) process.exitCode = 1

      return
    }

    for (const comparison of comparisons) {
      const actual = `${comparison.actual.width ?? '?'}x${comparison.actual.height ?? '?'} ${comparison.actual.format ?? 'unknown'} ${comparison.actual.bytes} B`
      const expected = comparison.expected ? `, previous ${comparison.expected.bytes} B` : ''

      const pixels = comparison.pixelDifference ?
        `, pixels ${comparison.pixelDifference.different}/${comparison.pixelDifference.total} (${(comparison.pixelDifference.ratio * 100).toFixed(4)}%)` :
        ''

      process.stdout.write(`  ${comparison.status.padEnd(9)} ${comparison.output}: ${actual}${expected}${pixels}\n`)
    }

    if (threshold !== undefined && exceedsThreshold) process.exitCode = 1

    return
  }

  const result = await generate(config, {
    check: command === 'check',
    configFingerprint: configContents,
    ...(concurrency === undefined ? {} : { concurrency }),
    ...(commandOptions.force === undefined ? {} : { force: commandOptions.force }),
    ...(commandOptions.silent || commandOptions.json ?
      {} :
      {
        onEvent: event => {
          process.stdout.write(`  ${event.type.padEnd(5)} ${event.output}\n`)
        }
      })
  })

  if (command === 'check') {
    if (commandOptions.json) {
      process.stdout.write(`${JSON.stringify({ command, config: configPath, ...result }, null, 2)}\n`)

      if (result.stale.length > 0) process.exitCode = 1

      return
    }

    reportCheck(result.stale, result.total)

    return
  }

  if (commandOptions.json) {
    process.stdout.write(`${JSON.stringify({ command, config: configPath, ...result }, null, 2)}\n`)
  } else {
    process.stdout.write(
      `Generated ${result.generated.length}, skipped ${result.skipped.length}, cleaned ${result.cleaned.length} ` +
      `in ${Math.round(result.elapsedMilliseconds)}ms (generator ${result.version}${result.cacheKey ? `, ${result.cacheKey}` : ''}).\n`
    )
  }
}

const executeMigrationReport = async (requestedConfig: string | undefined, json: boolean): Promise<void> => {
  const configPath = await findConfig(requestedConfig)
  const configContents = await readFile(configPath, 'utf8')
  const config = await loadConfig(configPath)
  const report = await createMigrationReport({ config, configContents, configPath })

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

    return
  }

  process.stdout.write(`Migration report for ${path.relative(process.cwd(), report.config)}\n`)

  process.stdout.write(`  ${report.logicalCards} logical card(s), ${report.physicalOutputs} physical output(s)\n`)

  const renderer = report.customRenderer ? 'custom renderer' : report.cacheKey ?? 'preset renderer'

  process.stdout.write(`  ${report.configLines} config line(s), ${renderer}\n`)

  report.recommendations.forEach(recommendation => process.stdout.write(`  - ${recommendation}\n`))
}

const executeUpgrade = async (root: string | undefined, version: string | undefined, json: boolean): Promise<void> => {
  const result = await upgradeProject({ ...(root ? { root } : {}), version: version ?? VERSION })

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)

    return
  }

  process.stdout.write(`Updated @santi020k/og to ${result.version} for ${result.packageManager}.\n`)

  result.changes.forEach(change => process.stdout.write(`  ${change.file}: ${change.from} -> ${change.to}\n`))

  process.stdout.write(`Run ${result.packageManager} install to refresh the lockfile.\n`)
}

const executeAudit = async (options: {
  directory: string | undefined
  json: boolean
  manifest: string | undefined
  maxImageBytes: string | undefined
  root: string | undefined
  sarif: boolean
  siteUrl: string | undefined
  standards: boolean
  uniqueImages: boolean
}): Promise<void> => {
  if (!options.directory) throw new Error('The audit command requires --site <directory>.')

  if (options.json && options.sarif) throw new Error('Use either --json or --sarif, not both.')

  const maxImageBytes = options.maxImageBytes === undefined ? undefined : Number(options.maxImageBytes)

  if (maxImageBytes !== undefined && (!Number.isSafeInteger(maxImageBytes) || maxImageBytes <= 0)) {
    throw new Error('--max-image-bytes must be a positive integer.')
  }

  const result = await auditSite({
    directory: options.directory,
    ...(options.manifest ? { manifest: options.manifest } : {}),
    ...(maxImageBytes ? { maxImageBytes } : {}),
    requireUniqueImages: options.uniqueImages,
    ...(options.root ? { root: options.root } : {}),
    ...(options.standards ? standardAuditRules() : {}),
    ...(options.siteUrl ? { siteUrl: options.siteUrl } : {})
  })

  if (options.sarif) {
    process.stdout.write(`${JSON.stringify(auditToSarif(result), null, 2)}\n`)
  } else if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } else {
    for (const item of result.issues) {
      process.stdout.write(`  ${item.severity.padEnd(7)} ${item.route} [${item.code}] ${item.message}\n`)
    }

    process.stdout.write(
      `Audited ${result.pages.length} page(s): ${result.errors} error(s), ${result.warnings} warning(s).\n`
    )
  }

  if (!result.passed) process.exitCode = 1
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
      json: { type: 'boolean' },
      manifest: { type: 'string' },
      'max-image-bytes': { type: 'string' },
      report: { type: 'boolean' },
      root: { type: 'string' },
      sarif: { type: 'boolean' },
      silent: { short: 's', type: 'boolean' },
      threshold: { type: 'string' },
      site: { type: 'string' },
      'site-url': { type: 'string' },
      standards: { type: 'boolean' },
      to: { type: 'string' },
      'unique-images': { type: 'boolean' },
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

  if (!['audit', 'check', 'compare', 'generate', 'init', 'migrate', 'upgrade'].includes(command)) {
    throw new Error(`Unknown command: ${command}`)
  }

  if (command === 'init') {
    await initialize(parsed.values.config)

    return
  }

  if (command === 'audit') {
    await executeAudit({
      directory: parsed.values.site,
      json: parsed.values.json ?? false,
      manifest: parsed.values.manifest,
      maxImageBytes: parsed.values['max-image-bytes'],
      root: parsed.values.root,
      sarif: parsed.values.sarif ?? false,
      siteUrl: parsed.values['site-url'],
      standards: parsed.values.standards ?? false,
      uniqueImages: parsed.values['unique-images'] ?? false
    })

    return
  }

  if (command === 'migrate') {
    if (!parsed.values.report) throw new Error('The migrate command currently requires --report.')

    await executeMigrationReport(parsed.values.config, parsed.values.json ?? false)

    return
  }

  if (command === 'upgrade') {
    await executeUpgrade(parsed.values.root, parsed.values.to, parsed.values.json ?? false)

    return
  }

  await executeGeneration(command, {
    clean: parsed.values.clean ?? false,
    concurrency: parsed.values.concurrency ?? process.env.OG_WORKER_THREADS,
    config: parsed.values.config,
    force: parsed.values.force ?? process.env.FORCE_OG === '1',
    json: parsed.values.json ?? false,
    silent: parsed.values.silent ?? false,
    threshold: parsed.values.threshold
  })
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)

  process.stderr.write(`santi-og: ${message}\n`)

  process.exitCode = 1
})
