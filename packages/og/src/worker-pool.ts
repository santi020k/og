import { Worker } from 'node:worker_threads'

import type { OgRenderContext, OgRenderOutput, OgWorkerRenderer } from './types.js'
import type { WorkerRequest, WorkerResponse, WorkerRuntimeData } from './worker-protocol.js'

interface PendingJob {
  context: OgRenderContext
  data: unknown
  reject: (error: Error) => void
  resolve: (output: OgRenderOutput) => void
}

interface ActiveJob extends PendingJob {
  id: number
}

export class OgWorkerPool {
  readonly #active = new Map<Worker, ActiveJob>()
  readonly #idle: Worker[] = []
  readonly #queue: PendingJob[] = []
  readonly #workers: Worker[] = []
  #closing = false
  #nextId = 1

  constructor(renderer: OgWorkerRenderer, size: number) {
    const runtimeUrl = new URL('./worker-runtime.js', import.meta.url)

    const workerData: WorkerRuntimeData = {
      exportName: renderer.exportName,
      module: renderer.module
    }

    for (let index = 0; index < size; index += 1) {
      const worker = new Worker(runtimeUrl, { workerData })

      worker.on('error', error => {
        this.#failWorker(worker, error)
      })

      worker.on('exit', code => {
        if (!this.#closing && code !== 0) {
          this.#failWorker(worker, new Error(`OG renderer worker exited with code ${code}.`))
        }
      })

      worker.on('message', (response: WorkerResponse) => {
        this.#finish(worker, response)
      })

      this.#workers.push(worker)

      this.#idle.push(worker)
    }
  }

  render(data: unknown, context: OgRenderContext): Promise<OgRenderOutput> {
    return new Promise((resolve, reject) => {
      this.#queue.push({ context, data, reject, resolve })

      this.#dispatch()
    })
  }

  async close(): Promise<void> {
    this.#closing = true

    await Promise.all(this.#workers.map(worker => worker.terminate()))
  }

  #dispatch(): void {
    while (this.#idle.length > 0 && this.#queue.length > 0) {
      const worker = this.#idle.shift()
      const job = this.#queue.shift()

      if (!worker || !job) return

      const active: ActiveJob = { ...job, id: this.#nextId }

      const request: WorkerRequest = {
        context: job.context,
        data: job.data,
        id: active.id
      }

      this.#nextId += 1

      this.#active.set(worker, active)

      worker.postMessage(request)
    }
  }

  #failWorker(worker: Worker, error: Error): void {
    const active = this.#active.get(worker)

    this.#active.delete(worker)

    this.#removeIdle(worker)

    active?.reject(error)

    for (const job of this.#queue.splice(0)) job.reject(error)
  }

  #finish(worker: Worker, response: WorkerResponse): void {
    const active = this.#active.get(worker)

    if (active?.id !== response.id) {
      this.#failWorker(worker, new Error('Received an unexpected OG renderer worker response.'))

      return
    }

    this.#active.delete(worker)

    this.#idle.push(worker)

    if (response.ok) {
      active.resolve(response.output)
    } else {
      const error = new Error(response.error.message)

      if (response.error.stack) error.stack = response.error.stack

      active.reject(error)
    }

    this.#dispatch()
  }

  #removeIdle(worker: Worker): void {
    const index = this.#idle.indexOf(worker)

    if (index >= 0) this.#idle.splice(index, 1)
  }
}
