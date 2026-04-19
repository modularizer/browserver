import {
  startClientSideServerFromSource,
} from '@modularizer/plat-client/client-server'
import * as PlatClientServer from '@modularizer/plat-client/client-server'
import { evaluateServerAuthorityStatus } from './authorityPolicy'
import { registerAuthorityHostedServer } from './authorityHost'
import { buildCssTargetUrl } from './clientTargetUrl'
import { useIdentityStore } from '../store/identity'
import { useNamespaceStore } from '../store/namespace'
import { useWorkspaceStore } from '../store/workspace'
import { useScriptRunnerStore, type ServerLogLevel } from '../store/scriptRunner'
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

import * as PlatStatic from '@modularizer/plat-client/static'

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
  const clientServerAlias = createClientServerAliasModuleUrl(PlatClientServer as any)
  const serverConsoleCleanup = installServerConsole()
  const runtimeEnv = buildRuntimeEnvBindings({
    projectId: options.projectId,
    serverName: options.serverName,
  })
  const workspaceDotEnv = collectWorkspaceDotEnv(options.workspaceFiles ?? [], options.projectId)
  const effectiveEnv = mergeInjectedProcessEnv(runtimeEnv, workspaceDotEnv)
  const compatAliases = createTsCompatAliases({
    workspaceDotEnv,
    protectedEnvKeys: Object.keys(runtimeEnv),
    serverName: options.serverName,
    log: (level, text) => useScriptRunnerStore.getState().appendServerLog(level, text),
  })
  let rewrittenSource = prependServerConsolePreamble(
    injectRuntimeEnvIntoTsSource(
      rewriteTsCompatImports(
        normalizeControllerExports(
          rewriteStaticImports(options.source, staticAlias.url, clientServerAlias.url),
          options.serverName,
          clientServerAlias.url,
          options.sourceEntryPoint,
        ),
        compatAliases.specifierMap,
      ),
      effectiveEnv,
    ),
  )

  // Accept any default export in the entrypoint file as a valid server entrypoint.
  if (typeof options.source === 'object' && options.sourceEntryPoint && options.source[options.sourceEntryPoint]) {
    const entry = options.source[options.sourceEntryPoint];
    // Only synthesize an entrypoint if named controller exports are detected (legacy pattern)
    const namedExportMatch = entry.match(/export\s*\{([^}]+)\}/);
    const defaultExportServer = /export\s+default\s+server/.test(entry);
    if (namedExportMatch && defaultExportServer) {
      // Extract controller names
      const controllers = namedExportMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      if (controllers.length > 0) {
        // Synthesize a new entrypoint for preview
        let synthEntry = `import { serveClientSideServer } from ${JSON.stringify(clientServerAlias.url)};\n` +
          `import { ${controllers.join(', ')} } from './${options.sourceEntryPoint.replace(/\.ts$/, '')}';\n` +
          `export default serveClientSideServer(${JSON.stringify(options.serverName)}, [${controllers.join(', ')}]);\n`;
        
        // Match the transformations applied to other files
        synthEntry = SERVER_CONSOLE_PREAMBLE + buildTsRuntimeEnvBootstrap(effectiveEnv) + '\n' + synthEntry;

        if (typeof rewrittenSource === 'object') {
          // Use a unique name for the synthesized entrypoint to avoid colliding with index.ts or creating circular imports
          const entryFileName = 'browserver-entry.ts';
          rewrittenSource[entryFileName] = synthEntry;
          options.sourceEntryPoint = entryFileName;
        }
      }
    }
  }

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

  const logs = useScriptRunnerStore.getState()
  logs.appendServerLog('info', `▸ starting server ${options.serverName}…`)

  const composedOnRequest = (direction: 'request' | 'response', payload: unknown) => {
    try {
      const line = summarizeRequestLog(direction, payload)
      if (line) logs.appendServerLog(direction === 'request' ? 'info' : 'debug', line)
    } catch {
      // log summarization must never throw
    }
    options.onRequest?.(direction, payload)
  }

  const started = await startClientSideServerFromSource({
    source: rewrittenSource,
    serverName: options.serverName,
    sourceEntryPoint: options.sourceEntryPoint,
    onRequest: composedOnRequest,
  })
  signalerRef = started.signaler as unknown as { broadcast?: (m: unknown) => Promise<void> }

  const connectionUrl = started.connectionUrl
  const resolvedServerName = connectionUrl?.startsWith('css://')
    ? connectionUrl.slice('css://'.length)
    : options.serverName
  logs.appendServerLog('info', `✓ server ready — ${connectionUrl ?? resolvedServerName}`)
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
      clientServerAlias.dispose()
      compatAliases.dispose()
      serverConsoleCleanup()
      delete (globalThis as any).__workspaceFiles
      useScriptRunnerStore.getState().appendServerLog('info', `■ server stopped — ${resolvedServerName}`)
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

function createClientServerAliasModuleUrl(exports: Record<string, unknown>): { url: string; dispose(): void } {
  const registry = ((globalThis as any).__browserverClientServerModuleRegistry ??= new Map<string, Record<string, unknown>>()) as Map<string, Record<string, unknown>>
  const id = `client-server-${crypto.randomUUID()}`
  registry.set(id, exports)

  const code = [
    'const __registry = globalThis.__browserverClientServerModuleRegistry',
    `const __m = __registry?.get(${JSON.stringify(id)})`,
    `if (!__m) throw new Error('Missing client-server module alias: ${id}')`,
    // Normalization helpers so plat can always `new` controllers safely
    'const __isClass = (fn) => typeof fn === "function" && /^class\\s/.test(Function.prototype.toString.call(fn))',
    'const __toConstructible = (x) => {',
    '  if (x && __isClass(x)) return x;',
    '  if (typeof x === "function") {',
    '    return class { constructor(...args) { return x(...args) } }',
    '  }',
    '  if (x && typeof x === "object") {',
    '    return class { constructor() { return x } }',
    '  }',
    '  throw new Error("Invalid controller: expected class/function/object")',
    '}',
    'const __normalizeControllersArg = (arg) => {',
    '  if (!Array.isArray(arg)) return arg;',
    '  return arg.map(__toConstructible)',
    '}',
    // Real exports from plat-client
    'const __serve = __m.serveClientSideServer ?? __m.serve_client_side_server ?? __m.serveClientSideServerFromSpec ?? __m.serveClientSideServer',
    'const __startFromSource = __m.startClientSideServerFromSource ?? __m.startClientSideServerFromSource',
    'const __discover = __m.discoverClientSideServers ?? __m.discoverClientSideServers',
    'const __OpenAPIClient = __m.OpenAPIClient ?? __m.OpenAPIClient',
    'const __create = __m.createServer ?? __m.create_server ?? __m.createServer',
    // Wrapped exports
    'export function serveClientSideServer(name, controllers, ...rest) {',
    '  return __serve(name, __normalizeControllersArg(controllers), ...rest)',
    '}',
    'export function createServer(opts, controllers, ...rest) {',
    '  return __create(opts, __normalizeControllersArg(controllers), ...rest)',
    '}',
    'export const startClientSideServerFromSource = __startFromSource',
    'export const discoverClientSideServers = __discover',
    'export const OpenAPIClient = __OpenAPIClient',
    'export default {',
    '  serveClientSideServer, startClientSideServerFromSource, discoverClientSideServers, OpenAPIClient, createServer',
    '}',
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
  // Prefer static import so Vite resolves it at build time and our preview doesn't try
  // to import bare specifiers at runtime.
  if (hasStaticExports(PlatStatic)) return PlatStatic as unknown as StaticExports
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

function rewriteStaticImports(source: string | Record<string, string>, staticAliasUrl: string, clientServerAliasUrl: string): string | Record<string, string> {
  const replaceText = (value: string): string => value
    .replaceAll('@modularizer/plat/client-server', '@modularizer/plat-client/client-server')
    .replace(/@modularizer\/plat\/client(?!-)/g, '@modularizer/plat-client')
    // Static subpath → in-memory alias URL
    .replaceAll("'@modularizer/plat-client/static'", JSON.stringify(staticAliasUrl))
    .replaceAll('"@modularizer/plat-client/static"', JSON.stringify(staticAliasUrl))
    .replaceAll("'@modularizer/plat/static'", JSON.stringify(staticAliasUrl))
    .replaceAll('"@modularizer/plat/static"', JSON.stringify(staticAliasUrl))
    .replaceAll("'plat/static'", JSON.stringify(staticAliasUrl))
    .replaceAll('"plat/static"', JSON.stringify(staticAliasUrl))
    // Client-server API → in-memory alias URL
    .replaceAll("'@modularizer/plat-client/client-server'", JSON.stringify(clientServerAliasUrl))
    .replaceAll('"@modularizer/plat-client/client-server"', JSON.stringify(clientServerAliasUrl))
    .replaceAll("'@modularizer/plat/client-server'", JSON.stringify(clientServerAliasUrl))
    .replaceAll('"@modularizer/plat/client-server"', JSON.stringify(clientServerAliasUrl))
    // Bare package imports → in-memory client-server alias URL
    .replaceAll("'@modularizer/plat'", JSON.stringify(clientServerAliasUrl))
    .replaceAll('"@modularizer/plat"', JSON.stringify(clientServerAliasUrl))
    .replaceAll("'@modularizer/plat-client'", JSON.stringify(clientServerAliasUrl))
    .replaceAll('"@modularizer/plat-client"', JSON.stringify(clientServerAliasUrl))

  if (typeof source === 'string') return replaceText(source)
  return Object.fromEntries(Object.entries(source).map(([path, content]) => [path, replaceText(content)]))
}

/**
 * Rewrite common export forms to ensure controllers flow through serveClientSideServer,
 * which our in-memory alias wraps to normalize non-constructible entries.
 * Only applies to TS/JS files. Conservative pattern: `export default [ ... ]`.
 */
function normalizeControllerExports(
  source: string | Record<string, string>,
  serverName: string,
  clientServerAliasUrl: string,
  entryPoint?: string,
): string | Record<string, string> {
  const tryRewrite = (text: string): string => {
    // Quick reject for non-code files
    if (!/\.[cm]?[jt]sx?$/i.test('index.ts')) {
      // The check above is not on filename; we'll handle by callers per-file.
    }
    // Match: export default [ ... ] (array literal possibly spanning lines)
    const re = /(^|\n)\s*export\s+default\s*\[/m
    if (!re.test(text)) return text
    const importLine = `import { serveClientSideServer as __browserverServe } from ${JSON.stringify(clientServerAliasUrl)};\n`
    // Insert import at top if not already present
    const withImport = importLine + text
    return withImport.replace(re, `$1export default __browserverServe(${JSON.stringify(serverName)}, [`)
  }

  if (typeof source === 'string') return tryRewrite(source)

  // Multi-file: prefer entryPoint if provided; else try index.ts and index.tsx
  const out: Record<string, string> = { ...source }
  const candidates = [entryPoint, 'index.ts', 'index.tsx', 'main.ts', 'main.tsx'].filter(Boolean) as string[]
  for (const name of candidates) {
    const content = out[name]
    if (typeof content === 'string') {
      const next = tryRewrite(content)
      if (next !== content) { out[name] = next; return out }
    }
  }
  // Fallback: brute-force try all string files
  for (const [name, content] of Object.entries(out)) {
    if (!/\.[cm]?[jt]sx?$/i.test(name)) continue
    if (typeof content !== 'string') continue
    const next = tryRewrite(content)
    if (next !== content) { out[name] = next; break }
  }
  return out
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

/**
 * Shadow `console` in every server module with a wrapper that also routes
 * output to the studio's build-pane log sink. Each TS source file gets a
 * module-scoped `var console = ...` prepended; the wrapper itself is
 * installed on globalThis so it survives the transpile step below.
 */
const SERVER_CONSOLE_PREAMBLE = 'var console = globalThis.__browserverServerConsole || globalThis.console;\n'

function prependServerConsolePreamble(source: string | Record<string, string>): string | Record<string, string> {
  if (typeof source === 'string') return SERVER_CONSOLE_PREAMBLE + source
  return Object.fromEntries(
    Object.entries(source).map(([path, content]) => {
      if (!/\.[cm]?[jt]sx?$/i.test(path)) return [path, content]
      return [path, SERVER_CONSOLE_PREAMBLE + content]
    }),
  )
}

function installServerConsole(): () => void {
  const real = globalThis.console
  const levels: ServerLogLevel[] = ['log', 'info', 'warn', 'error', 'debug']
  const append = (level: ServerLogLevel, args: unknown[]) => {
    try {
      useScriptRunnerStore.getState().appendServerLog(level, args.map(formatLogArg).join(' '))
    } catch {
      // swallow — never let log routing break server execution
    }
  }
  const wrapped: Record<string, unknown> = Object.create(real)
  for (const level of levels) {
    wrapped[level] = (...args: unknown[]) => {
      append(level, args)
      ;(real as any)[level]?.(...args)
    }
  }
  ;(globalThis as any).__browserverServerConsole = wrapped
  return () => {
    if ((globalThis as any).__browserverServerConsole === wrapped) {
      delete (globalThis as any).__browserverServerConsole
    }
  }
}

function formatLogArg(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) } catch { return String(value) }
}

function summarizeRequestLog(direction: 'request' | 'response', payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  const arrow = direction === 'request' ? '→' : '←'
  const method = typeof p.method === 'string' ? p.method.toUpperCase() : undefined
  const path = typeof p.path === 'string' ? p.path
    : typeof p.url === 'string' ? p.url
    : typeof p.name === 'string' ? p.name
    : undefined
  const status = typeof p.status === 'number' ? ` ${p.status}` : ''
  const errorText = summarizeError(p.error ?? (p.body as Record<string, unknown> | undefined)?.error)
  const inputPreview = direction === 'request' ? summarizeInput(p) : ''
  if (method || path) {
    return `${arrow} ${method ?? ''}${method && path ? ' ' : ''}${path ?? ''}${status}${inputPreview}${errorText ? ' — ' + errorText : ''}`.trim()
  }
  if (errorText) return `${arrow}${status} — ${errorText}`
  const compact = truncate(formatLogArg(payload), 240)
  return `${arrow} ${compact}`
}

function summarizeInput(p: Record<string, unknown>): string {
  const body = (p.input ?? p.params ?? p.body) as unknown
  if (body != null) {
    try { return ` ${truncate(formatLogArg(body), 400)}` } catch { /* fall through */ }
  }
  // Diagnostic fallback: dump top-level payload keys (minus noisy ones) so we
  // can see where the request body actually lives in the envelope.
  try {
    const skip = new Set(['method', 'path', 'jsonrpc', 'id', 'headers', 'operationId'])
    const preview: Record<string, unknown> = {}
    for (const k of Object.keys(p)) if (!skip.has(k)) preview[k] = p[k]
    const otherKeys = Object.keys(preview)
    const allKeys = Object.keys(p)
    const summary = otherKeys.length > 0
      ? formatLogArg(preview)
      : `keys=[${allKeys.join(',')}]`
    return ` ${truncate(summary, 400)}`
  } catch {
    return ''
  }
}

function summarizeError(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (typeof v.message === 'string') return v.message
    if (typeof v.error === 'string') return v.error
  }
  return null
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text
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


