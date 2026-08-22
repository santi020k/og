import path from 'node:path'

import type {
  Awaitable,
  OgCard,
  OgOutputTarget,
  OgRenderContext,
  OgRenderer,
  OgRenderOutput
} from './types.js'

export interface LegacyCardSpec<T> {
  aliases?: readonly (string | OgOutputTarget)[]
  height?: number
  outFile: string
  props: T
  sources?: OgCard<T>['sources']
  width?: number
}

/** Convert the common legacy `{ outFile, props }` shape into cards. */
export const fromLegacyCards = <T>(specs: readonly LegacyCardSpec<T>[]): OgCard<T>[] => (
  specs.map(spec => ({
    data: spec.props,
    output: spec.outFile,
    ...(spec.aliases ? { aliases: spec.aliases } : {}),
    ...(spec.height === undefined ? {} : { height: spec.height }),
    ...(spec.sources ? { sources: spec.sources } : {}),
    ...(spec.width === undefined ? {} : { width: spec.width })
  }))
)

/** Derive a portable card output from a path inside outputDirectory. */
export const relativeOutput = (outputDirectory: string, outFile: string): string => {
  const relative = path.relative(path.resolve(outputDirectory), path.resolve(outFile))

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Output must stay inside ${path.resolve(outputDirectory)}: ${outFile}`)
  }

  return relative.split(path.sep).join('/')
}

/** Give an existing encoded PNG/WebP/etc. function the OgRenderer type. */
export const createEncodedRenderer = <T>(
  render: (data: T, context: OgRenderContext) => Awaitable<OgRenderOutput>
): OgRenderer<T> => ((data, context) => render(data, context))
