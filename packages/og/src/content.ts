import { access, glob, readFile } from 'node:fs/promises'
import path from 'node:path'

import { parse as parseYaml } from 'yaml'

import { pathnameOutput } from './composition.js'
import type { PresetCardData, PresetImage } from './presets.js'
import type { PresetRemoteImageType } from './remote-image.js'
import type { Awaitable, OgCard, OgRouteDescriptor, OgSourceCollection } from './types.js'

export interface ContentEntry {
  body: string
  filePath: string
  frontmatter: Readonly<Record<string, unknown>>
  id: string
  slug: string
}

export interface ContentCardOptions<T extends PresetCardData = PresetCardData> {
  archives?: readonly ContentArchive<T>[]
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
  route?: (entry: ContentEntry, data: T) => OgRouteDescriptor | string
  root?: string
  resolveCover?: boolean
  sources?: (entry: ContentEntry, data: T) => OgSourceCollection
}

export interface ContentArchiveContext<T extends PresetCardData> {
  cards: readonly OgCard<T>[]
  entries: readonly ContentEntry[]
}

export type ContentArchive<T extends PresetCardData = PresetCardData> = (
  context: ContentArchiveContext<T>
) => Awaitable<readonly OgCard<T>[]>

export interface ArchivePageContext {
  entries: readonly ContentEntry[]
  pageNumber: number
  pathname: string
  totalItems: number
  totalPages: number
}

export interface PaginateArchiveOptions<T extends PresetCardData> {
  basePath: string
  data: (context: ArchivePageContext) => Awaitable<T>
  includeFirst?: boolean
  output?: (context: ArchivePageContext, data: T) => string
  pageSize: number
}

export interface GroupArchiveContext extends ArchivePageContext {
  group: string
  groupSlug: string
}

export interface GroupArchiveOptions<T extends PresetCardData> {
  basePath: string
  data: (context: GroupArchiveContext) => Awaitable<T>
  field: string
  includeFirst?: boolean
  output?: (context: GroupArchiveContext, data: T) => string
  pageSize?: number
  slug?: (group: string) => string
}

const markdownPattern = /\.mdx?$/u
const defaultIncludes = ['**/*.md', '**/*.mdx'] as const

const remoteImageTypes = new Set<PresetRemoteImageType>([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp'
])

const isRemoteImage = (value: unknown): value is Exclude<PresetImage, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false

  const candidate = value as Readonly<Record<string, unknown>>

  return typeof candidate.url === 'string' && typeof candidate.sha256 === 'string' &&
    typeof candidate.type === 'string' && remoteImageTypes.has(candidate.type as PresetRemoteImageType)
}

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

/** Read a nested frontmatter value with a dot-separated path. */
export const getFrontmatterValue = (entry: ContentEntry, field: string): unknown => (
  field.split('.').reduce<unknown>((value, segment) => (
    typeof value === 'object' && value !== null && !Array.isArray(value) ?
      (value as Readonly<Record<string, unknown>>)[segment] :
      undefined
  ), entry.frontmatter)
)

/** Resolve a content-relative local asset. Remote and data URLs intentionally return undefined. */
export const resolveContentAsset = async (
  entry: Pick<ContentEntry, 'filePath'>,
  value: unknown
): Promise<string | undefined> => {
  if (typeof value !== 'string' || value.length === 0) return undefined

  if (/^(?:data:|https?:\/\/|\/\/)/u.test(value)) return undefined

  const absolute = path.isAbsolute(value) ? value : path.resolve(path.dirname(entry.filePath), value)

  try {
    await access(absolute)

    return absolute
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined

    throw error
  }
}

const defaultData = async (
  entry: ContentEntry,
  coverFields: readonly string[],
  resolveCover: boolean
): Promise<PresetCardData | null> => {
  const title = entry.frontmatter.title

  if (typeof title !== 'string' || title.trim().length === 0) return null

  const description = entry.frontmatter.description
  const type = entry.frontmatter.type

  const cover = coverFields
    .map(field => getFrontmatterValue(entry, field))
    .find((value): value is PresetImage => (
      typeof value === 'string' ? value.length > 0 : isRemoteImage(value)
    ))

  const image = resolveCover && typeof cover === 'string' ? await resolveContentAsset(entry, cover) : cover

  return {
    ...(image ? { image } : {}),
    ...(typeof description === 'string' ? { description } : {}),
    ...(typeof type === 'string' ? { badge: type } : {}),
    title,
    variant: 'article'
  }
}

const normalizedBasePath = (value: string): string => {
  const pathname = value.replace(/^\/+|\/+$/gu, '')

  return pathname ? `/${pathname}/` : '/'
}

const pageContexts = (
  entries: readonly ContentEntry[],
  basePath: string,
  pageSize: number,
  includeFirst: boolean
): ArchivePageContext[] => {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) throw new Error('Archive pageSize must be positive')

  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize))
  const normalized = normalizedBasePath(basePath)

  return Array.from({ length: totalPages }, (_, index) => {
    const pageNumber = index + 1

    return {
      entries: entries.slice(index * pageSize, pageNumber * pageSize),
      pageNumber,
      pathname: pageNumber === 1 ? normalized : `${normalized}${pageNumber}/`,
      totalItems: entries.length,
      totalPages
    }
  }).filter(context => includeFirst || context.pageNumber > 1)
}

/** Build declarative pagination cards from the entries accepted by collectContentCards. */
export const paginateArchive = <T extends PresetCardData>(
  options: PaginateArchiveOptions<T>
): ContentArchive<T> => async context => Promise.all(
  pageContexts(context.entries, options.basePath, options.pageSize, options.includeFirst ?? true)
    .map(async pageContext => {
      const data = await options.data(pageContext)

      return {
        data,
        output: options.output?.(pageContext, data) ?? pathnameOutput(pageContext.pathname),
        route: { pathname: pageContext.pathname },
        sources: pageContext.entries.map(entry => entry.filePath)
      }
    })
)

const defaultGroupSlug = (value: string): string => encodeURIComponent(value.toLowerCase().trim())

/** Build grouped and optionally paginated archive cards from a nested frontmatter field. */
export const groupArchive = <T extends PresetCardData>(
  options: GroupArchiveOptions<T>
): ContentArchive<T> => async context => {
  const groups = new Map<string, ContentEntry[]>()

  for (const entry of context.entries) {
    const value = getFrontmatterValue(entry, options.field)
    const values = Array.isArray(value) ? value : [value]

    for (const group of values) {
      if (typeof group !== 'string' || group.length === 0) continue

      groups.set(group, [...groups.get(group) ?? [], entry])
    }
  }

  const cards: OgCard<T>[] = []

  for (const [group, entries] of groups) {
    const groupSlug = options.slug?.(group) ?? defaultGroupSlug(group)
    const basePath = `${normalizedBasePath(options.basePath)}${groupSlug}/`

    const contexts = pageContexts(
      entries,
      basePath,
      options.pageSize ?? Number.MAX_SAFE_INTEGER,
      options.includeFirst ?? true
    )

    for (const pageContext of contexts) {
      const groupContext = { ...pageContext, group, groupSlug }
      const data = await options.data(groupContext)

      cards.push({
        data,
        output: options.output?.(groupContext, data) ?? pathnameOutput(groupContext.pathname),
        route: { pathname: groupContext.pathname },
        sources: pageContext.entries.map(entry => entry.filePath)
      })
    }
  }

  return cards
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
  const selectedEntries: ContentEntry[] = []
  const extension = options.extension?.replace(/^\./u, '') ?? 'webp'
  const basePath = options.basePath?.replace(/^\/+|\/+$/gu, '') ?? ''

  for (const entry of entries) {
    if (options.filter && !await options.filter(entry)) continue

    const draft = options.draft ? await options.draft(entry) : entry.frontmatter.draft === true

    if (!options.includeDrafts && draft) continue

    const mapped = options.map ?
      await options.map(entry) :
      await defaultData(
        entry,
        options.coverFields ?? ['image', 'cover', 'heroImage'],
        options.resolveCover ?? false
      ) as T | null

    if (!mapped) continue

    const pathname = [basePath, entry.slug].filter(Boolean).join('/')
    const output = options.output?.(entry, mapped) ?? pathnameOutput(pathname, { extension })
    const sources = options.sources?.(entry, mapped) ?? [entry.filePath]
    const configuredRoute = options.route?.(entry, mapped)

    const route = typeof configuredRoute === 'string' ?
      { pathname: normalizedBasePath(configuredRoute) } :
      configuredRoute ?? { pathname: normalizedBasePath(pathname) }

    cards.push({ data: mapped, output, route, sources })

    selectedEntries.push(entry)
  }

  for (const archive of options.archives ?? []) {
    cards.push(...await archive({ cards, entries: selectedEntries }))
  }

  if (options.aggregate) cards.push(...await options.aggregate(entries, cards))

  return cards
}
