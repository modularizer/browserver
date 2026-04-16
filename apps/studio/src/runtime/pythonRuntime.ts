import {
  createPythonBrowserRuntime,
  formatPythonBrowserValue,
} from '@modularizer/plat-client/python-browser'
import { evaluateServerAuthorityStatus } from './authorityPolicy'
import { registerAuthorityHostedServer } from './authorityHost'
import { buildCssTargetUrl } from './clientTargetUrl'
import { useIdentityStore } from '../store/identity'
import { useNamespaceStore } from '../store/namespace'
import { useWorkspaceStore } from '../store/workspace'
import { buildRuntimeEnvBindings } from './runtimeEnv'
import { collectWorkspaceDotEnv, mergeInjectedProcessEnv, type WorkspaceShimFile } from './tsCompatShims'
import type {
  LocalRuntimeHandle,
} from './types'

type PythonRuntimeFs = {
  mkdirTree(path: string): void
  writeFile(path: string, data: string | Uint8Array): void
  readFile(path: string, opts?: { encoding?: 'utf8' }): string | Uint8Array
  readdir(path: string): string[]
  stat(path: string): { mode: number }
  isDir(mode: number): boolean
  isFile(mode: number): boolean
  unlink(path: string): void
}

type PythonRuntimeBridge = {
  FS: PythonRuntimeFs
}

const PYTHON_RESERVED_ROOTS = new Set(['plat_runtime', 'lib', 'usr', 'dev', 'proc', 'sys', 'tmp'])

export async function startPythonRuntime(options: {
  source: string
  serverName: string
  projectId?: string
  workspaceFiles?: WorkspaceShimFile[]
  entryFilePath?: string
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
  const runtimeBridge = runtime as unknown as PythonRuntimeBridge
  const runtimeEnv = buildRuntimeEnvBindings({
    projectId: options.projectId,
    serverName: options.serverName,
  })
  const workspaceDotEnv = collectWorkspaceDotEnv(options.workspaceFiles ?? [], options.projectId)
  const effectiveEnv = mergeInjectedProcessEnv(runtimeEnv, workspaceDotEnv)
  const entryFilePath = normalizeWorkspacePath(options.entryFilePath ?? '/server.py')
  let lastWorkspaceRef = useWorkspaceStore.getState().files
  let lastWorkspaceFiles = normalizeWorkspaceFiles(options.workspaceFiles ?? [{
    path: entryFilePath,
    content: options.source,
  }])
  let applyingRuntimeSnapshot = false

  mirrorWorkspaceIntoPythonFs(runtimeBridge.FS, lastWorkspaceFiles)

  try {
    const started = await runtime.startServer(injectRuntimeEnvIntoPythonSource(options.source, effectiveEnv, entryFilePath))
    syncPythonFsSnapshotToWorkspace(runtimeBridge.FS)
    const unsubscribeWorkspace = useWorkspaceStore.subscribe((state) => {
      if (applyingRuntimeSnapshot) return
      if (state.files === lastWorkspaceRef) return
      lastWorkspaceRef = state.files
      lastWorkspaceFiles = normalizeWorkspaceFiles(state.files.map((file) => ({ path: file.path, content: file.content })))
      mirrorWorkspaceIntoPythonFs(runtimeBridge.FS, lastWorkspaceFiles)
    })
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
            syncPythonFsSnapshotToWorkspace(runtimeBridge.FS)
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
        unsubscribeWorkspace()
        syncPythonFsSnapshotToWorkspace(runtimeBridge.FS)
        await authorityHandle?.stop()
        await runtime.dispose()
      },
    }

    function syncPythonFsSnapshotToWorkspace(fs: PythonRuntimeFs) {
      applyingRuntimeSnapshot = true
      try {
        const snapshot = readWorkspaceSnapshotFromPythonFs(fs)
        lastWorkspaceFiles = normalizeWorkspaceFiles(snapshot)
        lastWorkspaceRef = useWorkspaceStore.getState().files
        useWorkspaceStore.getState().applyRuntimeFilesystemSnapshot(snapshot)
      } finally {
        applyingRuntimeSnapshot = false
      }
    }
  } catch (error) {
    await runtime.dispose()
    throw new Error(formatPythonBrowserValue(error))
  }
}

function injectRuntimeEnvIntoPythonSource(source: string, env: Record<string, string>, entryFilePath: string): string {
  const payload = JSON.stringify(env)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
  const escapedEntryFilePath = entryFilePath
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")

  return `
import json as __browserver_json
import os as __browserver_os
import sys as __browserver_sys
__browserver_env = __browserver_json.loads('${payload}')
for __browserver_key, __browserver_value in __browserver_env.items():
    __browserver_os.environ[str(__browserver_key)] = str(__browserver_value)
__name__ = "__main__"
__file__ = '${escapedEntryFilePath}'
if "/" not in __browserver_sys.path:
    __browserver_sys.path.insert(0, "/")
__browserver_os.environ.setdefault("PWD", "/")
try:
    __browserver_os.chdir("/")
except Exception:
    pass

${source}
`.trim()
}

function mirrorWorkspaceIntoPythonFs(fs: PythonRuntimeFs, files: WorkspaceShimFile[]): void {
  const nextPaths = new Set(files.map((file) => normalizeWorkspacePath(file.path)))
  for (const file of files) {
    const path = normalizeWorkspacePath(file.path)
    const directory = parentDir(path)
    if (directory) fs.mkdirTree(directory)
    fs.writeFile(path, file.content)
  }
  for (const stalePath of readWorkspaceSnapshotFromPythonFs(fs).map((file) => file.path)) {
    if (nextPaths.has(stalePath)) continue
    try {
      fs.unlink(stalePath)
    } catch {
      // ignore missing or directory-backed paths
    }
  }
}

function readWorkspaceSnapshotFromPythonFs(fs: PythonRuntimeFs): Array<{ path: string; content: string | Uint8Array }> {
  const files: Array<{ path: string; content: string | Uint8Array }> = []
  walkPythonFs(fs, '/', files)
  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}

function walkPythonFs(
  fs: PythonRuntimeFs,
  directory: string,
  out: Array<{ path: string; content: string | Uint8Array }>,
): void {
  for (const entry of fs.readdir(directory)) {
    if (entry === '.' || entry === '..') continue
    if (directory === '/' && PYTHON_RESERVED_ROOTS.has(entry)) continue
    if (entry === '__pycache__') continue
    const path = directory === '/' ? `/${entry}` : `${directory}/${entry}`
    const stat = fs.stat(path)
    if (fs.isDir(stat.mode)) {
      walkPythonFs(fs, path, out)
      continue
    }
    if (!fs.isFile(stat.mode)) continue
    out.push({
      path,
      content: isTextWorkspacePath(path)
        ? fs.readFile(path, { encoding: 'utf8' }) as string
        : fs.readFile(path) as Uint8Array,
    })
  }
}

function normalizeWorkspaceFiles(files: WorkspaceShimFile[]): WorkspaceShimFile[] {
  return files.map((file) => ({
    path: normalizeWorkspacePath(file.path),
    content: file.content,
  }))
}

function normalizeWorkspacePath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed) return '/'
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function parentDir(path: string): string {
  const normalized = normalizeWorkspacePath(path)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return normalized.slice(0, lastSlash)
}

function isTextWorkspacePath(path: string): boolean {
  const lower = path.toLowerCase()
  return !(
    lower.endsWith('.png')
    || lower.endsWith('.jpg')
    || lower.endsWith('.jpeg')
    || lower.endsWith('.gif')
    || lower.endsWith('.bmp')
    || lower.endsWith('.ico')
    || lower.endsWith('.avif')
    || lower.endsWith('.webp')
    || lower.endsWith('.mp4')
    || lower.endsWith('.mov')
    || lower.endsWith('.webm')
    || lower.endsWith('.pdf')
    || lower.endsWith('.xlsx')
    || lower.endsWith('.zip')
    || lower.endsWith('.tar')
    || lower.endsWith('.gz')
    || lower.endsWith('.woff')
    || lower.endsWith('.woff2')
    || lower.endsWith('.ttf')
    || lower.endsWith('.eot')
  )
}
