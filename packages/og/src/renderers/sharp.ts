import sharp, {
  type AvifOptions,
  type JpegOptions,
  type PngOptions,
  type WebpOptions
} from 'sharp'

import type { Awaitable, OgRenderContext, OgRenderer } from '../types.js'

export interface SharpRendererOptions<T> {
  avif?: AvifOptions
  jpeg?: JpegOptions
  png?: PngOptions
  renderSvg: (data: T, context: OgRenderContext) => Awaitable<string>
  webp?: WebpOptions
}

export const encodeSvg = async (
  svg: string,
  context: OgRenderContext,
  options: Omit<SharpRendererOptions<never>, 'renderSvg'> = {}
): Promise<Buffer | string> => {
  if (context.format === 'svg') return svg

  const image = sharp(Buffer.from(svg)).resize({
    fit: 'fill',
    height: context.height,
    width: context.width
  })

  if (context.format === 'jpeg' || context.format === 'jpg') {
    return image.jpeg(options.jpeg).toBuffer()
  }

  switch (context.format) {
    case 'avif':
      return image.avif(options.avif).toBuffer()

    case 'png':
      return image.png(options.png).toBuffer()

    case 'webp':
      return image.webp(options.webp).toBuffer()
  }
}

export const createSharpRenderer = <T>(options: SharpRendererOptions<T>): OgRenderer<T> => {
  const { renderSvg, ...encoderOptions } = options

  return async (data, context) => encodeSvg(
    await renderSvg(data, context),
    context,
    encoderOptions
  )
}
