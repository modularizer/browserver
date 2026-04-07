import {
  createPythonBrowserRuntime,
  formatPythonBrowserValue,
} from '@modularizer/plat-client/python-browser'
import type {
  LocalRuntimeHandle,
} from './types'

export async function startPythonRuntime(options: {
  source: string
  serverName: string
}): Promise<LocalRuntimeHandle> {
  const runtime = await createPythonBrowserRuntime()

  try {
    const started = await runtime.startServer(options.source)

    return {
      language: 'python',
      launchable: true,
      launchNote: 'Powered by the installed @modularizer/plat-client/python-browser runtime.',
      serverName: started.server_name || options.serverName,
      connectionUrl: `css://${started.server_name || options.serverName}`,
      async stop() {
        await runtime.dispose()
      },
    }
  } catch (error) {
    await runtime.dispose()
    throw new Error(formatPythonBrowserValue(error))
  }
}
