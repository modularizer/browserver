import type {
  BundlerFile,
  BuildSuccess,
  BuildFailure,
  WorkerRequest,
  WorkerResponse,
} from './protocol'

export type { BundlerFile, BuildSuccess, BuildFailure } from './protocol'

export type BundlerOptions = {
  wasmURL: string
  worker?: Worker
  workerURL?: string | URL
}

export type BuildArgs = {
  files: BundlerFile[]
  entry: string
  jsxDev?: boolean
  format?: 'esm' | 'iife' | 'cjs'
  globalName?: string // for iife
}

export class Bundler {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, (res: WorkerResponse) => void>()
  private ready: Promise<void>

  constructor(opts: BundlerOptions) {
    if (opts.worker) this.worker = opts.worker
    else if (opts.workerURL) this.worker = new Worker(opts.workerURL, { type: 'module' })
    else throw new Error('Bundler requires worker or workerURL')
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const cb = this.pending.get(ev.data.id)
      if (cb) {
        this.pending.delete(ev.data.id)
        cb(ev.data)
      }
    }
    this.ready = this.send({ type: 'init', wasmURL: opts.wasmURL }).then(() => undefined)
  }

  async build(args: BuildArgs): Promise<BuildSuccess | BuildFailure> {
    await this.ready
    const res = await this.send({ type: 'build', ...args })
    return res as BuildSuccess | BuildFailure
  }

  dispose() {
    this.worker.terminate()
    this.pending.clear()
  }

  private send(msg: { type: WorkerRequest['type'] } & Record<string, unknown>): Promise<WorkerResponse> {
    const id = this.nextId++
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.worker.postMessage({ ...msg, id } as unknown as WorkerRequest)
    })
  }
}
