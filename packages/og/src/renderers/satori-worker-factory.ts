import type { OgRenderer } from '../types.js'

import { createSatoriRenderer, type SatoriRendererOptions } from './satori.js'

export default <T>(options: SatoriRendererOptions<T>): OgRenderer<T> => createSatoriRenderer(options)
