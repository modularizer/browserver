import type { RuntimeEnvBindings } from './runtimeEnv'

export interface WorkspaceShimFile {
  path: string
  content: string | Uint8Array
}

export interface TsCompatAliases {
  specifierMap: Record<string, string>
  dispose: () => void
}

const DOTENV_FILE_ORDER = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  '.env.production.local',
  '.env.test',
  '.env.test.local',
] as const

const SHIM_SPECIFIERS = {
  dotenv: ['dotenv'],
  dotenvConfig: ['dotenv/config'],
  process: ['process', 'node:process'],
  path: ['path', 'node:path'],
  url: ['url', 'node:url'],
  buffer: ['buffer', 'node:buffer'],
} as const

export function collectWorkspaceDotEnv(files: ReadonlyArray<WorkspaceShimFile>, projectId?: string): Record<string, string> {
  const envByRelativePath = new Map<string, string>()

  for (const file of files) {
    if (typeof file.content !== 'string') continue
    const relativePath = toProjectRelativePath(file.path, projectId)
    if (!DOTENV_FILE_ORDER.includes(relativePath as (typeof DOTENV_FILE_ORDER)[number])) continue
    envByRelativePath.set(relativePath, file.content)
  }

  const merged: Record<string, string> = {}
  for (const path of DOTENV_FILE_ORDER) {
    const content = envByRelativePath.get(path)
    if (!content) continue
    Object.assign(merged, parseDotEnv(content))
  }
  return merged
}

export function mergeInjectedProcessEnv(runtimeEnv: RuntimeEnvBindings, workspaceDotEnv: Record<string, string>): Record<string, string> {
  return {
    ...workspaceDotEnv,
    ...runtimeEnv,
  }
}

export function rewriteTsCompatImports(source: string | Record<string, string>, specifierMap: Record<string, string>): string | Record<string, string> {
  const rewriteText = (value: string): string => {
    let next = value
    for (const [specifier, aliasUrl] of Object.entries(specifierMap)) {
      next = next.replaceAll(`'${specifier}'`, JSON.stringify(aliasUrl))
      next = next.replaceAll(`"${specifier}"`, JSON.stringify(aliasUrl))
    }
    return next
  }

  if (typeof source === 'string') return rewriteText(source)
  return Object.fromEntries(
    Object.entries(source).map(([path, content]) => {
      if (!/\.[cm]?[jt]sx?$/i.test(path)) return [path, content]
      return [path, rewriteText(content)]
    }),
  )
}

export function createTsCompatAliases(options: {
  workspaceDotEnv: Record<string, string>
  protectedEnvKeys?: Iterable<string>
}): TsCompatAliases {
  const protectedKeys = new Set(options.protectedEnvKeys ?? [])
  const registry = ((globalThis as Record<string, unknown>).__browserverCompatModuleRegistry ??= new Map<string, Record<string, unknown>>()) as Map<string, Record<string, unknown>>
  const specifierMap: Record<string, string> = {}
  const urls: string[] = []
  const ids: string[] = []

  const register = (specifiers: readonly string[], exports: Record<string, unknown>, exportNames: string[]) => {
    const id = `compat-${crypto.randomUUID()}`
    registry.set(id, exports)
    ids.push(id)
    const code = buildRegistryModuleCode(id, exportNames)
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
    urls.push(url)
    for (const specifier of specifiers) {
      specifierMap[specifier] = url
    }
  }

  const dotenvModule = createDotenvModule(options.workspaceDotEnv, protectedKeys)
  register(SHIM_SPECIFIERS.dotenv, dotenvModule, ['config', 'parse'])
  register(SHIM_SPECIFIERS.dotenvConfig, createDotenvConfigModule(dotenvModule), [])
  register(SHIM_SPECIFIERS.process, createProcessModule(), ['env', 'cwd', 'uptime'])
  register(SHIM_SPECIFIERS.path, createPathModule(), ['basename', 'delimiter', 'dirname', 'extname', 'format', 'join', 'normalize', 'parse', 'posix', 'resolve', 'sep'])
  register(SHIM_SPECIFIERS.url, createUrlModule(), ['URL', 'URLSearchParams', 'fileURLToPath', 'pathToFileURL'])
  register(SHIM_SPECIFIERS.buffer, createBufferModule(), ['Buffer', 'INSPECT_MAX_BYTES', 'kMaxLength'])

  return {
    specifierMap,
    dispose() {
      for (const id of ids) registry.delete(id)
      for (const url of urls) URL.revokeObjectURL(url)
    },
  }
}

export function createCommonJsCompatModules(options: {
  workspaceDotEnv: Record<string, string>
  protectedEnvKeys?: Iterable<string>
}): Record<string, unknown> {
  const protectedKeys = new Set(options.protectedEnvKeys ?? [])
  const dotenvModule = createDotenvModule(options.workspaceDotEnv, protectedKeys)
  const processModule = createProcessModule()
  const pathModule = createPathModule()
  const urlModule = createUrlModule()
  const bufferModule = createBufferModule()
  const dotenvConfigModule = createDotenvConfigModule(dotenvModule)

  return Object.fromEntries([
    ...SHIM_SPECIFIERS.dotenv.map((specifier) => [specifier, dotenvModule]),
    ...SHIM_SPECIFIERS.dotenvConfig.map((specifier) => [specifier, dotenvConfigModule]),
    ...SHIM_SPECIFIERS.process.map((specifier) => [specifier, processModule]),
    ...SHIM_SPECIFIERS.path.map((specifier) => [specifier, pathModule]),
    ...SHIM_SPECIFIERS.url.map((specifier) => [specifier, urlModule]),
    ...SHIM_SPECIFIERS.buffer.map((specifier) => [specifier, bufferModule]),
  ])
}

function buildRegistryModuleCode(id: string, exportNames: string[]): string {
  const lines = [
    'const __registry = globalThis.__browserverCompatModuleRegistry',
    `const __m = __registry?.get(${JSON.stringify(id)})`,
    `if (!__m) throw new Error('Missing browserver compat module: ${id}')`,
    'export default (__m.default ?? __m)',
  ]
  for (const name of exportNames) {
    lines.push(`export const ${name} = __m.${name}`)
  }
  return lines.join('\n')
}

function createDotenvModule(workspaceDotEnv: Record<string, string>, protectedKeys: Set<string>) {
  const ensureProcessEnv = () => getMutableProcessEnv()
  const parsedSnapshot = { ...workspaceDotEnv }

  const parse = (src: string | Uint8Array) => {
    const text = typeof src === 'string' ? src : new TextDecoder().decode(src)
    return parseDotEnv(text)
  }

  const config = (options?: { processEnv?: Record<string, string | undefined>; override?: boolean }) => {
    const target = options?.processEnv ?? ensureProcessEnv()
    const override = Boolean(options?.override)
    for (const [key, value] of Object.entries(parsedSnapshot)) {
      if (protectedKeys.has(key)) continue
      if (override || target[key] === undefined) {
        target[key] = value
      }
    }
    return { parsed: { ...parsedSnapshot } }
  }

  return {
    config,
    parse,
    default: { config, parse },
  }
}

function createDotenvConfigModule(dotenvModule: { config: (options?: { processEnv?: Record<string, string | undefined>; override?: boolean }) => { parsed: Record<string, string> } }) {
  dotenvModule.config()
  return { default: {} }
}

function createProcessModule() {
  const processRef = ensureProcessShim()
  return {
    default: processRef,
    env: processRef.env,
    cwd: processRef.cwd,
    uptime: processRef.uptime,
  }
}

function createPathModule() {
  const pathModule = {
    sep: '/',
    delimiter: ':',
    basename(path: string, suffix?: string) {
      const base = trimTrailingSlash(path).split('/').pop() ?? ''
      return suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base
    },
    dirname(path: string) {
      const normalized = normalizePosix(path)
      if (normalized === '/') return '/'
      const parts = normalized.split('/').filter(Boolean)
      parts.pop()
      return parts.length === 0 ? '.' : `/${parts.join('/')}`
    },
    extname(path: string) {
      const base = trimTrailingSlash(path).split('/').pop() ?? ''
      const index = base.lastIndexOf('.')
      return index <= 0 ? '' : base.slice(index)
    },
    format(parts: { root?: string; dir?: string; base?: string; ext?: string; name?: string }) {
      const dir = parts.dir || parts.root || ''
      const base = parts.base || `${parts.name ?? ''}${parts.ext ?? ''}`
      return dir ? `${trimTrailingSlash(dir)}/${base}` : base
    },
    join(...parts: string[]) {
      return normalizePosix(parts.join('/'))
    },
    normalize: normalizePosix,
    parse(path: string) {
      const normalized = normalizePosix(path)
      const base = trimTrailingSlash(normalized).split('/').pop() ?? ''
      const ext = pathModule.extname(base)
      const name = ext ? base.slice(0, -ext.length) : base
      const dir = pathModule.dirname(normalized)
      return {
        root: normalized.startsWith('/') ? '/' : '',
        dir,
        base,
        ext,
        name,
      }
    },
    posix: null as unknown,
    resolve(...parts: string[]) {
      const joined = parts.filter(Boolean).join('/')
      return normalizePosix(joined.startsWith('/') ? joined : `/${joined}`)
    },
  }
  pathModule.posix = pathModule
  return {
    ...pathModule,
    default: pathModule,
  }
}

function createUrlModule() {
  const pathToFileURL = (value: string) => new URL(`file://${normalizePosix(value)}`)
  const fileURLToPath = (value: string | URL) => {
    const url = value instanceof URL ? value : new URL(value)
    if (url.protocol !== 'file:') {
      throw new Error(`Expected file: URL, received ${url.protocol}`)
    }
    return decodeURIComponent(url.pathname || '/')
  }

  return {
    default: { URL, URLSearchParams, pathToFileURL, fileURLToPath },
    URL,
    URLSearchParams,
    pathToFileURL,
    fileURLToPath,
  }
}

function createBufferModule() {
  class BrowserBuffer {
    private readonly bytes: Uint8Array

    constructor(value: number | ArrayLike<number> | ArrayBufferLike = 0) {
      if (typeof value === 'number') {
        this.bytes = new Uint8Array(value)
        return
      }
      if (value instanceof ArrayBuffer) {
        this.bytes = new Uint8Array(value)
        return
      }
      this.bytes = Uint8Array.from(value as ArrayLike<number>)
    }

    static from(value: string | ArrayLike<number> | ArrayBufferLike, encoding?: string): BrowserBuffer {
      if (typeof value === 'string') {
        return new BrowserBuffer(encodeString(value, encoding))
      }
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return new BrowserBuffer(value as ArrayBufferLike)
      }
      return new BrowserBuffer(value)
    }

    static alloc(size: number): BrowserBuffer {
      return new BrowserBuffer(size)
    }

    get length(): number {
      return this.bytes.length
    }

    [Symbol.iterator](): IterableIterator<number> {
      return this.bytes[Symbol.iterator]()
    }

    toString(encoding?: string): string {
      return decodeBytes(this.bytes, encoding)
    }
  }

  return {
    default: { Buffer: BrowserBuffer, INSPECT_MAX_BYTES: 50, kMaxLength: Number.MAX_SAFE_INTEGER },
    Buffer: BrowserBuffer,
    INSPECT_MAX_BYTES: 50,
    kMaxLength: Number.MAX_SAFE_INTEGER,
  }
}

function ensureProcessShim(): {
  env: Record<string, string | undefined>
  cwd: () => string
  uptime: () => number
} {
  const globalRef = globalThis as Record<string, unknown>
  const existing = globalRef.process && typeof globalRef.process === 'object'
    ? globalRef.process as {
        env?: Record<string, string | undefined>
        cwd?: () => string
        uptime?: () => number
      }
    : {}
  const env = existing.env && typeof existing.env === 'object' ? existing.env : {}
  const createdAt = performance.now()
  const processRef = {
    ...existing,
    env,
    cwd: existing.cwd ?? (() => '/'),
    uptime: existing.uptime ?? (() => Math.max(0, (performance.now() - createdAt) / 1000)),
  }
  globalRef.process = processRef
  return processRef
}

function getMutableProcessEnv(): Record<string, string | undefined> {
  return ensureProcessShim().env
}

function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const sanitized = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const equalsIndex = sanitized.indexOf('=')
    if (equalsIndex <= 0) continue
    const key = sanitized.slice(0, equalsIndex).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = sanitized.slice(equalsIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    } else {
      const commentIndex = value.indexOf(' #')
      if (commentIndex >= 0) value = value.slice(0, commentIndex).trim()
    }
    value = value
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
    result[key] = value
  }

  return result
}

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

function trimTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

function normalizePosix(path: string): string {
  const parts = path.split('/')
  const output: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      output.pop()
      continue
    }
    output.push(part)
  }
  return `${path.startsWith('/') ? '/' : ''}${output.join('/')}` || (path.startsWith('/') ? '/' : '.')
}

function encodeString(value: string, encoding?: string): Uint8Array {
  if (encoding === 'base64') {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  return new TextEncoder().encode(value)
}

function decodeBytes(value: Uint8Array, encoding?: string): string {
  if (encoding === 'base64') {
    let binary = ''
    for (const byte of value) binary += String.fromCharCode(byte)
    return btoa(binary)
  }
  return new TextDecoder().decode(value)
}
