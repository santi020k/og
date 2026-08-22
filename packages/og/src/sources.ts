import { access, glob, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { OgSourceCollection } from './types.js'

const globPattern = /[*?[\]{}]/u
// eslint-disable-next-line @stylistic/max-len
const importPattern = /(?:\bimport\s*(?:[^'"()]*?\sfrom\s*)?\(?|\bexport\s+[^'"()]*?\sfrom\s*|\brequire\s*\()\s*['"]([^'"]+)['"]/gu
const filePattern = /(?:\breadFile(?:Sync)?\s*\(|\bnew\s+URL\s*\()\s*['"]([^'"]+)['"]/gu

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath)

    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false

    throw error
  }
}

const collectPatterns = async (
  collection: OgSourceCollection | undefined
): Promise<readonly string[]> => {
  if (!collection) return []

  return typeof collection === 'function' ? collection() : collection
}

export const expandSources = async (
  collection: OgSourceCollection | undefined,
  root: string,
  label: string
): Promise<string[]> => {
  const patterns = await collectPatterns(collection)
  const sources: string[] = []

  for (const pattern of patterns) {
    if (!globPattern.test(pattern)) {
      sources.push(path.resolve(root, pattern))

      continue
    }

    const matches: string[] = []

    for await (const match of glob(pattern, { cwd: root })) {
      matches.push(path.isAbsolute(match) ? match : path.resolve(root, match))
    }

    if (matches.length === 0) throw new Error(`${label} source glob matched no files: ${pattern}`)

    sources.push(...matches)
  }

  return [...new Set(sources)].sort()
}

const resolveImport = async (specifier: string, importer: string): Promise<string | undefined> => {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return undefined

  const resolved = specifier.startsWith('/') ? specifier : fileURLToPath(new URL(specifier, pathToFileURL(importer)))
  const candidates = [resolved, `${resolved}.js`, `${resolved}.mjs`, `${resolved}.cjs`, `${resolved}.ts`]

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }

  return undefined
}

/** Collect a worker entry module and all of its statically imported local modules. */
export const collectTransitiveImports = async (entry: string, root = path.dirname(entry)): Promise<string[]> => {
  const visited = new Set<string>()

  const visit = async (modulePath: string): Promise<void> => {
    const normalized = path.resolve(modulePath)

    if (visited.has(normalized)) return

    visited.add(normalized)

    const contents = await readFile(normalized, 'utf8')

    const specifiers = [...contents.matchAll(importPattern)]
      .map(match => match[1])
      .filter((specifier): specifier is string => Boolean(specifier))

    for (const specifier of specifiers) {
      const imported = await resolveImport(specifier, normalized)

      if (imported) await visit(imported)
    }

    const files = [...contents.matchAll(filePattern)]
      .map(match => match[1])
      .filter((file): file is string => Boolean(file))

    for (const file of files) {
      const base = file.startsWith('.') ? path.dirname(normalized) : root
      const resolved = path.isAbsolute(file) ? file : path.resolve(base, file)

      if (await exists(resolved)) visited.add(resolved)
    }
  }

  await visit(entry)

  return [...visited].sort()
}
