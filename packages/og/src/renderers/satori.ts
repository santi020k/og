import { Resvg } from '@resvg/resvg-js'
import satori, { type SatoriOptions } from 'satori'
import { html as createHtml } from 'satori-html'
import sharp from 'sharp'

import type { OgRenderContext, OgRenderer } from '../types.js'

import type { SharpRendererOptions } from './sharp.js'

type SatoriNode = Parameters<typeof satori>[0]

const isHtmlNode = (value: unknown): value is SatoriNode => (
  typeof value === 'object' && value !== null && 'type' in value && 'props' in value
)

/** Typed wrapper around satori-html whose upstream VNode type is structurally accepted by Satori. */
export const html = (
  templates: string | TemplateStringsArray,
  ...expressions: unknown[]
): SatoriNode => {
  const node: unknown = createHtml(templates, ...expressions)

  if (!isHtmlNode(node)) throw new TypeError('satori-html returned an invalid node.')

  return node
}

export interface SatoriRendererOptions<T> {
  /** Satori font definitions and other renderer options. Width and height come from each card. */
  satori: Omit<SatoriOptions, 'height' | 'width'>
  sharp?: Omit<SharpRendererOptions<never>, 'renderSvg'>
  template: (data: T, context: OgRenderContext) => Promise<SatoriNode> | SatoriNode
}

export const createSatoriRenderer = <T>(options: SatoriRendererOptions<T>): OgRenderer<T> => (
  async (data, context) => {
    const svg = await satori(await options.template(data, context), {
      ...options.satori,
      height: context.height,
      width: context.width
    })

    if (context.format === 'svg') return svg

    const png = Buffer.from(new Resvg(svg).render().asPng())

    if (context.format === 'png') return png

    const image = sharp(png)

    if (context.format === 'jpeg' || context.format === 'jpg') {
      return image.jpeg(options.sharp?.jpeg).toBuffer()
    }

    switch (context.format) {
      case 'avif':
        return image.avif(options.sharp?.avif).toBuffer()

      case 'webp':
        return image.webp(options.sharp?.webp).toBuffer()
    }
  }
)

export type { SatoriOptions }
