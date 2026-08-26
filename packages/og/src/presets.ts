import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

import { createSharpRenderer, type SharpRendererOptions } from './renderers/sharp.js'
import { defineConfig } from './config.js'
import { markPresetRenderer } from './preset-marker.js'
import {
  materializeRemoteImage,
  type PresetRemoteImage,
  type PresetRemoteImageOptions
} from './remote-image.js'
import type { Awaitable, OgConfig, OgRenderContext, OgRenderer } from './types.js'
import {
  loadPresetFont,
  type PresetTypographyOptions,
  wrapMeasuredText
} from './typography.js'
import { PRESET_VERSION } from './version.js'

export type PresetVariant = 'article' | 'docs' | 'product' | 'simple'

export interface PresetBrand {
  domain?: string
  logo?: PresetImage
  name: string
}

export type PresetImage = PresetRemoteImage | string
export type PresetImageFit = 'contain' | 'cover'

export interface PresetImagePresentation {
  /** Surface behind the image. Defaults to the preset panel color. */
  background?: string
  /** Preserve the complete image or fill and crop the visual slot. Defaults to cover. */
  fit?: PresetImageFit
  /** Inset from every edge of the visual slot in output pixels. Defaults to 0. */
  padding?: number
}

export interface PresetCardData {
  accent?: string
  badge?: string
  brand?: Partial<PresetBrand>
  description?: string
  domain?: string
  eyebrow?: string
  image?: PresetImage
  imagePresentation?: PresetImagePresentation
  title: string
  variant?: PresetVariant
}

export interface PresetTheme {
  accent: string
  background: string
  foreground: string
  muted: string
  panel: string
}

export interface PresetDecorationContext {
  accent: string
  theme: Readonly<PresetTheme>
}

export interface PresetRendererOptions<T extends PresetCardData = PresetCardData> {
  brand?: PresetBrand
  /** Trusted SVG fragment rendered in the visual slot instead of the built-in decoration. */
  decoration?: (
    data: Readonly<T>,
    context: Readonly<OgRenderContext>,
    decoration: Readonly<PresetDecorationContext>
  ) => Awaitable<string | undefined>
  /** Opt into content-addressed downloads for remote image descriptors. */
  remoteImages?: false | PresetRemoteImageOptions
  /** Default presentation for card images. Individual cards can override each field. */
  imagePresentation?: PresetImagePresentation
  sharp?: Omit<SharpRendererOptions<never>, 'renderSvg'>
  theme?: Partial<PresetTheme>
  typography?: PresetTypographyOptions
  variant?: PresetVariant
}

export interface PresetConfig<T extends PresetCardData = PresetCardData>
  extends Omit<OgConfig<T>, 'renderer'> {
  preset?: PresetRendererOptions<T>
}

const DEFAULT_THEME: PresetTheme = {
  accent: '#7c3aed',
  background: '#0f172a',
  foreground: '#f8fafc',
  muted: '#cbd5e1',
  panel: '#1e293b'
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

const SVG_EMBEDDABLE_RASTER_TYPES = new Set([
  'image/jpeg',
  'image/png'
])

const escapeXml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll('\'', '&#39;')

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath)

    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false

    throw error
  }
}

const resolveImage = async (
  source: PresetImage | undefined,
  context: OgRenderContext,
  remoteImages: PresetRendererOptions['remoteImages'],
  normalizeRaster = false
): Promise<string | undefined> => {
  if (!source) return undefined

  if (typeof source !== 'string') {
    if (!remoteImages) {
      throw new Error('Remote preset image descriptors require preset.remoteImages to be configured.')
    }

    source = await materializeRemoteImage(source, context.root, remoteImages)
  }

  if (source.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.+)$/u.exec(source)

    if (!normalizeRaster || !match || SVG_EMBEDDABLE_RASTER_TYPES.has(match[1] ?? '')) return source

    if (match[1] === 'image/svg+xml') return source

    const normalized = await sharp(Buffer.from(match[2] ?? '', 'base64'))
      .png({ adaptiveFiltering: true, compressionLevel: 9 })
      .toBuffer()

    return `data:image/png;base64,${normalized.toString('base64')}`
  }

  if (/^https?:\/\//u.test(source)) {
    throw new Error('Remote preset image URLs must use a pinned { url, sha256, type } descriptor.')
  }

  const filePath = path.isAbsolute(source) ? source : path.resolve(context.root, source)

  if (!await exists(filePath)) return source

  const mime = MIME_TYPES[path.extname(filePath).toLowerCase()]

  if (!mime) throw new Error(`Unsupported preset image format: ${source}`)

  const bytes = await readFile(filePath)

  if (!normalizeRaster || mime === 'image/svg+xml' || SVG_EMBEDDABLE_RASTER_TYPES.has(mime)) {
    return `data:${mime};base64,${bytes.toString('base64')}`
  }

  const normalized = await sharp(bytes)
    .png({ adaptiveFiltering: true, compressionLevel: 9 })
    .toBuffer()

  return `data:image/png;base64,${normalized.toString('base64')}`
}

const textLines = (parameters: {
  color: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  lineHeight: number
  lines: readonly string[]
  x: number
  y: number
}): string => parameters.lines.map((line, index) => (
  `<text x="${parameters.x}" y="${parameters.y + index * parameters.lineHeight}" ` +
  `fill="${parameters.color}" font-family="${escapeXml(parameters.fontFamily)}" ` +
  `font-size="${parameters.fontSize}" font-weight="${parameters.fontWeight}">` +
  `${escapeXml(line)}</text>`
)).join('')

const variantLabel = (variant: PresetVariant): string => ({
  article: 'ARTICLE',
  docs: 'DOCUMENTATION',
  product: 'PRODUCT',
  simple: 'OPEN GRAPH'
})[variant]

const variantDecoration = (variant: PresetVariant, accent: string): string => {
  if (variant === 'article') {
    return `
      <g transform="translate(790 178)">
        <rect width="326" height="310" rx="34" fill="#ffffff0d" stroke="#ffffff21"/>
        <rect x="38" y="48" width="250" height="18" rx="9" fill="${accent}" opacity="0.8"/>
        <rect x="38" y="94" width="218" height="12" rx="6" fill="#ffffff6b"/>
        <rect x="38" y="126" width="246" height="12" rx="6" fill="#ffffff4d"/>
        <rect x="38" y="158" width="186" height="12" rx="6" fill="#ffffff4d"/>
        <circle cx="62" cy="244" r="24" fill="${accent}" opacity="0.72"/>
        <rect x="102" y="228" width="154" height="12" rx="6" fill="#ffffff6b"/>
        <rect x="102" y="252" width="104" height="9" rx="4.5" fill="#ffffff3d"/>
      </g>`
  }

  if (variant === 'docs') {
    return `
      <g transform="translate(818 170)" fill="none" stroke-linecap="round">
        <rect width="286" height="326" rx="32" fill="#ffffff0d" stroke="#ffffff21"/>
        <path d="M50 78h186M50 126h142M50 174h186M50 222h116" stroke="#ffffff61" stroke-width="14"/>
        <path d="M50 270h92" stroke="${accent}" stroke-width="14"/>
      </g>`
  }

  if (variant === 'product') {
    return `
      <g transform="translate(796 164)">
        <rect width="320" height="340" rx="44" fill="${accent}" opacity="0.16"/>
        <rect x="34" y="32" width="252" height="276" rx="30" fill="#0f172abd" stroke="#ffffff29"/>
        <circle cx="160" cy="132" r="62" fill="${accent}" opacity="0.88"/>
        <path d="M132 132h56M160 104v56" stroke="white" stroke-width="12" stroke-linecap="round"/>
        <rect x="78" y="230" width="164" height="16" rx="8" fill="#ffffff6b"/>
        <rect x="108" y="262" width="104" height="11" rx="5.5" fill="#ffffff3d"/>
      </g>`
  }

  return `
    <g transform="translate(846 194)">
      <circle cx="120" cy="120" r="118" fill="${accent}" opacity="0.16"/>
      <circle cx="120" cy="120" r="74" fill="none" stroke="${accent}" stroke-width="3" opacity="0.76"/>
      <circle cx="120" cy="120" r="24" fill="${accent}"/>
    </g>`
}

const renderPresetSvg = async <T extends PresetCardData>(
  data: T,
  context: OgRenderContext,
  options: PresetRendererOptions<T>
): Promise<string> => {
  const variant = data.variant ?? options.variant ?? 'simple'
  const theme = { ...DEFAULT_THEME, ...options.theme }
  const accent = data.accent ?? theme.accent
  const brand = { name: 'Open Graph', ...options.brand, ...data.brand }
  const domain = data.domain ?? brand.domain
  const image = await resolveImage(data.image, context, options.remoteImages, true)
  const logo = await resolveImage(brand.logo, context, options.remoteImages)

  const imagePresentation = {
    background: theme.panel,
    fit: 'cover' as PresetImageFit,
    padding: 0,
    ...options.imagePresentation,
    ...data.imagePresentation
  }

  if (!Number.isFinite(imagePresentation.padding) ||
    imagePresentation.padding < 0 || imagePresentation.padding >= 175) {
    throw new Error('Preset image presentation padding must be between 0 and 174 pixels.')
  }

  const hasVisual = Boolean(image) || variant !== 'simple'
  const font = await loadPresetFont(options.typography, context.root)
  const maximumTitleWidth = hasVisual ? 650 : Math.min(990, context.width - 144)
  const titleSizes = hasVisual ? [60, 54, 48] : [76, 66, 56]

  const titleLayout = titleSizes
    .map(fontSize => ({
      fontSize,
      lines: wrapMeasuredText({
        font,
        fontSize,
        maximumLines: 3,
        maximumWidth: maximumTitleWidth,
        value: data.title
      })
    }))
    .find(layout => !layout.lines.at(-1)?.endsWith('…')) ?? {
    fontSize: titleSizes.at(-1) ?? 48,
    lines: wrapMeasuredText({
      font,
      fontSize: titleSizes.at(-1) ?? 48,
      maximumLines: 3,
      maximumWidth: maximumTitleWidth,
      value: data.title
    })
  }

  const titleSize = titleLayout.fontSize
  const titleLines = titleLayout.lines

  const descriptionLines = data.description ?
    wrapMeasuredText({
      font,
      fontSize: 23,
      maximumLines: 2,
      maximumWidth: maximumTitleWidth,
      value: data.description
    }) :
    []

  const badge = data.badge ?? data.eyebrow ?? variantLabel(variant)
  const contentWidth = hasVisual ? 650 : 990
  const descriptionY = 354 + (titleLines.length - 1) * (titleSize * 1.06) + 46
  const imageX = 778 + imagePresentation.padding
  const imageY = 156 + imagePresentation.padding
  const imageWidth = 350 - imagePresentation.padding * 2
  const imageHeight = 352 - imagePresentation.padding * 2
  const imageFit = imagePresentation.fit === 'contain' ? 'meet' : 'slice'

  const visual = image ?
    `<g clip-path="url(#visual)"><rect x="778" y="156" width="350" height="352" rx="40" fill="${escapeXml(imagePresentation.background)}"/><image href="${escapeXml(image)}" x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="xMidYMid ${imageFit}"/></g><rect x="778" y="156" width="350" height="352" rx="40" fill="none" stroke="white" stroke-opacity="0.16"/>` :
    ''

  const customDecoration = await options.decoration?.(data, context, { accent, theme })
  const decoration = customDecoration ?? (image || !hasVisual ? visual : variantDecoration(variant, accent))

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${context.width} ${context.height}" role="img" aria-label="${escapeXml(data.title)}">
  <defs>
    <style>${font.css}</style>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(${context.width * 0.88} ${context.height * 0.14}) rotate(135) scale(${context.width * 0.66})">
      <stop stop-color="${accent}" stop-opacity="0.42"/>
      <stop offset="1" stop-color="${theme.background}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse">
      <path d="M52 0H0v52" fill="none" stroke="white" stroke-opacity="0.045"/>
    </pattern>
    <clipPath id="visual"><rect x="778" y="156" width="350" height="352" rx="40"/></clipPath>
  </defs>
  <rect width="100%" height="100%" fill="${theme.background}"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <rect width="100%" height="100%" fill="url(#grid)"/>
  <rect x="28" y="28" width="${context.width - 56}" height="${context.height - 56}" rx="38" fill="none" stroke="white" stroke-opacity="0.08"/>
  ${logo ? `<image href="${escapeXml(logo)}" x="72" y="62" width="64" height="64" preserveAspectRatio="xMidYMid meet"/>` : `<rect x="72" y="62" width="64" height="64" rx="18" fill="${accent}"/><circle cx="104" cy="94" r="12" fill="white" opacity="0.92"/>`}
  <text x="154" y="91" fill="${theme.foreground}" font-family="${escapeXml(font.family)}" font-size="26" font-weight="800">${escapeXml(brand.name)}</text>
  ${domain ? `<text x="154" y="118" fill="${theme.muted}" font-family="${escapeXml(font.family)}" font-size="15" font-weight="600">${escapeXml(domain)}</text>` : ''}
  <g transform="translate(72 166)">
    <rect width="${Math.min(360, badge.length * 10 + 54)}" height="38" rx="19" fill="${theme.panel}" stroke="${accent}" stroke-opacity="0.62"/>
    <circle cx="20" cy="19" r="5" fill="${accent}"/>
    <text x="36" y="25" fill="${theme.foreground}" font-family="${escapeXml(font.family)}" font-size="13" font-weight="800" letter-spacing="1.5">${escapeXml(badge.toUpperCase())}</text>
  </g>
  ${textLines({ color: theme.foreground, fontFamily: font.family, fontSize: titleSize, fontWeight: 800, lineHeight: titleSize * 1.06, lines: titleLines, x: 72, y: 294 })}
  ${descriptionLines.length > 0 ? textLines({ color: theme.muted, fontFamily: font.family, fontSize: 23, fontWeight: 500, lineHeight: 34, lines: descriptionLines, x: 74, y: descriptionY }) : ''}
  <rect x="72" y="578" width="${Math.min(contentWidth, 190)}" height="5" rx="2.5" fill="${accent}"/>
  ${decoration}
</svg>`.replaceAll(/[ \t]+$/gmu, '').trim()
}

export const createPresetRenderer = <T extends PresetCardData = PresetCardData>(
  options: PresetRendererOptions<T> = {}
): OgRenderer<T> => markPresetRenderer(createSharpRenderer<T>({
  ...options.sharp,
  renderSvg: (data, context) => renderPresetSvg(data, context, options),
  webp: options.sharp?.webp ?? { effort: 4, quality: 86 }
}))

export const definePresetConfig = <T extends PresetCardData = PresetCardData>(
  config: PresetConfig<T>
): OgConfig<T> => {
  const { preset, ...shared } = config
  const configuredCache = shared.cache
  const configuredSources = typeof configuredCache === 'object' ? configuredCache.sources : undefined
  const typographyFile = preset?.typography?.file
  const configuredLogo = preset?.brand?.logo
  const remoteLogoDigest = typeof configuredLogo === 'object' ? configuredLogo.sha256.toLowerCase() : undefined

  const cache = configuredCache === false ?
    false :
    {
      ...(typeof configuredCache === 'object' ? configuredCache : {}),
      key: [
        `preset-v${PRESET_VERSION}`,
        remoteLogoDigest ? `remote-logo-${remoteLogoDigest}` : undefined,
        typeof configuredCache === 'object' ? configuredCache.key : undefined
      ].filter(Boolean).join(':'),
      ...(typographyFile ?
        {
          sources: async () => [
            ...(typeof configuredSources === 'function' ? await configuredSources() : configuredSources ?? []),
            typographyFile
          ]
        } :
        {})
    }

  return defineConfig({ ...shared, cache, renderer: createPresetRenderer<T>(preset) })
}

export type {
  PresetRemoteImage,
  PresetRemoteImageOptions,
  PresetRemoteImageType
} from './remote-image.js'
export { materializeRemoteImage } from './remote-image.js'
export type { PresetTypographyOptions } from './typography.js'
