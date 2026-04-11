import {
  startClientSideServerFromSource,
} from '@modularizer/plat-client/client-server'
import type {
  LocalRuntimeHandle,
} from './types'

type StaticExports = {
  StaticFolder: new (source: unknown, opts?: unknown) => unknown
  FileResponse: {
    from: (...args: unknown[]) => unknown
  }
}

function debugLocalTsRuntime(event: string, detail?: unknown): void {
  if (detail === undefined) {
    console.debug(`[LocalTsRuntime] ${event}`)
    return
  }
  console.debug(`[LocalTsRuntime] ${event}`, detail)
}

/** File extensions that are static assets (not code) */
const STATIC_EXTENSIONS = new Set([
  '.html', '.css', '.json', '.txt', '.md',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot',
  '.xml', '.csv', '.pdf',
])

function isStaticAsset(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return STATIC_EXTENSIONS.has(path.slice(dot).toLowerCase())
}

export interface WorkspaceFileEntry {
  path: string
  content: string
}

/**
 * Workspace files are stored as `/<sampleId>/...` paths in studio.
 * Strip that leading segment so server static roots resolve like normal project files.
 */
function toProjectRelativePath(workspacePath: string): string {
  const trimmed = workspacePath.replace(/^\/+/, '')
  const slashIndex = trimmed.indexOf('/')
  if (slashIndex < 0) return trimmed
  return trimmed.slice(slashIndex + 1)
}

export async function startLocalTsRuntime(options: {
  source: string | Record<string, string>
  serverName: string
  workspaceFiles?: WorkspaceFileEntry[]
  onRequest?: (direction: 'request' | 'response', payload: unknown) => void
}): Promise<LocalRuntimeHandle> {
  debugLocalTsRuntime('start.begin', {
    serverName: options.serverName,
    sourceKind: typeof options.source,
    workspaceFileCount: options.workspaceFiles?.length ?? 0,
  })

  const staticExports = await resolveStaticExports()
  const staticAlias = createStaticAliasModuleUrl(staticExports)
  const rewrittenSource = rewriteStaticImports(options.source, staticAlias.url)

  // Inject workspace static files as a global so user code can reference __workspaceFiles
  if (options.workspaceFiles) {
    const staticFiles: Record<string, string> = {}
    const normalizedStaticKeys: string[] = []
    for (const file of options.workspaceFiles) {
      if (isStaticAsset(file.path)) {
        const key = toProjectRelativePath(file.path)
        staticFiles[key] = file.content
        normalizedStaticKeys.push(key)
      }
    }
    ;(globalThis as any).__workspaceFiles = staticFiles
    debugLocalTsRuntime('workspace-files.injected', {
      serverName: options.serverName,
      staticFileCount: normalizedStaticKeys.length,
      staticFileKeysPreview: normalizedStaticKeys.slice(0, 30),
      hasIndexHtml: normalizedStaticKeys.includes('index.html'),
    })
  } else {
    ;(globalThis as any).__workspaceFiles = {}
    debugLocalTsRuntime('workspace-files.injected', {
      serverName: options.serverName,
      staticFileCount: 0,
      staticFileKeysPreview: [],
      hasIndexHtml: false,
    })
  }

  const started = await startClientSideServerFromSource({
    source: rewrittenSource,
    serverName: options.serverName,
    sourceEntryPoint: typeof options.source === 'object' && 'index.ts' in options.source ? 'index.ts' : undefined,
    onRequest: options.onRequest,
  })

  const connectionUrl = started.connectionUrl
  const resolvedServerName = connectionUrl?.startsWith('css://')
    ? connectionUrl.slice('css://'.length)
    : options.serverName

  debugLocalTsRuntime('start.ready', {
    requestedServerName: options.serverName,
    resolvedServerName,
    connectionUrl,
  })

  return {
    language: 'typescript',
    launchable: true,
    serverName: resolvedServerName,
    connectionUrl,
    server: started.server,
    async stop() {
      debugLocalTsRuntime('stop.begin', {
        serverName: resolvedServerName,
        connectionUrl,
      })
      if (started && typeof (started as any).stop === 'function') {
        await (started as any).stop()
      }
      staticAlias.dispose()
      delete (globalThis as any).__workspaceFiles
      debugLocalTsRuntime('stop.done', {
        serverName: resolvedServerName,
      })
    },
  }
}

function createStaticAliasModuleUrl(staticExports: StaticExports): { url: string; dispose(): void } {
  const registry = ((globalThis as any).__browserverStaticModuleRegistry ??= new Map<string, Record<string, unknown>>()) as Map<string, Record<string, unknown>>
  const id = `static-${crypto.randomUUID()}`
  registry.set(id, staticExports as unknown as Record<string, unknown>)

  const code = [
    'const __registry = globalThis.__browserverStaticModuleRegistry',
    `const __m = __registry?.get(${JSON.stringify(id)})`,
    `if (!__m) throw new Error('Missing static module alias: ${id}')`,
    'export const StaticFolder = __m.StaticFolder',
    'export const FileResponse = __m.FileResponse',
  ].join('\n')

  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  return {
    url,
    dispose() {
      registry.delete(id)
      URL.revokeObjectURL(url)
    },
  }
}

async function resolveStaticExports(): Promise<StaticExports> {
  const candidates = [
    '@modularizer/plat-client/static',
    '@modularizer/plat/static',
    '@modularizer/plat-client',
    '@modularizer/plat',
  ]

  for (const specifier of candidates) {
    const loaded = await importStaticExportsCandidate(specifier)
    if (loaded) return loaded
  }

  return createCompatStaticExports()
}

async function importStaticExportsCandidate(specifier: string): Promise<StaticExports | null> {
  try {
    // Keep specifier dynamic so Vite does not fail import analysis when a subpath export is absent.
    const mod = await import(/* @vite-ignore */ specifier)
    return hasStaticExports(mod) ? mod : null
  } catch {
    return null
  }
}

function hasStaticExports(value: unknown): value is StaticExports {
  if (!value || typeof value !== 'object') return false
  const maybe = value as Record<string, unknown>
  if (typeof maybe.StaticFolder !== 'function') return false

  const fileResponse = maybe.FileResponse as unknown
  if (typeof fileResponse === 'function') return true
  if (!fileResponse || typeof fileResponse !== 'object') return false
  return typeof (fileResponse as { from?: unknown }).from === 'function'
}

function createCompatStaticExports(): StaticExports {
  const FILE_RESPONSE_BRAND = Symbol.for('plat:FileResponse')
  const STATIC_FOLDER_BRAND = Symbol.for('plat:StaticFolder')

  class CompatFileResponse {
    readonly [FILE_RESPONSE_BRAND] = true
    readonly filename: string
    readonly contentType: string
    readonly maxAge?: number
    readonly headers: Record<string, string>

    private constructor(
      readonly kind: 'path' | 'content',
      readonly source: string | Uint8Array,
      filename: string,
      opts?: { contentType?: string; maxAge?: number; headers?: Record<string, string> },
    ) {
      this.filename = filename
      this.contentType = opts?.contentType ?? guessMimeType(filename)
      this.maxAge = opts?.maxAge
      this.headers = opts?.headers ?? {}
    }

    static from(path: string): CompatFileResponse
    static from(path: string, opts: { contentType?: string; maxAge?: number; headers?: Record<string, string> }): CompatFileResponse
    static from(content: string | Uint8Array, filename: string): CompatFileResponse
    static from(content: string | Uint8Array, filename: string, opts: { contentType?: string; maxAge?: number; headers?: Record<string, string> }): CompatFileResponse
    static from(
      pathOrContent: string | Uint8Array,
      filenameOrOpts?: string | { contentType?: string; maxAge?: number; headers?: Record<string, string> },
      opts?: { contentType?: string; maxAge?: number; headers?: Record<string, string> },
    ): CompatFileResponse {
      const isPathCall = typeof pathOrContent === 'string' && (filenameOrOpts === undefined || typeof filenameOrOpts === 'object')
      if (isPathCall) {
        const path = pathOrContent
        const filename = path.split('/').pop() ?? path
        return new CompatFileResponse('path', path, filename, filenameOrOpts as { contentType?: string; maxAge?: number; headers?: Record<string, string> } | undefined)
      }
      return new CompatFileResponse('content', pathOrContent, filenameOrOpts as string, opts)
    }

    async getContent(): Promise<Uint8Array> {
      if (this.kind === 'path') {
        throw new Error('Path-backed FileResponse is not available in this runtime shim')
      }
      return typeof this.source === 'string'
        ? new TextEncoder().encode(this.source)
        : this.source
    }
  }

  class CompatStaticFolder {
    readonly [STATIC_FOLDER_BRAND] = true
    private readonly files: Record<string, string | Uint8Array>

    constructor(source: unknown) {
      const out: Record<string, string | Uint8Array> = {}
      if (source && typeof source === 'object') {
        for (const [rawPath, rawContent] of Object.entries(source as Record<string, unknown>)) {
          const key = rawPath.replace(/^\/+/, '')
          if (typeof rawContent === 'string' || rawContent instanceof Uint8Array) {
            out[key] = rawContent
          }
        }
      }
      this.files = out
    }

    async resolve(subPath: string): Promise<CompatFileResponse | null> {
      const normalized = subPath.replace(/^\/+|\/+$/g, '')
      if (!normalized) {
        const index = this.files['index.html']
        return index == null ? null : CompatFileResponse.from(index, 'index.html')
      }

      const exact = this.files[normalized]
      if (exact != null) {
        return CompatFileResponse.from(exact, normalized.split('/').pop() ?? normalized)
      }

      const hasExt = /\.[^/]+$/.test(normalized)
      if (hasExt) return null

      const stemMatches = Object.keys(this.files).filter((entry) => {
        const parent = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : ''
        const requestParent = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : ''
        if (parent !== requestParent) return false
        const name = entry.split('/').pop() ?? entry
        const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name
        return stem === (normalized.split('/').pop() ?? normalized)
      })

      if (stemMatches.length !== 1) return null
      const matched = stemMatches[0]
      const content = this.files[matched]
      if (content == null) return null
      return CompatFileResponse.from(content, matched.split('/').pop() ?? matched)
    }
  }

  return {
    StaticFolder: CompatStaticFolder as unknown as StaticExports['StaticFolder'],
    FileResponse: CompatFileResponse as unknown as StaticExports['FileResponse'],
  }
}

function guessMimeType(filename: string): string {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : ''
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.txt': return 'text/plain; charset=utf-8'
    default: return 'application/octet-stream'
  }
}

function rewriteStaticImports(source: string | Record<string, string>, staticAliasUrl: string): string | Record<string, string> {
  const replaceText = (value: string): string => value
    .replaceAll('@modularizer/plat/client-server', '@modularizer/plat-client/client-server')
    .replace(/@modularizer\/plat\/client(?!-)/g, '@modularizer/plat-client')
    .replaceAll("'@modularizer/plat-client/static'", JSON.stringify(staticAliasUrl))
    .replaceAll('"@modularizer/plat-client/static"', JSON.stringify(staticAliasUrl))
    .replaceAll("'@modularizer/plat/static'", JSON.stringify(staticAliasUrl))
    .replaceAll('"@modularizer/plat/static"', JSON.stringify(staticAliasUrl))
    .replaceAll("'plat/static'", JSON.stringify(staticAliasUrl))
    .replaceAll('"plat/static"', JSON.stringify(staticAliasUrl))

  if (typeof source === 'string') return replaceText(source)
  return Object.fromEntries(Object.entries(source).map(([path, content]) => [path, replaceText(content)]))
}
