import type { MetadataTag } from './metadata.js'

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll('\'', '&#39;')

/** Render portable metadata descriptors as safe HTML for templates or static sites. */
export const renderMetaTags = (tags: readonly MetadataTag[]): string => tags.map(tag => {
  if (tag.tag === 'title') return `<title>${escapeHtml(tag.content)}</title>`

  if (tag.tag === 'link') {
    const hreflang = tag.hreflang ? ` hreflang="${escapeHtml(tag.hreflang)}"` : ''

    return `<link rel="${tag.rel}"${hreflang} href="${escapeHtml(tag.href)}">`
  }

  const key = tag.property ? `property="${escapeHtml(tag.property)}"` : `name="${escapeHtml(tag.name ?? '')}"`

  return `<meta ${key} content="${escapeHtml(tag.content)}">`
}).join('\n')
