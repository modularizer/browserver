import * as monaco from 'monaco-editor'
import {
  useScriptRunnerStore,
  classifyScript,
  inferScriptKindByName,
  inferEntry,
  type ScriptKind,
} from '../store/scriptRunner'
import { useWorkspaceStore } from '../store/workspace'

let configured = false
let codeLensRegistered = false

const RUN_SCRIPT_COMMAND = 'browserver.runScript'

export function setupPackageJsonCodeLens() {
  if (codeLensRegistered) return
  codeLensRegistered = true

  monaco.editor.registerCommand(RUN_SCRIPT_COMMAND, (_accessor, name: string, command: string, kind: ScriptKind) => {
    const files = useWorkspaceStore.getState().files
      .filter((f) => typeof f.content === 'string')
      .map((f) => ({
        path: f.path.startsWith('/') ? f.path : '/' + f.path,
        contents: f.content as string,
      }))
    const entry = inferEntry(files)
    void useScriptRunnerStore.getState().runScript({ name, command, kind }, files, entry)
    // Make sure the Build tab is visible so user sees output
    useWorkspaceStore.getState().setActiveBottomPanel?.('build')
  })

  monaco.languages.registerCodeLensProvider('json', {
    provideCodeLenses(model) {
      const uri = model.uri.toString()
      if (!/package\.json$/.test(uri)) return { lenses: [], dispose() {} }
      const text = model.getValue()
      let parsed: any
      try { parsed = JSON.parse(text) } catch { return { lenses: [], dispose() {} } }
      const scripts = parsed?.scripts
      if (!scripts || typeof scripts !== 'object') return { lenses: [], dispose() {} }

      const lenses: monaco.languages.CodeLens[] = []
      // Find each script key's line in the raw text (regex-based; good enough for normal JSON)
      for (const [name, cmd] of Object.entries(scripts)) {
        if (typeof cmd !== 'string') continue
        const kind = (() => {
          const byName = inferScriptKindByName(name)
          return byName !== 'unknown' ? byName : classifyScript(cmd)
        })()
        const re = new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`, 'm')
        const m = re.exec(text)
        if (!m) continue
        const pos = model.getPositionAt(m.index)
        const range = new monaco.Range(pos.lineNumber, 1, pos.lineNumber, 1)
        const label = kind === 'unknown' ? `▶ ${name} (unsupported)` : `▶ npm run ${name}`
        lenses.push({
          range,
          id: `run-${name}`,
          command: {
            id: RUN_SCRIPT_COMMAND,
            title: label,
            arguments: [name, cmd, kind],
          },
        })
      }
      return { lenses, dispose() {} }
    },
    resolveCodeLens(_model, lens) { return lens },
  })
}

const packageDeclarations = `
declare module '@modularizer/plat-client/client-server' {
  export type ControllerClass = new () => any

  export interface ClientSideServerDefinition {
    serverName: string
    controllers: ControllerClass[]
  }

  export interface StartedClientSideServer {
    server: unknown
    signaler: unknown
    connectionUrl: string
    openapi: Record<string, any>
    stop(): Promise<void>
  }

  export class OpenAPIClient {
    constructor(openapi: Record<string, any>, options: { baseUrl: string })
    [key: string]: any
  }

   export function serveClientSideServer(
     serverName: string,
     controllers: ControllerClass[],
   ): ClientSideServerDefinition

   export function startClientSideServerFromSource(options: {
     source: string | Record<string, string>
     serverName?: string
     sourceEntryPoint?: string
     transpile?: (source: string | Record<string, string>, entryPoint?: string) => string | Promise<string>
     onRequest?: (direction: 'request' | 'response', payload: unknown) => void
   }): Promise<StartedClientSideServer>
   
   export function runClientSideServer(
     source: string,
     options?: { serverName?: string; undecoratedMode?: 'GET' | 'POST' | 'private' }
   ): Promise<StartedClientSideServer>
   
   export function runClientSideServer(
     source: Record<string, string>,
     options?: { serverName?: string; undecoratedMode?: 'GET' | 'POST' | 'private'; sourceEntryPoint?: string }
   ): Promise<StartedClientSideServer>

   export function connectClientSideServer(options: {
     baseUrl: string
     [key: string]: any
   }): Promise<{ client: OpenAPIClient; openapi: Record<string, any> }>

   export const connectServer: typeof connectClientSideServer
 }

 declare module '@modularizer/plat-client/client-server' {
  export type ControllerClass = new () => any

  export interface ClientSideServerDefinition {
    serverName: string
    controllers: ControllerClass[]
  }

  export interface StartedClientSideServer {
    server: unknown
    signaler: unknown
    connectionUrl: string
    openapi: Record<string, any>
    stop(): Promise<void>
  }

  export class OpenAPIClient {
    constructor(openapi: Record<string, any>, options: { baseUrl: string })
    [key: string]: any
  }

   export function serveClientSideServer(
     serverName: string,
     controllers: ControllerClass[],
   ): ClientSideServerDefinition

   export function startClientSideServerFromSource(options: {
     source: string | Record<string, string>
     serverName?: string
     sourceEntryPoint?: string
     transpile?: (source: string | Record<string, string>, entryPoint?: string) => string | Promise<string>
     onRequest?: (direction: 'request' | 'response', payload: unknown) => void
   }): Promise<StartedClientSideServer>
   
   export function runClientSideServer(
     source: string,
     options?: { serverName?: string; undecoratedMode?: 'GET' | 'POST' | 'private' }
   ): Promise<StartedClientSideServer>
   
   export function runClientSideServer(
     source: Record<string, string>,
     options?: { serverName?: string; undecoratedMode?: 'GET' | 'POST' | 'private'; sourceEntryPoint?: string }
   ): Promise<StartedClientSideServer>

   export function connectClientSideServer(options: {
     baseUrl: string
     [key: string]: any
   }): Promise<{ client: OpenAPIClient; openapi: Record<string, any> }>

   export const connectServer: typeof connectClientSideServer

   export interface ClientSideServerChannel {
     send(message: unknown): void | Promise<void>
     subscribe(listener: (message: unknown) => void | Promise<void>): () => void
     close?(): void | Promise<void>
   }

   export interface PlatFetchOptions {
     channel: ClientSideServerChannel
     interceptBase?: string
   }

   export function createPlatFetch(options: PlatFetchOptions): typeof globalThis.fetch
   export function patchGlobalFetch(options: PlatFetchOptions): () => void
   export function generateBridgeScript(): string
 }

 declare module '@modularizer/plat-client' {
  export class OpenAPIClient {
    constructor(openapi: Record<string, any>, options: { baseUrl: string })
    [key: string]: any
  }
}

declare module '@modularizer/plat-client/python-browser' {
  export interface PythonBrowserRuntime {
    startServer(source: string): Promise<{
      server_name: string
      openapi: Record<string, any>
    }>
    handleRequest(message: Record<string, any>): Promise<{
      result: unknown
      events: Array<{ event: string; data: unknown }>
    }>
    dispose(): Promise<void>
  }

  export function createPythonBrowserRuntime(options?: {
    pythonRuntimeUrl?: string
  }): Promise<PythonBrowserRuntime>

  export function formatPythonBrowserValue(value: unknown): string
}

declare module 'plat' {
  export function serve_client_side_server(
    serverName: string,
    controllers: unknown[],
  ): unknown
}

declare module '@modularizer/plat-client/static' {
  export interface FileResponseOpts {
    contentType?: string
    maxAge?: number
    headers?: Record<string, string>
  }

  export class FileResponse {
    readonly kind: 'path' | 'content'
    readonly source: string | Uint8Array
    readonly filename: string
    readonly contentType: string
    readonly maxAge?: number
    readonly headers: Record<string, string>
    static from(path: string): FileResponse
    static from(content: string | Uint8Array, filename: string, opts?: FileResponseOpts): FileResponse
    getContent(): Promise<string | Uint8Array>
  }

  export function isFileResponse(value: unknown): value is FileResponse

  export interface StaticFolderOpts {
    exclude?: string[]
    maxAge?: number
    headers?: Record<string, string>
    dotfiles?: 'ignore' | 'allow' | 'deny'
    onDirectory?: 'none' | 'index' | 'list' | 'directory' | ((files: string[]) => FileResponse | Promise<FileResponse>)
    index?: string
  }

  export interface VirtualFileSystem {
    list(path: string): string[] | Promise<string[]>
    read(path: string): string | Uint8Array | null | Promise<string | Uint8Array | null>
  }

  export type MemoryFileEntry = string | Uint8Array | { read(): string | Uint8Array | Promise<string | Uint8Array> }

  export class MemoryFileSystem implements VirtualFileSystem {
    constructor(files: Record<string, MemoryFileEntry>)
    list(path: string): string[]
    read(path: string): string | Uint8Array | null
  }

  export class StaticFolder {
    constructor(directory: string, opts?: StaticFolderOpts)
    constructor(files: Record<string, MemoryFileEntry>, opts?: StaticFolderOpts)
    constructor(vfs: VirtualFileSystem, opts?: StaticFolderOpts)
    resolve(subPath: string): Promise<FileResponse | null>
  }

  export function isStaticFolder(value: unknown): value is StaticFolder
  export function getMimeType(filename: string): string
  export function isExcluded(path: string, patterns: string[]): boolean
}

declare module '@modularizer/plat/static' {
  export * from '@modularizer/plat-client/static'
}

/** Workspace files injected by browserver at runtime, usable with StaticFolder */
declare const __workspaceFiles: Record<string, string>

declare namespace NodeJS {
  interface ProcessEnv {
    readonly PROJECT_ID?: string
    readonly PROJECT_SLUG?: string
    readonly PROJECT_NAMESPACE?: string
    readonly SERVER_NAME?: string
    readonly SERVER_NAMESPACE?: string
    readonly BROWSERVER_PROJECT_ID?: string
    readonly BROWSERVER_PROJECT_SLUG?: string
    readonly BROWSERVER_PROJECT_NAMESPACE?: string
    readonly BROWSERVER_SERVER_NAME?: string
    readonly BROWSERVER_SERVER_NAMESPACE?: string
    readonly [key: string]: string | undefined
  }
}

declare const process: {
  env: NodeJS.ProcessEnv
}

declare module 'dotenv' {
  export interface DotenvConfigResult {
    parsed?: Record<string, string>
    error?: Error
  }

  export interface DotenvConfigOptions {
    processEnv?: Record<string, string | undefined>
    override?: boolean
    path?: string
  }

  export function config(options?: DotenvConfigOptions): DotenvConfigResult
  export function parse(src: string | Uint8Array): Record<string, string>

  const dotenv: {
    config: typeof config
    parse: typeof parse
  }

  export default dotenv
}

declare module 'dotenv/config' {}

declare module 'process' {
  const processShim: typeof process
  export = processShim
}

declare module 'node:process' {
  const processShim: typeof process
  export = processShim
}

declare module 'path' {
  export const sep: '/'
  export const delimiter: ':'
  export function basename(path: string, suffix?: string): string
  export function dirname(path: string): string
  export function extname(path: string): string
  export function join(...paths: string[]): string
  export function normalize(path: string): string
  export function resolve(...paths: string[]): string
  export function parse(path: string): { root: string; dir: string; base: string; ext: string; name: string }
  export function format(pathObject: { root?: string; dir?: string; base?: string; ext?: string; name?: string }): string
  export const posix: typeof import('path')
  const pathShim: typeof import('path')
  export default pathShim
}

declare module 'node:path' {
  export * from 'path'
  const pathShim: typeof import('path')
  export default pathShim
}

declare module 'url' {
  export const URL: typeof globalThis.URL
  export const URLSearchParams: typeof globalThis.URLSearchParams
  export function pathToFileURL(path: string): URL
  export function fileURLToPath(url: string | URL): string
}

declare module 'node:url' {
  export * from 'url'
}

declare module 'buffer' {
  export class Buffer {
    readonly length: number
    static from(value: string | ArrayLike<number> | ArrayBufferLike, encoding?: string): Buffer
    static alloc(size: number): Buffer
    toString(encoding?: string): string
  }

  export const INSPECT_MAX_BYTES: number
  export const kMaxLength: number
}

declare module 'node:buffer' {
  export * from 'buffer'
}

declare module '@browserver/core' {
  export interface Workspace {
    id: string
    name: string
    serverLanguage: 'typescript' | 'python'
    serverSource: string
  }
}

declare module '@browserver/runtime' {
  export type RuntimeStatus = 'idle' | 'starting' | 'running' | 'error'
}

declare module '@browserver/storage' {
  export interface StoredWorkspaceFile {
    path: string
    language: 'typescript' | 'python' | 'markdown'
    content: string
    updatedAt: number
  }

  export interface WorkspaceSnapshot {
    id: string
    name: string
    serverLanguage: 'typescript' | 'python'
    files: StoredWorkspaceFile[]
    updatedAt: number
  }

  export function loadWorkspaceSnapshot(id: string): Promise<WorkspaceSnapshot | null>
  export function saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void>
}

declare const openapi: Record<string, any>
`

export function setupMonacoTypeEnvironment() {
  if (configured) return
  configured = true

  const tsLanguage = (monaco.languages as typeof monaco.languages & {
    typescript: {
      typescriptDefaults: {
        setCompilerOptions: (options: Record<string, unknown>) => void
        setDiagnosticsOptions: (options: Record<string, unknown>) => void
        setEagerModelSync: (value: boolean) => void
        addExtraLib: (content: string, filePath?: string) => void
      }
      javascriptDefaults: {
        setCompilerOptions: (options: Record<string, unknown>) => void
        setDiagnosticsOptions: (options: Record<string, unknown>) => void
        setEagerModelSync: (value: boolean) => void
      }
      ScriptTarget: Record<string, number>
      ModuleKind: Record<string, number>
      ModuleResolutionKind: Record<string, number>
      JsxEmit: Record<string, number>
    }
  }).typescript

  const compilerOptions = {
    allowJs: true,
    allowNonTsExtensions: true,
    target: tsLanguage.ScriptTarget.ESNext,
    module: tsLanguage.ModuleKind.ESNext,
    moduleResolution:
      tsLanguage.ModuleResolutionKind.Bundler || tsLanguage.ModuleResolutionKind.NodeJs,
    strict: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    jsx: tsLanguage.JsxEmit.ReactJSX,
    lib: ['esnext', 'dom', 'dom.iterable'],
  }

  tsLanguage.typescriptDefaults.setCompilerOptions(compilerOptions)
  tsLanguage.javascriptDefaults.setCompilerOptions(compilerOptions)

  const diagnosticsOptions = {
    noSemanticValidation: false,
    noSyntaxValidation: false,
    noSuggestionDiagnostics: false,
  }

  tsLanguage.typescriptDefaults.setDiagnosticsOptions(diagnosticsOptions)
  tsLanguage.javascriptDefaults.setDiagnosticsOptions(diagnosticsOptions)

  tsLanguage.typescriptDefaults.setEagerModelSync(true)
  tsLanguage.javascriptDefaults.setEagerModelSync(true)
  tsLanguage.typescriptDefaults.addExtraLib(
    packageDeclarations,
    'file:///browserver-packages.d.ts',
  )
  tsLanguage.typescriptDefaults.addExtraLib(
    reactTypeStubs,
    'file:///react-stubs.d.ts',
  )
}

const reactTypeStubs = `
declare module 'react' {
  export type ReactNode = any
  export type ReactElement = any
  export type FC<P = {}> = (props: P) => ReactElement | null
  export type ComponentType<P = {}> = FC<P>
  export type Dispatch<A> = (value: A) => void
  export type SetStateAction<S> = S | ((prev: S) => S)
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>]
  export function useEffect(effect: () => void | (() => void), deps?: any[]): void
  export function useMemo<T>(factory: () => T, deps: any[]): T
  export function useCallback<T extends (...args: any[]) => any>(cb: T, deps: any[]): T
  export function useRef<T>(initial: T | null): { current: T | null }
  export function useContext<T>(ctx: any): T
  export function useReducer<S, A>(reducer: (s: S, a: A) => S, init: S): [S, Dispatch<A>]
  export const Fragment: any
  export const StrictMode: any
  const React: any
  export default React
}
declare module 'react/jsx-runtime' {
  export const Fragment: any
  export function jsx(type: any, props: any, key?: any): any
  export function jsxs(type: any, props: any, key?: any): any
}
declare module 'react/jsx-dev-runtime' {
  export const Fragment: any
  export function jsxDEV(type: any, props: any, key?: any): any
}
declare module 'react-dom' {
  const x: any
  export default x
}
declare module 'react-dom/client' {
  export function createRoot(container: Element | DocumentFragment): {
    render(children: any): void
    unmount(): void
  }
  export function hydrateRoot(container: Element, children: any): any
}
declare namespace JSX {
  interface Element { [key: string]: any }
  interface IntrinsicElements { [elem: string]: any }
  interface ElementChildrenAttribute { children: {} }
}
`
