import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { createSatoriRenderer, html } from '../src/renderers/satori.js'
import { createSharpRenderer } from '../src/renderers/sharp.js'
import type { OgRenderContext } from '../src/types.js'

const context = (format: OgRenderContext['format']): OgRenderContext => ({
  format,
  height: 315,
  outputPath: `/tmp/card.${format}`,
  root: '/tmp',
  width: 600
})

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 315"><rect width="600" height="315" fill="#6d28d9"/></svg>'

describe('createSharpRenderer', () => {
  it('preserves SVG output', async () => {
    const renderer = createSharpRenderer({ renderSvg: () => svg })

    await expect(renderer({}, context('svg'))).resolves.toBe(svg)
  })

  it.each(['png', 'webp', 'jpg', 'avif'] as const)('encodes %s at the requested dimensions', async format => {
    const renderer = createSharpRenderer({ renderSvg: () => svg })
    const output = await renderer({}, context(format))
    const metadata = await sharp(output).metadata()

    const expectedFormat = new Map([
      ['avif', 'heif'],
      ['jpg', 'jpeg']
    ]).get(format) ?? format

    expect(metadata.width).toBe(600)

    expect(metadata.height).toBe(315)

    expect(metadata.format).toBe(expectedFormat)
  })
})

describe('createSatoriRenderer', () => {
  const renderer = createSatoriRenderer({
    satori: { fonts: [] },
    template: () => html`
      <div style="display:flex;width:100%;height:100%;background:#111827"></div>
    `
  })

  it('preserves generated SVG', async () => {
    const output = await renderer({}, context('svg'))

    expect(output.toString()).toContain('<svg')
  })

  it.each(['png', 'webp'] as const)('rasterizes and encodes %s output', async format => {
    const output = await renderer({}, context(format))
    const metadata = await sharp(output).metadata()

    expect(metadata.format).toBe(format)

    expect(metadata.width).toBe(600)

    expect(metadata.height).toBe(315)
  })
})
