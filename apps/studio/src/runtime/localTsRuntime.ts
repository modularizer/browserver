import {
  startClientSideServerFromSource,
} from '@modularizer/plat-client/client-server'
import { evaluateServerAuthorityStatus } from './authorityPolicy'
import { registerAuthorityHostedServer } from './authorityHost'
import { buildCssTargetUrl } from './clientTargetUrl'
import { useIdentityStore } from '../store/identity'
import { useNamespaceStore } from '../store/namespace'
import { useWorkspaceStore } from '../store/workspace'
import { buildRuntimeEnvBindings } from './runtimeEnv'
import { collectWorkspaceDotEnv, createTsCompatAliases, mergeInjectedProcessEnv, rewriteTsCompatImports } from './tsCompatShims'
import type {
  LocalRuntimeHandle,
} from './types'

type StaticExports = {
  StaticFolder: new (source: unknown, opts?: unknown) => unknown
  FileResponse: {
    from: (...args: unknown[]) => unknown
  }
}

/**
 * If content is a `data:<mime>;base64,<payload>` URL, decode the payload to raw bytes.
 * Non-base64 or non-data URLs are returned unchanged so the server emits them as text.
 */
function decodeIfDataUrl(content: string | Uint8Array): string | Uint8Array {
  if (typeof content !== 'string') return content
  if (!content.startsWith('data:')) return content
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(content)
  if (!match) return content
  const mime = match[1] || ''
  const isBase64 = !!match[2]
  const payload = match[3] || ''
  if (isBase64) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  // For non-base64, treat as text
  return payload
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
  content: string | Uint8Array
}

/**
 * Workspace files are stored as `/<sampleId>/...` paths in studio. The sampleId
 * may itself be multi-segment (e.g. `torin/ts-static-site`), so strip the full
 * project prefix — not just the first segment.
 */
function toProjectRelativePath(workspacePath: string, projectId?: string): string {
  const trimmed = workspacePath.replace(/^\/+/, '')
  if (projectId) {
    const normalizedProject = projectId.replace(/^\/+|\/+$/g, '')
    if (normalizedProject && (trimmed === normalizedProject || trimmed.startsWith(`${normalizedProject}/`))) {
      return trimmed.slice(normalizedProject.length).replace(/^\/+/, '')
    }
  }
  const slashIndex = trimmed.indexOf('/')
  if (slashIndex < 0) return trimmed
  return trimmed.slice(slashIndex + 1)
}

export async function startLocalTsRuntime(options: {
  source: string | Record<string, string>
  serverName: string
  projectId?: string
  workspaceFiles?: WorkspaceFileEntry[]
  /**
   * Additional static files merged into __workspaceFiles on every sync.
   * Used by the bundler runner to inject a just-built index.html that isn't
   * in the workspace file list. Keys override workspace files of the same name.
   */
  extraStaticFiles?: Record<string, string | Uint8Array>
  sourceEntryPoint?: string
  onRequest?: (direction: 'request' | 'response', payload: unknown) => void
}): Promise<LocalRuntimeHandle> {
  if (useIdentityStore.getState().user && !options.serverName.trim().startsWith('dmz/')) {
    await useNamespaceStore.getState().ensureAuthorityData()
  }

  const identityUser = useIdentityStore.getState().user
  const authorityStatus = evaluateServerAuthorityStatus(
    options.serverName,
    identityUser,
    useNamespaceStore.getState().namespaces,
  )
  if (!authorityStatus.allowed) {
    throw new Error(authorityStatus.reason ?? 'Server name is not allowed.')
  }

  debugLocalTsRuntime('start.begin', {
    serverName: options.serverName,
    sourceKind: typeof options.source,
    workspaceFileCount: options.workspaceFiles?.length ?? 0,
  })

  const staticExports = await resolveStaticExports()
  const staticAlias = createStaticAliasModuleUrl(staticExports)
  const runtimeEnv = buildRuntimeEnvBindings({
    projectId: options.projectId,
    serverName: options.serverName,
  })
  const workspaceDotEnv = collectWorkspaceDotEnv(options.workspaceFiles ?? [], options.projectId)
  const effectiveEnv = mergeInjectedProcessEnv(runtimeEnv, workspaceDotEnv)
  const compatAliases = createTsCompatAliases({
    workspaceDotEnv,
    protectedEnvKeys: Object.keys(runtimeEnv),
  })
  const rewrittenSource = injectRuntimeEnvIntoTsSource(
    rewriteTsCompatImports(
      rewriteStaticImports(options.source, staticAlias.url),
      compatAliases.specifierMap,
    ),
    effectiveEnv,
  )

  // Inject workspace static files as a global so user code can reference __workspaceFiles.
  // We keep a single stable object and mutate it in place as workspace files change,
  // so StaticFolder(__workspaceFiles) — which holds the reference — serves live contents
  // without needing a server restart. Imported binary files are stored in the IDE as
  // data URL strings (see store/workspace.ts readImportedFileContent); decode them back
  // to raw bytes here so the static file server returns proper binary bodies.
  const staticFiles: Record<string, string | Uint8Array> = {}
  ;(globalThis as any).__workspaceFiles = staticFiles

  const extras = options.extraStaticFiles ?? {}
  const syncStaticFiles = (files: ReadonlyArray<{ path: string; content: string | Uint8Array }>) => {
    const nextKeys = new Set<string>()
    for (const file of files) {
      if (!isStaticAsset(file.path)) continue
      const key = toProjectRelativePath(file.path, options.projectId).replace(/^\/+|\/+$/g, '')
      nextKeys.add(key)
      staticFiles[key] = decodeIfDataUrl(file.content)
    }
    // Runner-supplied extras take precedence and are never pruned.
    for (const [rawKey, value] of Object.entries(extras)) {
      const key = rawKey.replace(/^\/+|\/+$/g, '')
      nextKeys.add(key)
      staticFiles[key] = value
    }
    for (const key of Object.keys(staticFiles)) {
      if (!nextKeys.has(key)) delete staticFiles[key]
    }
    return nextKeys
  }

  // Seed the static files dict on boot: the subscription below only fires on
  // change events, so without this the first request races ahead of any
  // workspace update and the runner-supplied extras (e.g. a just-built
  // index.html) aren't visible — the server 404s `/` until the user types.
  const initialFiles = options.workspaceFiles ?? useWorkspaceStore.getState().files
  const initialKeys = syncStaticFiles(initialFiles)
  debugLocalTsRuntime('workspace-files.injected', {
    serverName: options.serverName,
    staticFileCount: initialKeys.size,
    staticFileKeysPreview: Array.from(initialKeys).slice(0, 30),
    hasIndexHtml: initialKeys.has('index.html'),
  })

  // Live updates: when the workspace file list changes, mirror it into the same
  // staticFiles object so the running server picks up edits without a restart.
  // After updating, broadcast a peer event so any connected viewers can refresh.
  let lastFilesRef = useWorkspaceStore.getState().files
  let signalerRef: { broadcast?: (m: unknown) => Promise<void> } | null = null
  let authorityBroadcastRef: ((m: unknown) => void) | null = null
  console.log('[LocalTsRuntime] hot-update: subscription ARMED for', options.serverName,
    'initial files:', lastFilesRef.length)
  const unsubscribeWorkspace = useWorkspaceStore.subscribe((state) => {
    if (state.files === lastFilesRef) return
    lastFilesRef = state.files
    const keys = syncStaticFiles(state.files)
    const indexHtml = staticFiles['index.html']
    console.log('[LocalTsRuntime] hot-update FIRED:', options.serverName,
      'keys=', Array.from(keys),
      'index.html len=', typeof indexHtml === 'string' ? indexHtml.length : (indexHtml?.byteLength ?? '—'),
      'index.html head=', typeof indexHtml === 'string' ? indexHtml.slice(0, 60) : '')
    const sig = signalerRef as any
    console.log('[LocalTsRuntime] broadcasting peer event',
      'signaler?=', !!sig,
      'broadcast?=', typeof sig?.broadcast,
      'channels?=', sig?.channels?.size)
    const peerMsg = {
      platcss: 'peer',
      event: 'workspace-files-changed',
      data: { serverName: options.serverName },
    }
    void sig?.broadcast?.(peerMsg)
    try { authorityBroadcastRef?.(peerMsg) } catch (err) { console.warn('[LocalTsRuntime] authority broadcast failed', err) }
  })

  const started = await startClientSideServerFromSource({
    source: rewrittenSource,
    serverName: options.serverName,
    sourceEntryPoint: typeof options.source === 'object' && 'index.ts' in options.source ? 'index.ts' : undefined,
    onRequest: options.onRequest,
  })
  signalerRef = started.signaler as unknown as { broadcast?: (m: unknown) => Promise<void> }

  const connectionUrl = started.connectionUrl
  const resolvedServerName = connectionUrl?.startsWith('css://')
    ? connectionUrl.slice('css://'.length)
    : options.serverName
  const hostToken = useIdentityStore.getState().user?.idToken ?? ''
  const authorityHandle = !resolvedServerName.startsWith('dmz/') && hostToken
    ? await registerAuthorityHostedServer({
        serverName: resolvedServerName,
        server: started.server as any,
        token: hostToken,
        authMode: 'public',
      })
    : null
  if (authorityHandle) authorityBroadcastRef = authorityHandle.broadcast.bind(authorityHandle)

  debugLocalTsRuntime('start.ready', {
    requestedServerName: options.serverName,
    resolvedServerName,
    connectionUrl,
  })

  return {
    language: 'typescript',
    launchable: true,
    serverName: resolvedServerName,
    connectionUrl: buildCssTargetUrl(resolvedServerName),
    server: started.server,
    async stop() {
      debugLocalTsRuntime('stop.begin', {
        serverName: resolvedServerName,
        connectionUrl: buildCssTargetUrl(resolvedServerName),
      })
      unsubscribeWorkspace()
      await authorityHandle?.stop()
      if (started && typeof (started as any).stop === 'function') {
        await (started as any).stop()
      }
      staticAlias.dispose()
      compatAliases.dispose()
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
      let result: Uint8Array
      if (this.kind === 'path') {
        throw new Error('Path-backed FileResponse is not available in this runtime shim')
      }
      if (typeof this.source === 'string') {
        // Fallback: if this is a data URL, decode it
        if (this.source.startsWith('data:')) {
          const decoded = decodeIfDataUrl(this.source)
          if (decoded instanceof Uint8Array) {
            console.debug('[CompatFileResponse.getContent] returning decoded Uint8Array', { length: decoded.length, filename: this.filename, contentType: this.contentType })
            return decoded
          }
        }
        result = new TextEncoder().encode(this.source)
        console.debug('[CompatFileResponse.getContent] returning TextEncoder Uint8Array', { length: result.length, filename: this.filename, contentType: this.contentType })
        return result
      }
      // If already Uint8Array
      result = this.source
      console.debug('[CompatFileResponse.getContent] returning direct Uint8Array', { length: result.length, filename: this.filename, contentType: this.contentType })
      return result
    }
  }

  class CompatStaticFolder {
    readonly [STATIC_FOLDER_BRAND] = true
    // Hold the source by reference so live updates to __workspaceFiles (via the
    // workspace-store subscription in startLocalTsRuntime) are visible to each
    // resolve() call — without this, we'd serve stale content until restart.
    private readonly source: Record<string, unknown>

    constructor(source: unknown) {
      this.source = (source && typeof source === 'object') ? (source as Record<string, unknown>) : {}
    }

    private lookup(key: string): string | Uint8Array | null {
      const direct = this.source[key]
      if (typeof direct === 'string' || direct instanceof Uint8Array) return direct
      // Tolerate callers that stored paths with a leading slash.
      const slashed = this.source['/' + key]
      if (typeof slashed === 'string' || slashed instanceof Uint8Array) return slashed
      return null
    }

    private currentKeys(): string[] {
      return Object.keys(this.source).map((k) => k.replace(/^\/+/, ''))
    }

    async resolve(subPath: string): Promise<CompatFileResponse | null> {
      const normalized = subPath.replace(/^\/+|\+$/g, '')
      if (!normalized) {
        const index = this.lookup('index.html')
        return index == null ? null : CompatFileResponse.from(index, 'index.html')
      }

      const exact = this.lookup(normalized)
      if (exact != null) {
        return CompatFileResponse.from(exact, normalized.split('/').pop() ?? normalized)
      }

      const hasExt = /\.[^/]+$/.test(normalized)
      if (hasExt) return null

      const stemMatches = this.currentKeys().filter((entry) => {
        const parent = entry.includes('/') ? entry.slice(0, entry.lastIndexOf('/')) : ''
        const requestParent = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : ''
        if (parent !== requestParent) return false
        const name = entry.split('/').pop() ?? entry
        const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name
        return stem === (normalized.split('/').pop() ?? normalized)
      })

      if (stemMatches.length !== 1) return null
      const matched = stemMatches[0]
      const content = this.lookup(matched)
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
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.ico': return 'image/x-icon'
    case '.bmp': return 'image/bmp'
    case '.avif': return 'image/avif'
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

function injectRuntimeEnvIntoTsSource(
  source: string | Record<string, string>,
  env: Record<string, string>,
): string | Record<string, string> {
  const bootstrap = buildTsRuntimeEnvBootstrap(env)

  if (typeof source === 'string') return `${bootstrap}\n${source}`

  return Object.fromEntries(
    Object.entries(source).map(([path, content]) => {
      if (!/\.[cm]?[jt]sx?$/i.test(path)) return [path, content]
      return [path, `${bootstrap}\n${content}`]
    }),
  )
}

function buildTsRuntimeEnvBootstrap(env: Record<string, string>): string {
  return `
(() => {
  const __browserverEnv = ${JSON.stringify(env)}
  const __browserverGlobal = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> }
  }
  const __browserverProcess =
    __browserverGlobal.process && typeof __browserverGlobal.process === 'object'
      ? __browserverGlobal.process
      : {}
  const __browserverProcessEnv =
    __browserverProcess.env && typeof __browserverProcess.env === 'object'
      ? __browserverProcess.env
      : {}
  __browserverGlobal.process = {
    ...__browserverProcess,
    env: {
      ...__browserverProcessEnv,
      ...__browserverEnv,
    },
  }
})()
`.trim()
}


