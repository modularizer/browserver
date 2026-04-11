import * as monaco from 'monaco-editor'

let configured = false

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
}
