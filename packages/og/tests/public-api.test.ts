import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, test } from 'vitest'

import * as publicApi from '../src/index.js'

const publicSubpaths = [
  '.',
  './astro',
  './astro/head',
  './astro/starlight',
  './audit',
  './audit/config',
  './audit/rules',
  './content',
  './inspect',
  './locales',
  './metadata',
  './metadata/html',
  './metadata/next',
  './presets',
  './runtime',
  './schema',
  './sharp',
  './satori',
  './site'
] as const

const rootRuntimeExports = [
  'GENERATOR_VERSION',
  'PRESET_VERSION',
  'assertPublicInspectionUrl',
  'auditSite',
  'auditToSarif',
  'compare',
  'createAlternateLinksAuditRule',
  'createCards',
  'createEncodedRenderer',
  'createImageResponse',
  'createLlmsAuditRule',
  'createLocaleAlternates',
  'createLocaleAuditHrefs',
  'createMigrationReport',
  'createPathCards',
  'createPresetRenderer',
  'createRedirectsAuditRule',
  'createRobotsAuditRule',
  'createRouteManifest',
  'createSitemapAuditRule',
  'defineAuditConfig',
  'defineConfig',
  'definePresetConfig',
  'defineSite',
  'defineWorkerRenderer',
  'fromLegacyCards',
  'generate',
  'inspectHtml',
  'inspectUrl',
  'materializeRemoteImage',
  'pathnameOutput',
  'relativeOutput',
  'routeManifestPath',
  'serializeRouteManifest',
  'standardAuditRules',
  'summarizeAuditIssues',
  'upgradeProject',
  'writeRouteManifest'
] as const

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

describe('public API contract', () => {
  test('keeps the documented package subpaths explicit', async () => {
    const source = await readFile(path.resolve('package.json'), 'utf8')
    const manifest: unknown = JSON.parse(source)

    expect(isRecord(manifest)).toBe(true)

    if (!isRecord(manifest) || !isRecord(manifest.exports)) {
      throw new Error('Package manifest must define an exports object')
    }

    expect(Object.keys(manifest.exports).sort()).toEqual([...publicSubpaths].sort())
  })

  test('keeps root runtime exports reviewable', () => {
    expect(Object.keys(publicApi).sort()).toEqual([...rootRuntimeExports].sort())
  })
})
