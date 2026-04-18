export type BundlerFile = {
  path: string
  contents: string
}

export type BuildRequest = {
  id: number
  type: 'build'
  files: BundlerFile[]
  entry: string
  jsxDev?: boolean
  format?: 'esm' | 'iife' | 'cjs'
  globalName?: string
  /** Bare-specifier → vfs path redirects, consulted before the CDN fallback. */
  importAliases?: Record<string, string>
}

export type InitRequest = {
  id: number
  type: 'init'
  wasmURL: string
}

export type WorkerRequest = InitRequest | BuildRequest

export type BuildOutput = {
  path: string
  contents: string
}

export type BuildWarning = {
  text: string
  location?: { file: string; line: number; column: number } | null
}

export type BuildSuccess = {
  id: number
  ok: true
  outputs: BuildOutput[]
  warnings: BuildWarning[]
  durationMs: number
}

export type BuildFailure = {
  id: number
  ok: false
  errors: BuildWarning[]
  warnings: BuildWarning[]
}

export type WorkerResponse = BuildSuccess | BuildFailure | { id: number; ok: true; type: 'init' }
