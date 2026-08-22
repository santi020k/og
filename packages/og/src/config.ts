import { fileURLToPath } from 'node:url'

import type { OgConfig, OgWorkerRenderer } from './types.js'

export const defineConfig = <T>(config: OgConfig<T>): OgConfig<T> => config

export interface WorkerRendererOptions {
  /** Named export containing an OgRenderer. Defaults to default. */
  exportName?: string
  /** Absolute path, file URL, or project-root-relative module path. */
  module: string | URL
}

export const defineWorkerRenderer = <T = unknown>(
  options: WorkerRendererOptions
): OgWorkerRenderer<T> => ({
  exportName: options.exportName ?? 'default',
  kind: 'worker',
  module: options.module instanceof URL ? fileURLToPath(options.module) : options.module
})

export const isWorkerRenderer = <T>(
  renderer: OgConfig<T>['renderer']
): renderer is OgWorkerRenderer<T> => typeof renderer !== 'function'
