import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse as parseYaml } from 'yaml'

import { pathnameOutput } from './composition.js'
import type { PresetCardData } from './presets.js'
import type { Awaitable, OgCard, OgSourceCollection } from './types.js'

export interface AstroContentEntry {
  body: string
  filePath: string
  frontmatter: Readonly<Record<string, unknown>>
  id: string
  slug: string
}

export interface AstroContentCardOptions<T extends PresetCardData = PresetCardData> {
  basePath?: string
  directory: string
  extension?: string
  includeDrafts?: boolean
  map?: (entry: AstroContentEntry) => Awaitable<T | null | undefined>
  output?: (entry: AstroContentEntry, data: T) => string
  root?: string
  sources?: (entry: AstroContentEntry, data: T) => OgSourceCollection
}

const markdownPattern = /\.mdx?$/u

const collectFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true })

  const files = await Promise.all(entries.map(async entry => {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) return collectFiles(entryPath)

    return entry.isFile() && markdownPattern.test(entry.name) ? [entryPath] : []
  }))

  return files.flat().sort()
}

const parseFrontmatter = (contents: string): { body: string, frontmatter: Readonly<Record<string, unknown>> } => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(contents)

  if (!match) return { body: contents, frontmatter: {} }

  const parsed: unknown = parseYaml(match[1] ?? '')

  const frontmatter = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ?
    parsed as Record<string, unknown> :
    {}

  return { body: contents.slice(match[0].length), frontmatter }
}

const contentSlug = (filePath: string, directory: string): string => {
  const relative = path.relative(directory, filePath).split(path.sep).join('/')
  const withoutExtension = relative.replace(markdownPattern, '')

  if (path.posix.basename(withoutExtension) !== 'index') return withoutExtension

  const parent = path.posix.dirname(withoutExtension)

  return parent === '.' ? '' : parent
}

const defaultData = (entry: AstroContentEntry): PresetCardData | null => {
  const title = entry.frontmatter.title

  if (typeof title !== 'string' || title.trim().length === 0) return null

  const description = entry.frontmatter.description
  const type = entry.frontmatter.type

  return {
    ...(typeof description === 'string' ? { description } : {}),
    ...(typeof type === 'string' ? { badge: type } : {}),
    title,
    variant: 'article'
  }
}

export const readAstroContent = async (options: {
  directory: string
  root?: string
}): Promise<AstroContentEntry[]> => {
  const root = path.resolve(options.root ?? process.cwd())
  const directory = path.resolve(root, options.directory)
  const files = await collectFiles(directory)

  return Promise.all(files.map(async filePath => {
    const id = path.relative(directory, filePath).split(path.sep).join('/')
    const contents = await readFile(filePath, 'utf8')
    const { body, frontmatter } = parseFrontmatter(contents)

    return { body, filePath, frontmatter, id, slug: contentSlug(filePath, directory) }
  }))
}

export const collectAstroContentCards = async <T extends PresetCardData = PresetCardData>(
  options: AstroContentCardOptions<T>
): Promise<OgCard<T>[]> => {
  const entries = await readAstroContent(options)
  const cards: OgCard<T>[] = []
  const extension = options.extension?.replace(/^\./u, '') ?? 'webp'
  const basePath = options.basePath?.replace(/^\/+|\/+$/gu, '') ?? ''

  for (const entry of entries) {
    if (!options.includeDrafts && entry.frontmatter.draft === true) continue

    const mapped = options.map ? await options.map(entry) : defaultData(entry) as T | null

    if (!mapped) continue

    const pathname = [basePath, entry.slug].filter(Boolean).join('/')
    const output = options.output?.(entry, mapped) ?? pathnameOutput(pathname, { extension })
    const sources = options.sources?.(entry, mapped) ?? [entry.filePath]

    cards.push({ data: mapped, output, sources })
  }

  return cards
}
