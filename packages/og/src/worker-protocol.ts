import type { OgRenderContext, OgRenderOutput } from './types.js'

export interface WorkerRequest {
  context: OgRenderContext
  data: unknown
  id: number
}

export type WorkerResponse =
  | { error: { message: string, stack?: string }, id: number, ok: false } |
  { id: number, ok: true, output: OgRenderOutput }

export interface WorkerRuntimeData {
  exportName: string
  factoryModule?: string
  module: string
}
