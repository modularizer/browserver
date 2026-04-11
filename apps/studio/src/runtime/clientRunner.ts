import ts from 'typescript'
import { connectClientSideServer } from '@modularizer/plat-client/client-server'

export interface ClientRunResult {
  result: unknown
  logs: string[]
  compiledCode: string
}

export async function runClientSource(options: {
  source: string
  targetUrl: string
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
  const { openapi: fetchedOpenapi } = await connectClientSideServer({ baseUrl: options.targetUrl })
  const openapi = fetchedOpenapi as unknown as Record<string, unknown>
  
  const LocalOpenAPIClient = createOpenApiClient(options.targetUrl)
  const module = { exports: {} as Record<string, unknown> }

  const require = (specifier: string) => {
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
    compiled.outputText,
  )

  evaluator(module.exports, module, require, clientConsole, openapi)

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
    const importMatch = line.match(/^import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/)
    if (importMatch) {
      requireLines.push(`const {${importMatch[1]}} = require('${importMatch[2]}')`)
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
    const { client } = await connectClientSideServer({ baseUrl: targetUrl })
    return client
  }
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
