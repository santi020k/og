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

export interface ImageObjectSchemaInput {
  caption?: string
  contentUrl?: string | URL
  height?: number
  id?: string
  url: string | URL
  width?: number
}

export interface OfferSchemaInput {
  availability?: string | URL
  currency?: string
  id?: string
  price?: number | string
  url?: string | URL
}

export interface WebPageSchemaInput extends ThingSchemaInput {
  description?: string
  image?: JsonLdNode | string | URL
  inLanguage?: string
  isPartOf?: JsonLdNode
  type?: string
}

export interface EventSchemaInput extends ThingSchemaInput {
  description?: string
  endDate?: Date | string
  eventStatus?: string | URL
  image?: JsonLdNode | string | URL
  inLanguage?: string
  location?: JsonLdNode
  organizer?: JsonLdNode | readonly JsonLdNode[]
  startDate: Date | string
}

export interface FaqQuestion {
  answer: string
  question: string
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

export const imageObjectSchema = (
  input: ImageObjectSchemaInput,
  extension: JsonLdExtension = {}
): JsonLdNode => defineSchema({
  '@type': 'ImageObject',
  ...(input.id ? { '@id': input.id } : {}),
  url: urlString(input.url),
  ...(input.contentUrl ? { contentUrl: urlString(input.contentUrl) } : {}),
  ...(input.caption ? { caption: input.caption } : {}),
  ...(input.height === undefined ? {} : { height: input.height }),
  ...(input.width === undefined ? {} : { width: input.width }),
  ...extension
})

export const offerSchema = (
  input: OfferSchemaInput,
  extension: JsonLdExtension = {}
): JsonLdNode => defineSchema({
  '@type': 'Offer',
  ...(input.id ? { '@id': input.id } : {}),
  ...(input.availability ? { availability: urlString(input.availability) } : {}),
  ...(input.currency ? { priceCurrency: input.currency } : {}),
  ...(input.price === undefined ? {} : { price: input.price }),
  ...(input.url ? { url: urlString(input.url) } : {}),
  ...extension
})

export const webPageSchema = (
  input: WebPageSchemaInput,
  extension: JsonLdExtension = {}
): JsonLdNode => defineSchema({
  '@type': input.type ?? 'WebPage',
  ...(input.id ? { '@id': input.id } : {}),
  name: input.name,
  ...(input.url ? { url: urlString(input.url) } : {}),
  ...(input.description ? { description: input.description } : {}),
  ...(input.image ? { image: input.image instanceof URL ? input.image.href : input.image } : {}),
  ...(input.inLanguage ? { inLanguage: input.inLanguage } : {}),
  ...(input.isPartOf ? { isPartOf: input.isPartOf } : {}),
  ...extension
})

export const eventSchema = (
  input: EventSchemaInput,
  extension: JsonLdExtension = {}
): JsonLdNode => defineSchema({
  '@type': 'Event',
  ...(input.id ? { '@id': input.id } : {}),
  name: input.name,
  startDate: dateString(input.startDate),
  ...(input.url ? { url: urlString(input.url) } : {}),
  ...(input.description ? { description: input.description } : {}),
  ...(input.endDate ? { endDate: dateString(input.endDate) } : {}),
  ...(input.eventStatus ? { eventStatus: urlString(input.eventStatus) } : {}),
  ...(input.image ? { image: input.image instanceof URL ? input.image.href : input.image } : {}),
  ...(input.inLanguage ? { inLanguage: input.inLanguage } : {}),
  ...(input.location ? { location: input.location } : {}),
  ...(input.organizer ? { organizer: input.organizer } : {}),
  ...extension
})

export const faqSchema = (
  questions: readonly FaqQuestion[],
  extension: JsonLdExtension = {}
): JsonLdNode => defineSchema({
  '@type': 'FAQPage',
  mainEntity: questions.map(question => defineSchema({
    '@type': 'Question',
    acceptedAnswer: defineSchema({
      '@type': 'Answer',
      text: question.answer
    }),
    name: question.question
  })),
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
