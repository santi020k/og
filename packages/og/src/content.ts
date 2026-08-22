import { glob, readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse as parseYaml } from 'yaml'

import { pathnameOutput } from './composition.js'
import type { PresetCardData } from './presets.js'
import type { Awaitable, OgCard, OgSourceCollection } from './types.js'

export interface ContentEntry {
  body: string
  filePath: string
  frontmatter: Readonly<Record<string, unknown>>
  id: string
  slug: string
}

export interface ContentCardOptions<T extends PresetCardData = PresetCardData> {
  aggregate?: (
    entries: readonly ContentEntry[],
    cards: readonly OgCard<T>[]
  ) => Awaitable<readonly OgCard<T>[]>
  basePath?: string
  coverFields?: readonly string[]
  directory: string
  draft?: (entry: ContentEntry) => Awaitable<boolean>
  exclude?: readonly string[]
  extension?: string
  filter?: (entry: ContentEntry) => Awaitable<boolean>
  include?: readonly string[]
  includeDrafts?: boolean
  map?: (entry: ContentEntry) => Awaitable<T | null | undefined>
  output?: (entry: ContentEntry, data: T) => string
  root?: string
  sources?: (entry: ContentEntry, data: T) => OgSourceCollection
}

const markdownPattern = /\.mdx?$/u
const defaultIncludes = ['**/*.md', '**/*.mdx'] as const

const collectFiles = async (
  directory: string,
  include: readonly string[],
  exclude: readonly string[]
): Promise<string[]> => {
  const files = new Set<string>()

  for (const pattern of include) {
    for await (const match of glob(pattern, { cwd: directory, exclude })) {
      if (markdownPattern.test(match)) files.add(path.resolve(directory, match))
    }
  }

  return [...files].sort()
}

const parseFrontmatter = (
  contents: string
): { body: string, frontmatter: Readonly<Record<string, unknown>> } => {
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

const defaultData = (entry: ContentEntry, coverFields: readonly string[]): PresetCardData | null => {
  const title = entry.frontmatter.title

  if (typeof title !== 'string' || title.trim().length === 0) return null

  const description = entry.frontmatter.description
  const type = entry.frontmatter.type

  const cover = coverFields
    .map(field => entry.frontmatter[field])
    .find((value): value is string => typeof value === 'string' && value.length > 0)

  return {
    ...(cover ? { image: cover } : {}),
    ...(typeof description === 'string' ? { description } : {}),
    ...(typeof type === 'string' ? { badge: type } : {}),
    title,
    variant: 'article'
  }
}

/** Read Markdown and MDX content without starting a framework runtime. */
export const readContent = async (options: {
  directory: string
  exclude?: readonly string[]
  include?: readonly string[]
  root?: string
}): Promise<ContentEntry[]> => {
  const root = path.resolve(options.root ?? process.cwd())
  const directory = path.resolve(root, options.directory)
  const files = await collectFiles(directory, options.include ?? defaultIncludes, options.exclude ?? [])

  return Promise.all(files.map(async filePath => {
    const id = path.relative(directory, filePath).split(path.sep).join('/')
    const contents = await readFile(filePath, 'utf8')
    const { body, frontmatter } = parseFrontmatter(contents)

    return { body, filePath, frontmatter, id, slug: contentSlug(filePath, directory) }
  }))
}

/** Convert framework-neutral Markdown or MDX entries into preset cards. */
export const collectContentCards = async <T extends PresetCardData = PresetCardData>(
  options: ContentCardOptions<T>
): Promise<OgCard<T>[]> => {
  const entries = await readContent(options)
  const cards: OgCard<T>[] = []
  const extension = options.extension?.replace(/^\./u, '') ?? 'webp'
  const basePath = options.basePath?.replace(/^\/+|\/+$/gu, '') ?? ''

  for (const entry of entries) {
    if (options.filter && !await options.filter(entry)) continue

    const draft = options.draft ? await options.draft(entry) : entry.frontmatter.draft === true

    if (!options.includeDrafts && draft) continue

    const mapped = options.map ?
      await options.map(entry) :
      defaultData(entry, options.coverFields ?? ['image', 'cover', 'heroImage']) as T | null

    if (!mapped) continue

    const pathname = [basePath, entry.slug].filter(Boolean).join('/')
    const output = options.output?.(entry, mapped) ?? pathnameOutput(pathname, { extension })
    const sources = options.sources?.(entry, mapped) ?? [entry.filePath]

    cards.push({ data: mapped, output, sources })
  }

  if (options.aggregate) cards.push(...await options.aggregate(entries, cards))

  return cards
}
