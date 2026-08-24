import { createPageCard } from './metadata.js'
import {
  createMetaTags,
  definePageMetadata,
  type MetadataTag,
  type PageCardData,
  type PageCardOptions,
  type PageMetadata,
  type ResolvedPageMetadata,
  resolvePageMetadata,
  type SiteMetadataOptions } from './metadata.js'
import { renderMetaTags } from './metadata-html.js'
import { type NextCompatibleMetadata, toNextMetadata } from './metadata-next.js'
import type { OgCard } from './types.js'

export interface SiteDefinitionOptions extends SiteMetadataOptions {
  defaults?: Partial<Omit<PageMetadata, 'description' | 'pathname' | 'title'>>
}

export interface SiteDefinition {
  card: {
    (page: PageMetadata, options?: PageCardOptions<PageCardData>): OgCard<PageCardData>

    <T>(page: PageMetadata, options: PageCardOptions<T> & {
      data: (page: PageMetadata) => T
    }): OgCard<T>
  }
  html: (page: PageMetadata) => string
  imageUrl: (page: PageMetadata) => string | undefined
  next: (page: PageMetadata) => NextCompatibleMetadata
  options: Readonly<SiteDefinitionOptions>
  page: <T extends PageMetadata>(page: T) => T
  resolve: (page: PageMetadata) => ResolvedPageMetadata
  tags: (page: PageMetadata) => MetadataTag[]
}

const mergePage = <T extends PageMetadata>(
  page: T,
  defaults: SiteDefinitionOptions['defaults']
): T => definePageMetadata({
  ...defaults,
  ...page,
  ...(defaults?.article || page.article ?
    {
      article: { ...defaults?.article, ...page.article }
    } :
    {}),
  ...(defaults?.image || page.image ?
    {
      image: { ...defaults?.image, ...page.image }
    } :
    {}),
  ...(defaults?.robots || page.robots ?
    {
      robots: { ...defaults?.robots, ...page.robots }
    } :
    {}),
  ...(defaults?.twitter || page.twitter ?
    {
      twitter: { ...defaults?.twitter, ...page.twitter }
    } :
    {})
})

/** Bind site-wide defaults once and derive pages, metadata, cards, HTML, and Next.js output from them. */
export const defineSite = (options: SiteDefinitionOptions): SiteDefinition => {
  const page = <T extends PageMetadata>(definition: T): T => mergePage(definition, options.defaults)
  const resolve = (definition: PageMetadata): ResolvedPageMetadata => resolvePageMetadata(page(definition), options)
  const tags = (definition: PageMetadata): MetadataTag[] => createMetaTags(page(definition), options)

  function card(definition: PageMetadata, cardOptions?: PageCardOptions<PageCardData>): OgCard<PageCardData>

  function card<T>(
    definition: PageMetadata,
    cardOptions: PageCardOptions<T> & { data: (definition: PageMetadata) => T }
  ): OgCard<T>

  function card<T>(
    definition: PageMetadata,
    cardOptions: PageCardOptions<T | PageCardData> = {}
  ): OgCard<T | PageCardData> {
    const merged = page(definition)

    if (cardOptions.data) {
      return createPageCard(merged, {
        ...cardOptions,
        data: cardOptions.data
      })
    }

    return createPageCard(merged, cardOptions as PageCardOptions<PageCardData>)
  }

  return {
    card,
    html: definition => renderMetaTags(tags(definition)),
    imageUrl: definition => resolve(definition).image?.url,
    next: definition => toNextMetadata(page(definition), options),
    options,
    page,
    resolve,
    tags
  }
}
