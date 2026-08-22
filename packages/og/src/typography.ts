import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import { create, type Font } from 'fontkit'

const packageRequire = createRequire(import.meta.url)

const bundledFontPath = packageRequire.resolve(
  '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'
)

const fontCache = new Map<string, Promise<PresetFont>>()
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const graphemes = (value: string): string[] => Array.from(
  graphemeSegmenter.segment(value),
  segment => segment.segment
)

export interface PresetTypographyOptions {
  family?: string
  file?: string
}

export interface PresetFont {
  css: string
  family: string
  measure: (value: string, fontSize: number) => number
}

const isFont = (value: ReturnType<typeof create>): value is Font => 'layout' in value

const fontMime = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.woff2') return 'font/woff2'

  if (extension === '.woff') return 'font/woff'

  if (extension === '.otf') return 'font/otf'

  return 'font/ttf'
}

const loadFont = async (filePath: string, family: string): Promise<PresetFont> => {
  const buffer = await readFile(filePath)
  const parsed = create(buffer)

  if (!isFont(parsed)) throw new Error(`Preset font collections are not supported: ${filePath}`)

  const encoded = buffer.toString('base64')
  const escapedFamily = family.replaceAll('\\', '\\\\').replaceAll('"', '\\"')

  return {
    css: `@font-face{font-family:"${escapedFamily}";src:url(data:${fontMime(filePath)};base64,${encoded});font-style:normal;font-weight:100 900}`,
    family,
    measure: (value, fontSize) => parsed.layout(value).advanceWidth / parsed.unitsPerEm * fontSize
  }
}

export const loadPresetFont = (
  options: PresetTypographyOptions | undefined,
  root: string
): Promise<PresetFont> => {
  const filePath = options?.file ? path.resolve(root, options.file) : bundledFontPath
  const family = options?.family ?? 'Inter Variable'
  const key = `${filePath}\0${family}`
  const cached = fontCache.get(key)

  if (cached) return cached

  const loaded = loadFont(filePath, family)

  fontCache.set(key, loaded)

  return loaded
}

const truncateToWidth = (
  value: string,
  maximumWidth: number,
  fontSize: number,
  font: PresetFont
): string => {
  const ellipsis = '…'
  let output = value.replace(/[,.!?;:]?$/u, '')

  while (output && font.measure(`${output}${ellipsis}`, fontSize) > maximumWidth) {
    output = graphemes(output).slice(0, -1).join('')
  }

  return `${output}${ellipsis}`
}

const splitToken = (
  token: string,
  maximumWidth: number,
  fontSize: number,
  font: PresetFont
): string[] => {
  const pieces: string[] = []
  let current = ''

  for (const character of graphemes(token)) {
    if (current && font.measure(`${current}${character}`, fontSize) > maximumWidth) {
      pieces.push(current)

      current = character
    } else {
      current += character
    }
  }

  if (current) pieces.push(current)

  return pieces
}

export const wrapMeasuredText = (parameters: {
  font: PresetFont
  fontSize: number
  maximumLines: number
  maximumWidth: number
  value: string
}): string[] => {
  const words = parameters.value.trim().split(/\s+/u).flatMap(word => (
    parameters.font.measure(word, parameters.fontSize) > parameters.maximumWidth ?
      splitToken(word, parameters.maximumWidth, parameters.fontSize, parameters.font) :
      [word]
  ))

  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const next = current ? `${current} ${word}` : word

    if (current && parameters.font.measure(next, parameters.fontSize) > parameters.maximumWidth) {
      lines.push(current)

      current = word
    } else {
      current = next
    }

    if (lines.length === parameters.maximumLines) break
  }

  if (current && lines.length < parameters.maximumLines) lines.push(current)

  const rendered = lines.join(' ')

  if (rendered.length < parameters.value.trim().length && lines.length > 0) {
    const last = lines.length - 1

    lines[last] = truncateToWidth(
      lines[last] ?? '',
      parameters.maximumWidth,
      parameters.fontSize,
      parameters.font
    )
  }

  return lines
}
