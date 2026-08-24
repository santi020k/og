#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { access, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { auditSite, auditToSarif, summarizeAuditIssues } from './audit.js'
import type { AuditConfig } from './audit-config.js'
import { createLlmsAuditRule, standardAuditRules } from './audit-rules.js'
import { compare } from './compare.js'
import { generate } from './generate.js'
import type { UrlInspection } from './inspect.js'
import { inspectUrl } from './inspect.js'
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

const AUDIT_CONFIG_NAMES = [
  'og.audit.config.mjs',
  'og.audit.config.js',
  'scripts/og.audit.config.mjs'
] as const

const toUnknown = (value: unknown): unknown => value

const help = `\
santi-og ${VERSION}

Generate deterministic Open Graph images from a project-owned config.

Usage:
  santi-og generate [options]
  santi-og check [options]
  santi-og compare [options]
  santi-og audit [--site <directory>] [options]
  santi-og inspect <url> [--json | --open]
  santi-og init [options]
  santi-og migrate --report [options]
  santi-og upgrade [options]

Options:
  --config <path>       Generation or audit config file/directory (default: discover config)
  --concurrency <n>     Active renders, or "auto"
  --force               Regenerate every card
  --clean               Remove outputs for cards deleted from the config
  --silent              Hide per-file progress
  --json                Print a machine-readable JSON result
  --open                Open an interactive local inspection report
  --sarif               Print SEO audit findings as SARIF
  --site <directory>    Built site directory audited by the audit command
  --site-url <url>      Public site URL used to resolve canonical and image URLs
  --manifest <path>     Generated OG route manifest checked by the audit command
  --max-image-bytes <n> Fail social images larger than this byte count
  --unique-images       Require distinct social-image bytes for every route
  --standards           Audit sitemap, robots, hreflang alternates, and redirects
  --llms                Audit llms.txt, llms-full.txt, and route Markdown coverage
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

const findAuditConfig = async (requested: string | undefined): Promise<string | undefined> => {
  const base = path.resolve(requested ?? '.')

  if (requested) {
    try {
      if ((await stat(base)).isFile()) return base
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error

      throw new Error(`Audit config does not exist: ${base}`, { cause: error })
    }
  }

  for (const name of AUDIT_CONFIG_NAMES) {
    const candidate = path.resolve(base, name)

    if (await exists(candidate)) return candidate
  }

  if (requested) throw new Error(`No audit config found in ${base}.`)

  return undefined
}

const loadAuditConfig = async (configPath: string): Promise<AuditConfig> => {
  const imported = toUnknown(await import(pathToFileURL(configPath).href))

  if (typeof imported !== 'object' || imported === null) {
    throw new TypeError(`${configPath} must export an audit config.`)
  }

  const namespace = imported as Record<string, unknown>
  const candidate = namespace.default ?? namespace.config

  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new TypeError(`${configPath} must default-export an audit config.`)
  }

  const config = candidate as AuditConfig
  const configDirectory = path.dirname(configPath)

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
  config: string | undefined
  directory: string | undefined
  json: boolean
  manifest: string | undefined
  maxImageBytes: string | undefined
  root: string | undefined
  sarif: boolean
  siteUrl: string | undefined
  llms: boolean
  standards: boolean
  uniqueImages: boolean
}): Promise<void> => {
  if (options.json && options.sarif) throw new Error('Use either --json or --sarif, not both.')

  const configPath = await findAuditConfig(options.config)
  const configured = configPath ? await loadAuditConfig(configPath) : undefined
  const directory = options.directory ?? configured?.directory

  if (!directory) throw new Error('The audit command requires --site <directory> or an audit config directory.')

  const maxImageBytes = options.maxImageBytes === undefined ? undefined : Number(options.maxImageBytes)

  if (maxImageBytes !== undefined && (!Number.isSafeInteger(maxImageBytes) || maxImageBytes <= 0)) {
    throw new Error('--max-image-bytes must be a positive integer.')
  }

  const siteRules = [
    ...configured?.siteRules ?? [],
    ...(options.standards ? standardAuditRules().siteRules : []),
    ...(options.llms ? [createLlmsAuditRule()] : [])
  ]

  const result = await auditSite({
    ...configured,
    directory,
    ...(options.manifest ? { manifest: options.manifest } : {}),
    ...(maxImageBytes ? { maxImageBytes } : {}),
    requireUniqueImages: options.uniqueImages || configured?.requireUniqueImages === true,
    ...(options.root ? { root: options.root } : {}),
    siteRules,
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

    const summaries = summarizeAuditIssues(result.issues)

    if (summaries.length > 0) {
      process.stdout.write('Root causes:\n')

      for (const summary of summaries) {
        process.stdout.write(`  ${summary.severity.padEnd(7)} [${summary.code}] ${summary.count} finding(s) across ${summary.routes.length} route(s)\n`)
      }
    }

    process.stdout.write(
      `Audited ${result.pages.length} page(s): ${result.errors} error(s), ${result.warnings} warning(s).\n`
    )
  }

  if (!result.passed) process.exitCode = 1
}

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll('\'', '&#39;')

const inspectionReportHtml = (result: UrlInspection): string => {
  const checks = result.checks.map(item => `<li class="${item.status}">
    <span>${escapeHtml(item.status)}</span><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.message)}</p></div>
  </li>`).join('')

  const image = result.image ? `<img src="${escapeHtml(result.image.url)}" alt="${escapeHtml(result.metadata.openGraph['og:image:alt'] ?? 'Inspected social image')}" referrerpolicy="no-referrer">` : ''

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Metadata inspection — ${escapeHtml(result.finalUrl)}</title><style>
:root{color-scheme:dark;font:16px/1.5 Inter,system-ui,sans-serif;color:#eafff6;background:#07110e}*{box-sizing:border-box}body{margin:0}main{width:min(960px,calc(100% - 32px));margin:auto;padding:64px 0}a{color:#65f6bd}h1{margin:.4rem 0;font-size:clamp(2rem,6vw,4rem);line-height:1}header p{color:#9ab2a8;word-break:break-all}.summary{display:flex;gap:10px;margin:28px 0}.summary span,li>span{padding:5px 9px;border:1px solid #1b382e;border-radius:999px;font:700 12px ui-monospace,monospace;text-transform:uppercase}.pass{color:#65f6bd}.warning{color:#ffd479}.error{color:#ff9a9a}img{display:block;width:100%;height:auto;margin:28px 0;border:1px solid #1b382e;border-radius:14px}ul{padding:0;margin:28px 0;list-style:none;border:1px solid #1b382e;border-radius:14px;overflow:hidden}li{display:grid;grid-template-columns:88px 1fr;gap:16px;align-items:start;padding:18px;border-bottom:1px solid #1b382e;background:#0c1915}li:last-child{border:0}li>span{justify-self:start}strong{color:#eafff6}li p{margin:3px 0 0;color:#9ab2a8}@media(max-width:540px){main{padding:36px 0}li{grid-template-columns:1fr}}
</style></head><body><main><header><span>@santi020k/og inspector</span><h1>${escapeHtml(result.metadata.title ?? 'Metadata inspection')}</h1><p>${escapeHtml(result.finalUrl)}</p></header>
<div class="summary"><span class="pass">${result.summary.pass} passed</span><span class="warning">${result.summary.warning} warnings</span><span class="error">${result.summary.error} errors</span></div>${image}<ul>${checks}</ul>
<p>Generated locally by <a href="https://og.santi020k.com/checker">@santi020k/og</a>. Press Ctrl+C in the terminal to stop this report.</p></main></body></html>`
}

const openBrowser = (url: string): void => {
  let command = 'xdg-open'

  if (process.platform === 'darwin') command = 'open'
  else if (process.platform === 'win32') command = 'cmd'

  const arguments_ = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, arguments_, { detached: true, stdio: 'ignore' })

  child.once('error', () => {
    process.stderr.write('Could not open a browser automatically. Open the local report URL manually.\n')
  })

  child.unref()
}

const serveInspectionReport = async (result: UrlInspection): Promise<void> => {
  const html = inspectionReportHtml(result)

  const server = createServer((request, response) => {
    if (request.url !== '/') {
      response.writeHead(404).end('Not found')

      return
    }

    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-security-policy': 'default-src \'none\'; img-src http: https:; style-src \'unsafe-inline\'; base-uri \'none\'; frame-ancestors \'none\'',
      'content-type': 'text/html; charset=utf-8',
      'referrer-policy': 'no-referrer'
    }).end(html)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)

    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()

  if (!address || typeof address === 'string') throw new Error('Could not start the local report server.')

  const url = `http://127.0.0.1:${address.port}/`

  process.stdout.write(`Opened local inspection report at ${url}\nPress Ctrl+C to stop it.\n`)

  openBrowser(url)
}

const reportInspection = (result: UrlInspection): void => {
  process.stdout.write(`Inspected ${result.finalUrl}\n`)

  for (const item of result.checks) {
    process.stdout.write(`  ${item.status.padEnd(7)} [${item.code}] ${item.message}\n`)
  }

  process.stdout.write(
    `${result.summary.pass} passed, ${result.summary.warning} warning(s), ${result.summary.error} error(s) ` +
    `in ${result.elapsedMilliseconds}ms.\n`
  )
}

const executeInspect = async (url: string | undefined, json: boolean, open: boolean): Promise<void> => {
  if (!url) throw new Error('The inspect command requires a URL.')

  if (json && open) throw new Error('Use either --json or --open, not both.')

  const result = await inspectUrl(url)

  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else reportInspection(result)

  if (open) {
    await serveInspectionReport(result)

    return
  }

  if (result.summary.error > 0) process.exitCode = 1
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
      llms: { type: 'boolean' },
      manifest: { type: 'string' },
      'max-image-bytes': { type: 'string' },
      open: { type: 'boolean' },
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

  if (!['audit', 'check', 'compare', 'generate', 'init', 'inspect', 'migrate', 'upgrade'].includes(command)) {
    throw new Error(`Unknown command: ${command}`)
  }

  if (command === 'init') {
    await initialize(parsed.values.config)

    return
  }

  if (command === 'audit') {
    await executeAudit({
      config: parsed.values.config,
      directory: parsed.values.site,
      json: parsed.values.json ?? false,
      llms: parsed.values.llms ?? false,
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

  if (command === 'inspect') {
    await executeInspect(parsed.positionals[1], parsed.values.json ?? false, parsed.values.open ?? false)

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
