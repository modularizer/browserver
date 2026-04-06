import ts from 'typescript'
import {
  analyzeClientSideServerSource,
  type ClientSideServerSourceAnalysis,
  createClientSideServer,
} from '@modularizer/plat-client/client-server'
import type {
  LocalRuntimeHandle,
  RuntimeDiagnostic,
  RuntimeInvocationEvent,
  RuntimeInvocationResult,
  RuntimeOperation,
  RuntimeRequestTimelineEntry,
} from './types'

type ControllerClass = new () => any

interface ClientSideServerDefinition {
  serverName: string
  controllers: ControllerClass[]
}

function compileServerModule(source: string): { code: string; diagnostics: RuntimeDiagnostic[] } {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  })

  return {
    code: transpiled.outputText,
    diagnostics: (transpiled.diagnostics ?? []).map((diagnostic) => mapDiagnostic(diagnostic)),
  }
}

function loadServerModule(source: string): {
  exports: Record<string, unknown>
  compiledCode: string
  diagnostics: RuntimeDiagnostic[]
} {
  const compiled = compileServerModule(source)
  const module = { exports: {} as Record<string, unknown> }

  const require = (specifier: string) => {
    if (specifier === '@modularizer/plat-client/client-server' || specifier === '@modularizer/plat/client-server') {
      return {
        serveClientSideServer(serverName: string, controllers: ControllerClass[]): ClientSideServerDefinition {
          return { serverName, controllers }
        },
      }
    }

    throw new Error(`Unsupported import in browser runtime: ${specifier}`)
  }

  const evaluator = new Function('exports', 'module', 'require', compiled.code)
  evaluator(module.exports, module, require)

  return {
    exports: module.exports,
    compiledCode: compiled.code,
    diagnostics: compiled.diagnostics,
  }
}

function resolveDefinition(
  loaded: Record<string, unknown>,
  fallbackServerName: string,
): ClientSideServerDefinition {
  if (isServerDefinition(loaded.clientSideServer)) {
    return loaded.clientSideServer
  }

  if (isServerDefinition(loaded.default)) {
    return loaded.default
  }

  const controllers = resolveControllers(loaded)
  return {
    serverName: fallbackServerName,
    controllers,
  }
}

function resolveControllers(loaded: Record<string, unknown>): ControllerClass[] {
  if (Array.isArray(loaded.controllers)) {
    return loaded.controllers as ControllerClass[]
  }

  if (Array.isArray(loaded.default)) {
    return loaded.default as ControllerClass[]
  }

  if (loaded.default && typeof loaded.default === 'object' && Array.isArray((loaded.default as any).controllers)) {
    return (loaded.default as any).controllers as ControllerClass[]
  }

  throw new Error('Expected the source module to export controllers or a serveClientSideServer(...) definition')
}

function isServerDefinition(value: unknown): value is ClientSideServerDefinition {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof (value as ClientSideServerDefinition).serverName === 'string'
      && Array.isArray((value as ClientSideServerDefinition).controllers),
  )
}

function extractOperations(openapi: Record<string, any>): RuntimeOperation[] {
  const operations: RuntimeOperation[] = []

  for (const [path, methods] of Object.entries(openapi.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
      operations.push({
        id: operation.operationId ?? `${method}:${path}`,
        method: method.toUpperCase(),
        path,
        summary: operation.summary,
        inputSchema:
          operation.requestBody?.content?.['application/json']?.schema
          ?? parametersToSchema(operation.parameters),
      })
    }
  }

  return operations
}

function parametersToSchema(parameters: Array<any> | undefined): Record<string, unknown> | undefined {
  if (!parameters?.length) return undefined

  const properties = Object.fromEntries(
    parameters.map((parameter) => [parameter.name, parameter.schema ?? {}]),
  )
  const required = parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name)

  return {
    type: 'object',
    properties,
    required,
  }
}

export async function startLocalTsRuntime(options: {
  source: string
  serverName: string
}): Promise<LocalRuntimeHandle> {
  const loaded = loadServerModule(options.source)
  const definition = resolveDefinition(loaded.exports, options.serverName)
  const analysis = analyzeClientSideServerSource(ts as any, options.source, { undecoratedMode: 'POST' })
  const server = createClientSideServer({ undecoratedMode: 'POST' }, ...definition.controllers)
  const openapi = server.openapi
  const operations = extractOperations(openapi)

  return {
    language: 'typescript',
    launchable: true,
    serverName: definition.serverName,
    connectionUrl: `local://${definition.serverName}`,
    openapi,
    diagnostics: loaded.diagnostics,
    compiledCode: loaded.compiledCode,
    analysisSummary: analysis.controllers.map((controller) => ({
      controller: controller.name,
      methods: controller.methods.map((method) => method.name),
    })),
    operations,
    async invoke(operationId, input = {}) {
      const operation = operations.find((entry) => entry.id === operationId)
      if (!operation) {
        throw new Error(`Unknown operation: ${operationId}`)
      }

      const requestId = crypto.randomUUID()
      const events: RuntimeInvocationEvent[] = []
      const timeline: RuntimeRequestTimelineEntry[] = [
        {
          id: crypto.randomUUID(),
          at: Date.now(),
          stage: 'invoke',
          title: `${operation.method} ${operation.path}`,
          detail: input,
        },
      ]
      let finalMessage: any = null

      await server.handleMessage(
        {
          jsonrpc: '2.0',
          id: requestId,
          method: operation.method,
          path: operation.path,
          operationId,
          input,
        } as any,
        {
          send: async (payload: unknown) => {
            if (payload && typeof payload === 'object' && 'event' in (payload as unknown as Record<string, unknown>)) {
              events.push({ kind: 'event', payload })
              timeline.push({
                id: crypto.randomUUID(),
                at: Date.now(),
                stage: 'event',
                title: `event:${String((payload as Record<string, unknown>).event ?? 'runtime')}`,
                detail: payload,
              })
            } else {
              events.push({ kind: 'response', payload })
              timeline.push({
                id: crypto.randomUUID(),
                at: Date.now(),
                stage: 'response',
                title: 'response',
                detail: payload,
              })
              finalMessage = payload
            }
          },
          subscribe: () => () => {},
        },
      )

      return {
        requestId,
        operationId,
        method: operation.method,
        path: operation.path,
        input,
        ok: Boolean(finalMessage?.ok),
        result: finalMessage?.result,
        error: finalMessage?.ok
          ? undefined
          : {
              status: finalMessage?.error?.status,
              message: finalMessage?.error?.message ?? 'Unknown runtime error',
            },
        events,
        timeline: [
          ...timeline,
          {
            id: crypto.randomUUID(),
            at: Date.now(),
            stage: finalMessage?.ok ? 'result' : 'error',
            title: finalMessage?.ok ? 'completed' : 'failed',
            detail: finalMessage?.ok ? finalMessage?.result : finalMessage?.error,
          },
        ],
      }
    },
    async stop() {
      return
    },
  }
}

function mapDiagnostic(diagnostic: ts.Diagnostic): RuntimeDiagnostic {
  const flattened = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  const location = diagnostic.file && typeof diagnostic.start === 'number'
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    : null

  return {
    category:
      diagnostic.category === ts.DiagnosticCategory.Error
        ? 'error'
        : diagnostic.category === ts.DiagnosticCategory.Warning
          ? 'warning'
          : 'message',
    code: diagnostic.code,
    message: flattened,
    line: location ? location.line + 1 : undefined,
    column: location ? location.character + 1 : undefined,
  }
}

export function buildSampleInput(schema: Record<string, any> | undefined): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return {}

  if (schema.type === 'object' && schema.properties && typeof schema.properties === 'object') {
    return Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, buildValueFromSchema(value as Record<string, any>)]),
    )
  }

  return {}
}

function buildValueFromSchema(schema: Record<string, any>): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  if ('const' in schema) return schema.const
  if (schema.type === 'string') return schema.format === 'date-time' ? new Date().toISOString() : 'example'
  if (schema.type === 'number' || schema.type === 'integer') return 1
  if (schema.type === 'boolean') return true
  if (schema.type === 'array') return []
  if (schema.type === 'object') return buildSampleInput(schema)
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) return buildValueFromSchema(schema.oneOf[0])
  return null
}
