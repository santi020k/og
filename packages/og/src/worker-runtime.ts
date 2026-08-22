import { pathToFileURL } from 'node:url'
import { parentPort, workerData } from 'node:worker_threads'

import type { OgRenderer } from './types.js'
import type { WorkerRequest, WorkerResponse, WorkerRuntimeData } from './worker-protocol.js'

const port = parentPort
const toUnknown = (value: unknown): unknown => value

if (!port) throw new Error('The OG worker runtime must run inside a worker thread.')

const runtimeValue = toUnknown(workerData)

if (
  typeof runtimeValue !== 'object' || runtimeValue === null ||
  !('module' in runtimeValue) || typeof runtimeValue.module !== 'string' ||
  !('exportName' in runtimeValue) || typeof runtimeValue.exportName !== 'string'
) {
  throw new TypeError('OG worker runtime received invalid initialization data.')
}

let factoryModule: string | undefined

if ('factoryModule' in runtimeValue) {
  if (typeof runtimeValue.factoryModule !== 'string') {
    throw new TypeError('OG worker runtime received invalid initialization data.')
  }

  factoryModule = runtimeValue.factoryModule
}

const runtime: WorkerRuntimeData = {
  exportName: runtimeValue.exportName,
  ...(factoryModule === undefined ? {} : { factoryModule }),
  module: runtimeValue.module
}

const imported = toUnknown(await import(pathToFileURL(runtime.module).href))

if (typeof imported !== 'object' || imported === null) {
  throw new TypeError(`Worker renderer module ${runtime.module} has no exports.`)
}

const namespace = imported as Record<string, unknown>
let candidate = namespace[runtime.exportName]
const isRenderer = (value: unknown): value is OgRenderer => typeof value === 'function'

const isRendererFactory = (value: unknown): value is ((options: unknown) => unknown) => (
  typeof value === 'function'
)

if (runtime.factoryModule) {
  const factoryNamespace = toUnknown(await import(pathToFileURL(runtime.factoryModule).href))

  if (typeof factoryNamespace !== 'object' || factoryNamespace === null) {
    throw new TypeError(`Worker renderer factory ${runtime.factoryModule} has no exports.`)
  }

  const factory = (factoryNamespace as Record<string, unknown>).default

  if (!isRendererFactory(factory)) {
    throw new TypeError(`Worker renderer factory ${runtime.factoryModule} must default-export a function.`)
  }

  candidate = factory(candidate)
}

if (!isRenderer(candidate)) {
  throw new TypeError(
    `Worker renderer module ${runtime.module} does not export a function named ${runtime.exportName}.`
  )
}

const renderer: OgRenderer = candidate

const handleRequest = async (request: WorkerRequest): Promise<void> => {
  let response: WorkerResponse

  try {
    response = {
      id: request.id,
      ok: true,
      output: await renderer(request.data, request.context)
    }
  } catch (error) {
    const caught = error instanceof Error ? error : new Error(String(error))

    response = {
      error: {
        message: caught.message,
        ...(caught.stack ? { stack: caught.stack } : {})
      },
      id: request.id,
      ok: false
    }
  }

  port.postMessage(response)
}

port.on('message', (request: WorkerRequest) => {
  void handleRequest(request)
})
