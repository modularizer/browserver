import type { OpenAPIClient } from '@modularizer/plat-client/client-server'
import type { RuntimeOperation } from './types'

export async function invokeOpenApiClientOperation(
  client: OpenAPIClient,
  operation: RuntimeOperation,
  input: Record<string, unknown>,
): Promise<unknown> {
  const m = operation.method.toUpperCase()
  if (m === 'GET') return client.get(operation.path as never, input as never)
  if (m === 'POST') return client.post(operation.path as never, input as never)
  if (m === 'PUT') return client.put(operation.path as never, input as never)
  if (m === 'PATCH') return client.patch(operation.path as never, input as never)
  if (m === 'DELETE') return client.delete(operation.path as never, input as never)
  throw new Error(`Unsupported HTTP method ${operation.method}`)
}

