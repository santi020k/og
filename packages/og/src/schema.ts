export type JsonLdPrimitive = boolean | null | number | string

export type JsonLdValue = JsonLdNode | JsonLdPrimitive | readonly JsonLdValue[]

/** An extensible Schema.org node. Known recipes remain typed while custom properties stay possible. */
export interface JsonLdNode {
  '@id'?: string
  '@type': string | readonly string[]
  [property: string]: JsonLdValue | undefined
}

export interface JsonLdDocument {
  '@context': string | Readonly<Record<string, JsonLdValue>>
  '@graph': readonly JsonLdNode[]
}

export type JsonLdExtension = Readonly<Record<string, JsonLdValue | undefined>>

export interface ThingSchemaInput {
  id?: string
  name: string
  url?: string | URL
}

export interface WebSiteSchemaInput extends ThingSchemaInput {
  description?: string
  inLanguage?: string
  publisher?: JsonLdNode
  searchAction?: {
    queryInput?: string
    target: string
  }
}

export interface ArticleSchemaInput extends ThingSchemaInput {
  author?: JsonLdNode | readonly JsonLdNode[]
  dateModified?: Date | string
  datePublished?: Date | string
  description?: string
  headline?: string
  image?: JsonLdNode | string | URL | readonly (JsonLdNode | string | URL)[]
  inLanguage?: string
  isPartOf?: JsonLdNode
  publisher?: JsonLdNode
  type?: string
}

export interface SoftwareApplicationSchemaInput extends ThingSchemaInput {
  applicationCategory?: string
  author?: JsonLdNode
  description?: string
  downloadUrl?: string | URL
  isAccessibleForFree?: boolean
  offers?: JsonLdNode
  operatingSystem?: string | readonly string[]
  softwareVersion?: string
}

export interface BreadcrumbItem {
  name: string
  url: string | URL
}

export interface CollectionSchemaInput extends ThingSchemaInput {
  description?: string
  inLanguage?: string
  items: readonly (JsonLdNode | ThingSchemaInput)[]
}

const schemaContext = 'https://schema.org'

const urlString = (value: string | URL | undefined): string | undefined => (
  value instanceof URL ? value.href : value
)

const dateString = (value: Date | string): string => {
  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.valueOf())) throw new Error('JSON-LD date must be valid')

  return date.toISOString()
}

const imageValue = (
  value: ArticleSchemaInput['image']
): JsonLdValue | undefined => {
  if (value === undefined) return undefined

  const values: readonly (JsonLdNode | string | URL)[] = Array.isArray(value) ? value : [value]
  const mapped: readonly (JsonLdNode | string)[] = values.map(image => image instanceof URL ? image.href : image)

  return Array.isArray(value) ? mapped : mapped[0]
}

/** Preserve a custom Schema.org node with full type inference. */
export const defineSchema = <T extends JsonLdNode>(node: T): T => node

/** Define a reusable custom schema recipe for project- or domain-specific scenarios. */
export const defineSchemaRecipe = <TInput, TNode extends JsonLdNode>(
  recipe: (input: TInput) => TNode
): ((input: TInput) => TNode) => recipe

/** Add arbitrary Schema.org properties while retaining the base recipe's inferred fields. */
export const extendSchema = <TNode extends JsonLdNode, TExtension extends JsonLdExtension>(
  node: TNode,
  extension: TExtension | ((node: Readonly<TNode>) => TExtension)
): TNode & TExtension => ({
  ...node,
  ...(typeof extension === 'function' ? extension(node) : extension)
})

export const personSchema = (
  input: ThingSchemaInput,
  extension: JsonLdExtension = {}
): JsonLdNode => defineSchema({
  '@type': 'Person',
  ...(input.id ? { '@id': input.id } : {}),
  name: input.name,
  ...(input.url ? { url: urlString(input.url) } : {}),
  ...extension
})

export const organizationSchema = (
  input: ThingSchemaInput,
  extension: JsonLdExtension = {}
): JsonLdNode => defineSchema({
  '@type': 'Organization',
  ...(input.id ? { '@id': input.id } : {}),
  name: input.name,
  ...(input.url ? { url: urlString(input.url) } : {}),
  ...extension
})

export const webSiteSchema = (
  input: WebSiteSchemaInput,
  extension: JsonLdExtension = {}
): JsonLdNode => defineSchema({
  '@type': 'WebSite',
  ...(input.id ? { '@id': input.id } : {}),
  name: input.name,
  ...(input.url ? { url: urlString(input.url) } : {}),
  ...(input.description ? { description: input.description } : {}),
  ...(input.inLanguage ? { inLanguage: input.inLanguage } : {}),
  ...(input.publisher ? { publisher: input.publisher } : {}),
  ...(input.searchAction ?
    {
      potentialAction: defineSchema({
        '@type': 'SearchAction',
        'query-input': input.searchAction.queryInput ?? 'required name=search_term_string',
        target: input.searchAction.target
      })
    } :
    {}),
  ...extension
})

export const articleSchema = (
  input: ArticleSchemaInput,
  extension: JsonLdExtension = {}
): JsonLdNode => {
  const image = imageValue(input.image)

  return defineSchema({
    '@type': input.type ?? 'Article',
    ...(input.id ? { '@id': input.id } : {}),
    name: input.name,
    headline: input.headline ?? input.name,
    ...(input.url ? { url: urlString(input.url) } : {}),
    ...(input.author ? { author: input.author } : {}),
    ...(input.datePublished ? { datePublished: dateString(input.datePublished) } : {}),
    ...(input.dateModified ? { dateModified: dateString(input.dateModified) } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(image === undefined ? {} : { image }),
    ...(input.inLanguage ? { inLanguage: input.inLanguage } : {}),
    ...(input.isPartOf ? { isPartOf: input.isPartOf } : {}),
    ...(input.publisher ? { publisher: input.publisher } : {}),
    ...extension
  })
}

export const softwareApplicationSchema = (
  input: SoftwareApplicationSchemaInput,
  extension: JsonLdExtension = {}
): JsonLdNode => defineSchema({
  '@type': 'SoftwareApplication',
  ...(input.id ? { '@id': input.id } : {}),
  name: input.name,
  ...(input.url ? { url: urlString(input.url) } : {}),
  ...(input.applicationCategory ? { applicationCategory: input.applicationCategory } : {}),
  ...(input.author ? { author: input.author } : {}),
  ...(input.description ? { description: input.description } : {}),
  ...(input.downloadUrl ? { downloadUrl: urlString(input.downloadUrl) } : {}),
  ...(input.isAccessibleForFree === undefined ? {} : { isAccessibleForFree: input.isAccessibleForFree }),
  ...(input.offers ? { offers: input.offers } : {}),
  ...(input.operatingSystem ? { operatingSystem: input.operatingSystem } : {}),
  ...(input.softwareVersion ? { softwareVersion: input.softwareVersion } : {}),
  ...extension
})

export const breadcrumbSchema = (
  items: readonly BreadcrumbItem[],
  extension: JsonLdExtension = {}
): JsonLdNode => defineSchema({
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => defineSchema({
    '@type': 'ListItem',
    item: urlString(item.url),
    name: item.name,
    position: index + 1
  })),
  ...extension
})

export const collectionSchema = (
  input: CollectionSchemaInput,
  extension: JsonLdExtension = {}
): JsonLdNode => defineSchema({
  '@type': 'CollectionPage',
  ...(input.id ? { '@id': input.id } : {}),
  name: input.name,
  ...(input.url ? { url: urlString(input.url) } : {}),
  ...(input.description ? { description: input.description } : {}),
  ...(input.inLanguage ? { inLanguage: input.inLanguage } : {}),
  mainEntity: defineSchema({
    '@type': 'ItemList',
    itemListElement: input.items.map((item, index) => defineSchema({
      '@type': 'ListItem',
      item: '@type' in item ?
        item :
        defineSchema({
          '@type': 'Thing',
          ...(item.id ? { '@id': item.id } : {}),
          name: item.name,
          ...(item.url ? { url: urlString(item.url) } : {})
        }),
      position: index + 1
    }))
  }),
  ...extension
})

/** Compose independent recipes into a single graph, preserving cross-node @id references. */
export const composeJsonLd = (
  ...nodes: readonly (JsonLdNode | readonly JsonLdNode[] | null | undefined)[]
): JsonLdDocument => ({
  '@context': schemaContext,
  '@graph': nodes.flatMap(node => node ?? [])
})

/** Escape JSON-LD for safe embedding in an HTML script element. */
export const serializeJsonLd = (value: JsonLdDocument | JsonLdNode): string => JSON.stringify(
  '@context' in value ? value : { '@context': schemaContext, ...value }
)
  .replaceAll('<', '\\u003c')
  .replaceAll('>', '\\u003e')
  .replaceAll('\u2028', '\\u2028')
  .replaceAll('\u2029', '\\u2029')
