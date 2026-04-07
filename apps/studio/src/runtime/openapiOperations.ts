import type { RuntimeOperation } from './types'

/** Human-friendly name for UI; `id` stays the real OpenAPI operationId for invokes. */
export function deriveOperationLabel(method: string, path: string, operationId: string): string {
  const p = path || ''
  const verbPath = operationId.match(/^([A-Z]+)\s+(\/\S*)$/i)
  if (verbPath) {
    const segments = p.split('/').filter(Boolean)
    return segments[segments.length - 1] ?? operationId.replace(/^([A-Z]+)\s+/i, '').replace(/^\//, '')
  }
  if (operationId.includes(':') && !/^https?:/i.test(operationId)) {
    const rest = operationId.slice(operationId.indexOf(':') + 1)
    if (rest.startsWith('/')) {
      const segments = rest.split('/').filter(Boolean)
      return segments[segments.length - 1] ?? operationId
    }
  }
  if (!/\s/.test(operationId)) {
    return operationId
  }
  const segments = p.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? operationId
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

const HTTP_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'])

export function extractOperationsFromOpenApi(openapi: Record<string, any>): RuntimeOperation[] {
  const operations: RuntimeOperation[] = []

  for (const [path, methods] of Object.entries(openapi.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
      if (!HTTP_VERBS.has(method.toLowerCase())) continue
      if (!operation || typeof operation !== 'object') continue

      const id = operation.operationId ?? `${method}:${path}`
      operations.push({
        id,
        label: deriveOperationLabel(method, path, id),
        method: method.toUpperCase(),
        path,
        summary: operation.summary || operation.description,
        inputSchema:
          operation.requestBody?.content?.['application/json']?.schema
          ?? parametersToSchema(operation.parameters),
      })
    }
  }

  return operations
}
