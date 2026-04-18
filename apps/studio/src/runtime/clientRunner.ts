import ts from 'typescript'
import { connectBrowserverClientSideServer } from './cssTransport'
import { buildRuntimeEnvBindings } from './runtimeEnv'
import { collectWorkspaceDotEnv, createCommonJsCompatModules, mergeInjectedProcessEnv, type WorkspaceShimFile } from './tsCompatShims'

export interface ClientRunResult {
  result: unknown
  logs: string[]
  compiledCode: string
}

export async function runClientSource(options: {
  source: string
  targetUrl: string
  projectId?: string
  serverName?: string
  workspaceFiles?: WorkspaceShimFile[]
}): Promise<ClientRunResult> {
  const moduleSource = buildClientModuleSource(options.source)
  const compiled = ts.transpileModule(moduleSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  })

  const logs: string[] = []
  
  // Always get openapi by connecting to the target server (like real clients do)
  const { openapi: fetchedOpenapi } = await connectBrowserverClientSideServer(options.targetUrl)
  const openapi = fetchedOpenapi as unknown as Record<string, unknown>
  const runtimeEnv = buildRuntimeEnvBindings({
    projectId: options.projectId,
    serverName: options.serverName ?? options.targetUrl,
  })
  const workspaceDotEnv = collectWorkspaceDotEnv(options.workspaceFiles ?? [], options.projectId)
  const compatModules = createCommonJsCompatModules({
    workspaceDotEnv,
    protectedEnvKeys: Object.keys(runtimeEnv),
    serverName: options.serverName,
  })
  const effectiveEnv = mergeInjectedProcessEnv(runtimeEnv, workspaceDotEnv)
  const processRef = ensureClientProcessEnv(effectiveEnv)
  
  const LocalOpenAPIClient = createOpenApiClient(options.targetUrl)
  const module = { exports: {} as Record<string, unknown> }

  const require = (specifier: string) => {
    const compatModule = compatModules[specifier]
    if (compatModule) return compatModule
    if (specifier === '@modularizer/plat-client/client-server' || specifier === '@modularizer/plat-client' || specifier === '@modularizer/plat-client/client-server' || specifier === '@modularizer/plat-client') {
      return {
        OpenAPIClient: LocalOpenAPIClient,
      }
    }

    throw new Error(`Unsupported client import in browser playground: ${specifier}`)
  }

  const clientConsole = {
    log: (...args: unknown[]) => logs.push(renderLogLine(args)),
    info: (...args: unknown[]) => logs.push(renderLogLine(args)),
    warn: (...args: unknown[]) => logs.push(`[warn] ${renderLogLine(args)}`),
    error: (...args: unknown[]) => logs.push(`[error] ${renderLogLine(args)}`),
  }

  const evaluator = new Function(
    'exports',
    'module',
    'require',
    'console',
    'openapi',
    'process',
    compiled.outputText,
  )

  evaluator(module.exports, module, require, clientConsole, openapi, processRef)

  const run = module.exports.default
  if (typeof run !== 'function') {
    throw new Error('Client source did not produce a runnable entrypoint')
  }

  const result = await run()

  return {
    result,
    logs,
    compiledCode: compiled.outputText,
  }
}

function buildClientModuleSource(source: string): string {
  const requireLines: string[] = []
  const bodyLines: string[] = []

  for (const line of source.split('\n')) {
    const bareImportMatch = line.match(/^import\s+['"]([^'"]+)['"]\s*;?\s*$/)
    if (bareImportMatch) {
      requireLines.push(`require('${bareImportMatch[1]}')`)
      continue
    }

    const namedImportMatch = line.match(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/)
    if (namedImportMatch) {
      requireLines.push(`const {${namedImportMatch[1]}} = require('${namedImportMatch[2]}')`)
      continue
    }

    const defaultImportMatch = line.match(/^import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/)
    if (defaultImportMatch) {
      requireLines.push(`const __browserver_${defaultImportMatch[1]} = require('${defaultImportMatch[2]}')`)
      requireLines.push(`const ${defaultImportMatch[1]} = __browserver_${defaultImportMatch[1]}.default ?? __browserver_${defaultImportMatch[1]}`)
      continue
    }

    const namespaceImportMatch = line.match(/^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/)
    if (namespaceImportMatch) {
      requireLines.push(`const ${namespaceImportMatch[1]} = require('${namespaceImportMatch[2]}')`)
      continue
    }

    bodyLines.push(line)
  }

  return `
${requireLines.join('\n')}
module.exports.default = async function __browserverClientMain() {
${bodyLines.join('\n')}
}
`.trim()
}

function createOpenApiClient(targetUrl: string) {
  // Use real client connection for genuine communication
  return async () => {
    const { client } = await connectBrowserverClientSideServer(targetUrl)
    return client
  }
}

function ensureClientProcessEnv(env: Record<string, string>) {
  const globalRef = globalThis as Record<string, unknown>
  const existing = globalRef.process && typeof globalRef.process === 'object'
    ? globalRef.process as { env?: Record<string, string | undefined> }
    : {}
  const existingEnv = existing.env && typeof existing.env === 'object' ? existing.env : {}
  const processRef = {
    ...existing,
    env: {
      ...existingEnv,
      ...env,
    },
  }
  globalRef.process = processRef
  return processRef
}

function renderLogLine(args: unknown[]): string {
  return args.map((value) => formatValue(value)).join(' ')
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
