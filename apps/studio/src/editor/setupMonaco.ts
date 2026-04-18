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
// Note: No @modularizer/plat-client types here. Real types are injected at runtime via
// the virtual:plat-client-bundle Vite plugin in setupMonacoTypeEnvironment().

declare module 'plat' {
  export function serve_client_side_server(
    serverName: string,
    controllers: unknown[],
  ): unknown
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

declare module 'redis' {
  export interface SetOptions {
    EX?: number
    PX?: number
    NX?: boolean
    XX?: boolean
  }

  export interface RedisClientOptions {
    prefix?: string
    url?: string
    [key: string]: unknown
  }

  export interface RedisClientType {
    connect(): Promise<void>
    quit(): Promise<void>
    disconnect(): Promise<void>

    get(key: string): Promise<string | null>
    set(key: string, value: string, options?: SetOptions): Promise<'OK' | null>
    setEx(key: string, seconds: number, value: string): Promise<'OK'>
    pSetEx(key: string, ms: number, value: string): Promise<'OK'>
    del(keys: string | string[]): Promise<number>
    exists(keys: string | string[]): Promise<number>
    expire(key: string, seconds: number): Promise<boolean>
    ttl(key: string): Promise<number>
    keys(pattern: string): Promise<string[]>
    incr(key: string): Promise<number>
    decr(key: string): Promise<number>
    incrBy(key: string, by: number): Promise<number>
    decrBy(key: string, by: number): Promise<number>

    hSet(key: string, field: string | Record<string, string>, value?: string): Promise<number>
    hGet(key: string, field: string): Promise<string | undefined>
    hGetAll(key: string): Promise<Record<string, string>>
    hDel(key: string, fields: string | string[]): Promise<number>
    hKeys(key: string): Promise<string[]>
    hVals(key: string): Promise<string[]>
    hExists(key: string, field: string): Promise<boolean>

    publish(channel: string, message: string): Promise<number>
    subscribe(channel: string, listener: (message: string, channel: string) => void): Promise<void>
    unsubscribe(channel?: string): Promise<void>

    flushDb(): Promise<'OK'>
    flushAll(): Promise<'OK'>
  }

  export function createClient(options?: RedisClientOptions): RedisClientType
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


  // Attempt to load real .d.ts from the installed @modularizer/plat-client package via the
  // virtual bundle provided by the Vite plugin. No ambient-module hacks; we mirror a node_modules layout.
  ;(async () => {
    try {
      const mod = await import('virtual:plat-client-bundle')
      const files: Array<{ path: string; contents: string }> = (mod as any).files || []
      const aliases: Record<string, string> = (mod as any).aliases || {}
      const dtsFiles = files.filter((f) => {
        if (!f || typeof f.path !== 'string') return false
        return f.path.endsWith('.d.ts') || f.path.endsWith('.d.mts') || f.path.endsWith('.d.cts')
      })
      const toFileUrl = (p: string) => `file://${p.startsWith('/') ? p : '/' + p}`
      // Register all real declaration files so they are available by absolute URL
      for (const f of dtsFiles) {
        const url = toFileUrl(f.path)
        tsLanguage.typescriptDefaults.addExtraLib(f.contents, url)
      }
      if (dtsFiles.length) {
        const dtsSet = new Set(dtsFiles.map((f) => f.path.replace(/\\/g, '/')))
        // For each alias (package subpath), create a proper index.d.ts file under a virtual node_modules tree
        // This mirrors standard Node/TS resolution and avoids ambient declare-module hacks.
        let created = 0
        const pathsMap: Record<string, string[]> = {}
        const createIndexFor = (spec: string, targetPath: string) => {
          const specDir = `file:///node_modules/${spec}`.replace(/\\/g, '/')
          const filePath = `${specDir}/index.d.ts`
          const content = `export * from '${toFileUrl(targetPath)}';\nexport { default } from '${toFileUrl(targetPath)}';\n`
          tsLanguage.typescriptDefaults.addExtraLib(content, filePath)
          pathsMap[spec] = [filePath]
          created++
        }
        for (const [spec, jsPath] of Object.entries(aliases)) {
          const js = (jsPath || '').replace(/\\/g, '/')
          const candidates = [
            js.replace(/\.js$/i, '.d.ts'),
            js.replace(/\.js$/i, '.d.mts'),
            js.replace(/\.js$/i, '.d.cts'),
            js.endsWith('/index.js') ? js.slice(0, -3) + 'd.ts' : js,
          ].filter((p, i, arr) => typeof p === 'string' && p !== js && arr.indexOf(p) === i)
          const target = candidates.find((p) => dtsSet.has(p))
          if (target) createIndexFor(spec, target)
        }
        // Optional legacy compatibility by providing real files under legacy package path
        const legacySpecs: Array<[string, string]> = [
          ['@modularizer/plat/client', '@modularizer/plat-client'],
          ['@modularizer/plat/client-server', '@modularizer/plat-client/client-server'],
        ]
        for (const [legacy, modern] of legacySpecs) {
          const modernJs = aliases[modern]
          if (!modernJs) continue
          const js = modernJs.replace(/\\/g, '/')
          const candidates = [
            js.replace(/\.js$/i, '.d.ts'),
            js.replace(/\.js$/i, '.d.mts'),
            js.replace(/\.js$/i, '.d.cts'),
            js.endsWith('/index.js') ? js.slice(0, -3) + 'd.ts' : js,
          ].filter((p, i, arr) => typeof p === 'string' && p !== js && arr.indexOf(p) === i)
          const target = candidates.find((p) => dtsSet.has(p))
          if (target) {
            const specDir = `file:///node_modules/${legacy}`
            const filePath = `${specDir}/index.d.ts`
            const content = `export * from '${toFileUrl(target)}';\nexport { default } from '${toFileUrl(target)}';\n`
            tsLanguage.typescriptDefaults.addExtraLib(content, filePath)
            pathsMap[legacy] = [filePath]
            created++
          }
        }
        // Update TS compiler options to point module specifiers to our virtual node_modules entries
        const current = compilerOptions as any
        tsLanguage.typescriptDefaults.setCompilerOptions({ ...current, baseUrl: '/', paths: { ...(current.paths || {}), ...pathsMap } })
        console.info(`[browserver] Monaco typings: loaded ${dtsFiles.length} declaration file(s) from @modularizer/plat-client and created ${created} virtual node_modules index.d.ts file(s).`)
      } else {
        console.warn('[browserver] Monaco typings: no declaration files found in @modularizer/plat-client dist; Monaco will report missing modules until declarations exist.')
      }
    } catch (err) {
      console.warn('[browserver] Monaco typings: virtual:plat-client-bundle not available; only generic environment typings applied.', err)
    }
  })()

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
