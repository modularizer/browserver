import {
  createPythonBrowserRuntime,
  formatPythonBrowserValue,
} from '@modularizer/plat-client/python-browser'
import { evaluateServerAuthorityStatus } from './authorityPolicy'
import { registerAuthorityHostedServer } from './authorityHost'
import { buildCssTargetUrl } from './clientTargetUrl'
import { useIdentityStore } from '../store/identity'
import { useNamespaceStore } from '../store/namespace'
import type {
  LocalRuntimeHandle,
} from './types'

export async function startPythonRuntime(options: {
  source: string
  serverName: string
}): Promise<LocalRuntimeHandle> {
  if (useIdentityStore.getState().user && !options.serverName.trim().startsWith('dmz/')) {
    await useNamespaceStore.getState().ensureAuthorityData()
  }

  const authorityStatus = evaluateServerAuthorityStatus(
    options.serverName,
    useIdentityStore.getState().user,
    useNamespaceStore.getState().namespaces,
  )
  if (!authorityStatus.allowed) {
    throw new Error(authorityStatus.reason ?? 'Server name is not allowed.')
  }

  const runtime = await createPythonBrowserRuntime()

  try {
    const started = await runtime.startServer(options.source)
    const resolvedServerName = started.server_name || options.serverName
    const hostToken = useIdentityStore.getState().user?.idToken ?? ''
    const pythonServerAdapter = {
      serveChannel(channel: { subscribe(listener: (message: any) => void | Promise<void>): () => void; send?: (message: any) => Promise<void> | void }) {
        return channel.subscribe(async (message: any) => {
          if (!message || typeof message !== 'object' || !('method' in message) || !('path' in message) || message.cancel) {
            return
          }
          if (String(message.method).toUpperCase() === 'GET' && String(message.path) === '/openapi.json') {
            await channel.send?.({
              jsonrpc: '2.0',
              id: message.id,
              ok: true,
              result: started.openapi,
            })
            return
          }
          try {
            const result = await (runtime as any).handleRequest({
              operationId: message.operationId,
              method: message.method,
              path: message.path,
              input: message.input ?? {},
              headers: message.headers ?? {},
            })
            for (const event of result?.events ?? []) {
              await channel.send?.({
                jsonrpc: '2.0',
                id: message.id,
                ok: true,
                event: event.event,
                data: event.data,
              })
            }
            await channel.send?.({
              jsonrpc: '2.0',
              id: message.id,
              ok: true,
              result: result?.result,
            })
          } catch (error) {
            await channel.send?.({
              jsonrpc: '2.0',
              id: message.id,
              ok: false,
              error: {
                status: 500,
                message: formatPythonBrowserValue(error),
              },
            })
          }
        })
      },
    }
    const authorityHandle = !resolvedServerName.startsWith('dmz/') && hostToken
      ? await registerAuthorityHostedServer({
          serverName: resolvedServerName,
          server: pythonServerAdapter,
          token: hostToken,
          authMode: 'public',
        })
      : null

    return {
      language: 'python',
      launchable: true,
      launchNote: 'Powered by the installed @modularizer/plat-client/python-browser runtime.',
      serverName: resolvedServerName,
      connectionUrl: buildCssTargetUrl(resolvedServerName),
      async stop() {
        await authorityHandle?.stop()
        await runtime.dispose()
      },
    }
  } catch (error) {
    await runtime.dispose()
    throw new Error(formatPythonBrowserValue(error))
  }
}
