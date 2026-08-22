import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import sharp from 'sharp'

import { generate } from './generate.js'
import { readManifest } from './manifest.js'
import { resolveInside } from './paths.js'
import type { GenerateOptions, OgConfig } from './types.js'

export interface OgComparison {
  actual: OgImageDetails
  expected?: OgImageDetails
  output: string
  pixelDifference?: {
    different: number
    ratio: number
    total: number
  }
  status: 'changed' | 'identical' | 'missing'
}

export interface OgImageDetails {
  bytes: number
  format?: string
  height?: number
  width?: number
}

const details = async (contents: Buffer): Promise<OgImageDetails> => {
  const metadata = await sharp(contents).metadata()

  return {
    bytes: contents.byteLength,
    format: metadata.format,
    ...(metadata.height ? { height: metadata.height } : {}),
    ...(metadata.width ? { width: metadata.width } : {})
  }
}

const comparePixels = async (
  expected: Buffer,
  actual: Buffer,
  expectedDetails: OgImageDetails,
  actualDetails: OgImageDetails
): Promise<OgComparison['pixelDifference']> => {
  if (
    expectedDetails.height !== actualDetails.height ||
    expectedDetails.width !== actualDetails.width
  ) return undefined

  const [expectedPixels, actualPixels] = await Promise.all([
    sharp(expected).ensureAlpha().raw().toBuffer(),
    sharp(actual).ensureAlpha().raw().toBuffer()
  ])

  const total = (actualDetails.height ?? 0) * (actualDetails.width ?? 0)
  let different = 0

  for (let offset = 0; offset < actualPixels.length; offset += 4) {
    if (!actualPixels.subarray(offset, offset + 4).equals(expectedPixels.subarray(offset, offset + 4))) {
      different += 1
    }
  }

  return { different, ratio: total === 0 ? 0 : different / total, total }
}

export const compare = async <T>(
  config: OgConfig<T>,
  options: Pick<GenerateOptions, 'concurrency' | 'configFingerprint'> = {}
): Promise<OgComparison[]> => {
  const stagingDirectory = await mkdtemp(path.join(tmpdir(), 'santi-og-compare-'))
  const root = path.resolve(config.root ?? process.cwd())

  try {
    await generate(config, { ...options, force: true, stagingDirectory })

    const manifest = await readManifest(path.join(stagingDirectory, '.og-cache.json'))
    const comparisons: OgComparison[] = []

    for (const [output, entry] of Object.entries(manifest.entries)) {
      const actualPath = entry.directory ?
        path.join(stagingDirectory, 'named', entry.directory, entry.output ?? output) :
        path.join(stagingDirectory, 'default', entry.output ?? output)

      const outputDirectory = entry.directory ? config.outputDirectories?.[entry.directory] : config.outputDirectory

      const expectedDirectory = resolveInside(
        root,
        outputDirectory ?? 'public/og',
        entry.directory ? `outputDirectories.${entry.directory}` : 'outputDirectory'
      )

      const expectedPath = resolveInside(expectedDirectory, entry.output ?? output, `output ${output}`)
      const actual = await readFile(actualPath)
      const actualDetails = await details(actual)

      try {
        const expected = await readFile(expectedPath)
        const expectedDetails = await details(expected)
        const pixelDifference = await comparePixels(expected, actual, expectedDetails, actualDetails)
        const identical = expected.equals(actual)

        comparisons.push({
          actual: actualDetails,
          expected: expectedDetails,
          output,
          ...(pixelDifference ? { pixelDifference } : {}),
          status: identical ? 'identical' : 'changed'
        })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error

        comparisons.push({ actual: actualDetails, output, status: 'missing' })
      }
    }

    return comparisons
  } finally {
    await rm(stagingDirectory, { force: true, recursive: true })
  }
}
