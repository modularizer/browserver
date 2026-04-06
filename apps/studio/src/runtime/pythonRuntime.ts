import {
  createPythonBrowserRuntime,
  formatPythonBrowserValue,
} from '@modularizer/plat-client/python-browser'
import type {
  LocalRuntimeHandle,
  RuntimeInvocationEvent,
  RuntimeOperation,
  RuntimeRequestTimelineEntry,
} from './types'

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

export async function startPythonRuntime(options: {
  source: string
  serverName: string
}): Promise<LocalRuntimeHandle> {
  const runtime = await createPythonBrowserRuntime()

  try {
    const started = await runtime.startServer(options.source)
    const operations = extractOperations(started.openapi)

    return {
      language: 'python',
      launchable: true,
      launchNote: 'Powered by the installed @modularizer/plat-client/python-browser runtime.',
      serverName: started.server_name || options.serverName,
      connectionUrl: `local-python://${started.server_name || options.serverName}`,
      openapi: started.openapi,
      diagnostics: [],
      compiledCode: null,
      analysisSummary: [
        {
          controller: 'Python browser server',
          methods: operations.map((operation) => operation.id),
        },
      ],
      operations,
      async invoke(operationId, input = {}) {
        const operation = operations.find((entry) => entry.id === operationId)
        if (!operation) {
          throw new Error(`Unknown operation: ${operationId}`)
        }

        const requestId = crypto.randomUUID()
        const timeline: RuntimeRequestTimelineEntry[] = [
          {
            id: crypto.randomUUID(),
            at: Date.now(),
            stage: 'invoke',
            title: `${operation.method} ${operation.path}`,
            detail: input,
          },
        ]
        const response = await runtime.handleRequest({
          operationId: operation.id,
          method: operation.method,
          path: operation.path,
          input,
          headers: {},
        })

        const events: RuntimeInvocationEvent[] = (response.events ?? []).map((event) => ({
          kind: 'event',
          payload: event,
        }))
        timeline.push(
          ...(response.events ?? []).map((event) => ({
            id: crypto.randomUUID(),
            at: Date.now(),
            stage: 'event' as const,
            title: `event:${event.event}`,
            detail: event.data,
          })),
        )

        return {
          requestId,
          operationId: operation.id,
          method: operation.method,
          path: operation.path,
          input,
          ok: true,
          result: response.result,
          events,
          timeline: [
            ...timeline,
            {
              id: crypto.randomUUID(),
              at: Date.now(),
              stage: 'result',
              title: 'completed',
              detail: response.result,
            },
          ],
        }
      },
      async stop() {
        await runtime.dispose()
      },
    }
  } catch (error) {
    await runtime.dispose()
    throw new Error(formatPythonBrowserValue(error))
  }
}
