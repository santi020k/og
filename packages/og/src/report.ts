import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { OgCard, OgConfig, OgFormat } from './types.js'
import { GENERATOR_VERSION } from './version.js'

export interface MigrationReport {
  cacheKey?: string
  config: string
  configLines: number
  customRenderer: boolean
  generatorVersion: string
  localModules: readonly string[]
  logicalCards: number
  physicalOutputs: number
  recommendations: readonly string[]
}

const localImportPattern = /(?:\bimport\s*(?:[^'"()]*?\sfrom\s*)?|\brequire\s*\()\s*['"](\.[^'"]+)['"]/gu

const countOutputs = <T>(card: OgCard<T>): number => {
  const formats = new Set([
    path.extname(card.output).slice(1).toLowerCase(),
    ...(card.formats ?? [])
  ])

  return [...formats].reduce((count, format) => (
    count + 1 + (card.formatAliases?.[format as OgFormat]?.length ?? 0)
  ), card.aliases?.length ?? 0)
}

export const createMigrationReport = async <T>(parameters: {
  config: OgConfig<T>
  configContents?: string
  configPath: string
}): Promise<MigrationReport> => {
  const contents = parameters.configContents ?? await readFile(parameters.configPath, 'utf8')

  const cards = typeof parameters.config.cards === 'function' ?
    await parameters.config.cards() :
    parameters.config.cards

  const cacheKey = typeof parameters.config.cache === 'object' ? parameters.config.cache.key : undefined

  const localModules = [...contents.matchAll(localImportPattern)]
    .map(match => match[1])
    .filter((specifier): specifier is string => Boolean(specifier))

  const customRenderer = !cacheKey?.startsWith('preset-v')
  const recommendations: string[] = []

  if (customRenderer) recommendations.push('Evaluate definePresetConfig before retaining a custom renderer.')

  if (cards.some(card => (card.formats?.length ?? 0) === 0) && cards.length > 1) {
    recommendations.push('Use card.formats when logical cards repeat only to change file extensions.')
  }

  if (contents.split(/\r?\n/u).length > 150) {
    recommendations.push('Move large typed catalogs through createCards() or a data manifest.')
  }

  return {
    ...(cacheKey ? { cacheKey } : {}),
    config: path.resolve(parameters.configPath),
    configLines: contents.split(/\r?\n/u).length,
    customRenderer,
    generatorVersion: GENERATOR_VERSION,
    localModules: [...new Set(localModules)].sort(),
    logicalCards: cards.length,
    physicalOutputs: cards.reduce((count, card) => count + countOutputs(card), 0),
    recommendations
  }
}
