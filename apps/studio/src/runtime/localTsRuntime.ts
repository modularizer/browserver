import {
  startClientSideServerFromSource,
} from '@modularizer/plat-client/client-server'
import type {
  LocalRuntimeHandle,
} from './types'

export async function startLocalTsRuntime(options: {
  source: string | Record<string, string>
  serverName: string
  onRequest?: (direction: 'request' | 'response', payload: unknown) => void
}): Promise<LocalRuntimeHandle> {
  const started = await startClientSideServerFromSource({
    source: options.source,
    serverName: options.serverName,
    sourceEntryPoint: typeof options.source === 'object' && 'index.ts' in options.source ? 'index.ts' : undefined,
    onRequest: options.onRequest,
  })

  const connectionUrl = started.connectionUrl
  const resolvedServerName = connectionUrl?.startsWith('css://')
    ? connectionUrl.slice('css://'.length)
    : options.serverName

  return {
    language: 'typescript',
    launchable: true,
    serverName: resolvedServerName,
    connectionUrl,
    async stop() {
      if (started && typeof (started as any).stop === 'function') {
        await (started as any).stop()
      }
    },
  }
}
