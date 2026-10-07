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
  accent: '#b7a0f8',
  background: '#161719',
  foreground: '#f5f3ed',
  muted: '#a9abae',
  panel: '#232529'
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
  `fill="${escapeXml(parameters.color)}" font-family="${escapeXml(parameters.fontFamily)}" ` +
  `font-size="${parameters.fontSize}" font-weight="${parameters.fontWeight}">` +
  `${escapeXml(line)}</text>`
)).join('')

const variantLabel = (variant: PresetVariant): string => ({
  article: 'ARTICLE',
  docs: 'DOCUMENTATION',
  product: 'PRODUCT',
  simple: 'OPEN GRAPH'
})[variant]

const variantDecoration = (
  variant: PresetVariant,
  accent: string,
  theme: PresetTheme
): string => {
  const foreground = escapeXml(theme.foreground)
  const panel = escapeXml(theme.panel)
  const color = escapeXml(accent)

  if (variant === 'article') {
    return `
      <g transform="translate(814 174)">
        <rect x="10" y="14" width="276" height="316" rx="18" fill="${color}" opacity="0.14" transform="rotate(7 148 172)"/>
        <rect width="276" height="316" rx="18" fill="${panel}" stroke="${foreground}" stroke-opacity="0.18"/>
        <path d="M30 38h216" stroke="${color}" stroke-width="3"/>
        <rect x="30" y="64" width="164" height="14" rx="3" fill="${foreground}" opacity="0.88"/>
        <rect x="30" y="88" width="210" height="14" rx="3" fill="${foreground}" opacity="0.88"/>
        <rect x="30" y="126" width="216" height="94" rx="8" fill="url(#sculpture)"/>
        <path d="M30 248h96m-96 16h96m-96 16h74M150 248h96m-96 16h96m-96 16h72" stroke="${foreground}" stroke-opacity="0.32" stroke-width="5"/>
      </g>`
  }

  if (variant === 'docs') {
    return `
      <g transform="translate(798 174)">
        <path d="M36 4h108l20 24h128v284H36z" fill="${color}" opacity="0.18"/>
        <rect x="16" y="44" width="286" height="272" rx="18" fill="${panel}" stroke="${foreground}" stroke-opacity="0.14"/>
        <rect y="62" width="286" height="272" rx="18" fill="${panel}" stroke="${foreground}" stroke-opacity="0.22"/>
        <path d="M32 104h222" stroke="${foreground}" stroke-opacity="0.12"/>
        <circle cx="36" cy="84" r="4" fill="${color}"/>
        <circle cx="52" cy="84" r="4" fill="${foreground}" opacity="0.24"/>
        <circle cx="68" cy="84" r="4" fill="${foreground}" opacity="0.24"/>
        <path d="m74 146-28 28 28 28m138-56 28 28-28 28m-52-68-20 82" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M34 250h170m-170 22h218m-218 22h128" stroke="${foreground}" stroke-opacity="0.32" stroke-width="6"/>
      </g>`
  }

  if (variant === 'product') {
    return `
      <g transform="translate(786 156)">
        <rect width="334" height="352" rx="36" fill="${panel}" stroke="${foreground}" stroke-opacity="0.12"/>
        <circle cx="167" cy="170" r="111" fill="${color}" opacity="0.1"/>
        <circle cx="167" cy="170" r="83" fill="url(#sculpture)"/>
        <ellipse cx="167" cy="170" rx="126" ry="42" transform="rotate(-34 167 170)" fill="none" stroke="${foreground}" stroke-opacity="0.58" stroke-width="2"/>
        <circle cx="269" cy="100" r="8" fill="${color}"/>
        <path d="M139 307h56" stroke="${foreground}" stroke-opacity="0.25" stroke-width="5" stroke-linecap="round"/>
      </g>`
  }

  return ''
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
  const logo = await resolveImage(brand.logo, context, options.remoteImages, true)

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
  const maximumTitleWidth = hasVisual ? 590 : 990
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

  const badge = wrapMeasuredText({
    font,
    fontSize: 13,
    maximumLines: 1,
    maximumWidth: maximumTitleWidth * 0.76,
    value: (data.badge ?? data.eyebrow ?? variantLabel(variant)).toUpperCase()
  })[0] ?? ''

  const brandName = wrapMeasuredText({
    font,
    fontSize: 22,
    maximumLines: 1,
    maximumWidth: domain ? 600 : 990,
    value: brand.name
  })[0] ?? ''

  const domainLabel = domain ?
    wrapMeasuredText({
      font,
      fontSize: 16,
      maximumLines: 1,
      maximumWidth: 300,
      value: domain
    })[0] :
    undefined

  const titleY = 278
  const descriptionY = titleY + (titleLines.length - 1) * (titleSize * 1.06) + titleSize * 0.5 + 26
  const imageX = 778 + imagePresentation.padding
  const imageY = 156 + imagePresentation.padding
  const imageWidth = 350 - imagePresentation.padding * 2
  const imageHeight = 352 - imagePresentation.padding * 2
  const imageFit = imagePresentation.fit === 'contain' ? 'meet' : 'slice'

  const visual = image ?
    `<g clip-path="url(#visual)"><rect x="778" y="156" width="350" height="352" rx="40" fill="${escapeXml(imagePresentation.background)}"/><image href="${escapeXml(image)}" x="${imageX}" y="${imageY}" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="xMidYMid ${imageFit}"/></g><rect x="778" y="156" width="350" height="352" rx="40" fill="none" stroke="${escapeXml(theme.foreground)}" stroke-opacity="0.16"/>` :
    ''

  const customDecoration = await options.decoration?.(data, context, { accent, theme })
  const defaultDecoration = image || !hasVisual ? visual : variantDecoration(variant, accent, theme)
  const decoration = customDecoration === undefined ? defaultDecoration : ''

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${context.width} ${context.height}" role="img" aria-label="${escapeXml(data.title)}">
  <defs>
    <style>${font.css}</style>
    <radialGradient id="glow" cx="90%" cy="30%" r="70%">
      <stop stop-color="${escapeXml(accent)}" stop-opacity="0.14"/>
      <stop offset="1" stop-color="${escapeXml(theme.background)}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sculpture" cx="28%" cy="20%" r="80%">
      <stop stop-color="${escapeXml(theme.foreground)}" stop-opacity="0.86"/>
      <stop offset="0.36" stop-color="${escapeXml(accent)}"/>
      <stop offset="1" stop-color="${escapeXml(theme.panel)}"/>
    </radialGradient>
    <clipPath id="visual"><rect x="778" y="156" width="350" height="352" rx="40"/></clipPath>
  </defs>
  <g transform="scale(${context.width / 1200} ${context.height / 630})">
    <rect width="1200" height="630" fill="${escapeXml(theme.background)}"/>
    <rect width="1200" height="630" fill="url(#glow)"/>
    ${!hasVisual ? `<g fill="none" stroke="${escapeXml(accent)}" stroke-opacity="0.11"><circle cx="1118" cy="602" r="228" stroke-width="68"/><circle cx="1118" cy="602" r="142" stroke-width="2"/></g>` : ''}
    ${logo ? `<image href="${escapeXml(logo)}" x="72" y="70" width="32" height="32" preserveAspectRatio="xMidYMid meet"/>` : `<rect x="72" y="70" width="32" height="32" rx="10" fill="${escapeXml(accent)}"/><path d="M81 91V81h10m-6 10h10V81" fill="none" stroke="${escapeXml(theme.background)}" stroke-width="2.5" stroke-linejoin="round"/>`}
    <text x="118" y="94" fill="${escapeXml(theme.foreground)}" font-family="${escapeXml(font.family)}" font-size="22" font-weight="600">${escapeXml(brandName)}</text>
    ${domainLabel ? `<text x="1128" y="92" text-anchor="end" fill="${escapeXml(theme.muted)}" font-family="${escapeXml(font.family)}" font-size="16" font-weight="500">${escapeXml(domainLabel)}</text>` : ''}
    <path d="M72 132h1056" stroke="${escapeXml(theme.foreground)}" stroke-opacity="0.12"/>
    <circle cx="77" cy="183" r="4" fill="${escapeXml(accent)}"/>
    <text x="94" y="188" fill="${escapeXml(theme.muted)}" font-family="${escapeXml(font.family)}" font-size="13" font-weight="600" letter-spacing="1.5">${escapeXml(badge)}</text>
    ${textLines({ color: theme.foreground, fontFamily: font.family, fontSize: titleSize, fontWeight: 800, lineHeight: titleSize * 1.06, lines: titleLines, x: 72, y: titleY })}
    ${descriptionLines.length > 0 ? textLines({ color: theme.muted, fontFamily: font.family, fontSize: 23, fontWeight: 500, lineHeight: 34, lines: descriptionLines, x: 74, y: descriptionY }) : ''}
    <path d="M72 550h1056" stroke="${escapeXml(theme.foreground)}" stroke-opacity="0.12"/>
    <rect x="72" y="578" width="32" height="3" rx="1.5" fill="${escapeXml(accent)}"/>
    <text x="1128" y="585" text-anchor="end" fill="${escapeXml(theme.muted)}" font-family="${escapeXml(font.family)}" font-size="12" font-weight="500" letter-spacing="1.5">${variantLabel(variant)}</text>
    ${decoration}
  </g>
  ${customDecoration ?? ''}
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
