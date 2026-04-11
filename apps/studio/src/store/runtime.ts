import { create } from 'zustand'
import { connectClientSideServer, OpenAPIClient } from '@modularizer/plat-client/client-server'
import {
  startLocalTsRuntime,
} from '../runtime/localTsRuntime'
import { runClientSource } from '../runtime/clientRunner'
import { startPythonRuntime } from '../runtime/pythonRuntime'
import { normalizeClientApiBaseUrl, normalizeCssTargetUrl } from '../runtime/clientTargetUrl'
import { extractOperationsFromOpenApi } from '../runtime/openapiOperations'
import { invokeOpenApiClientOperation } from '../runtime/openapiInvoke'
import type {
  RuntimeAnalysisSummary,
  LocalRuntimeHandle,
  RuntimeDiagnostic,
  RuntimeOperation,
  RuntimeRequestTimelineEntry,
} from '../runtime/types'
import { useWorkspaceStore, type EditorPaneId } from './workspace'

export interface RuntimeLogEntry {
  id: string
  level: 'info' | 'error' | 'event'
  message: string
  detail?: unknown
  at: number
}

export interface RuntimeRequestEntry {
  id: string
  operationId: string
  /** Same as matching RuntimeOperation.label when known. */
  operationLabel?: string
  method: string
  path: string
  input: Record<string, unknown>
  ok: boolean
  result?: unknown
  error?: { status?: number; message: string }
  events: Array<{ kind: 'event' | 'response'; payload: unknown }>
  startedAt: number
  endedAt: number
  durationMs: number
  timeline: RuntimeRequestTimelineEntry[]
}

export interface RuntimeClientRunEntry {
  id: string
  filePath: string
  targetUrl?: string
  status: 'idle' | 'running' | 'success' | 'error'
  logs: string[]
  result?: unknown
  error?: string
  compiledCode?: string
  startedAt: number
  endedAt?: number
  durationMs?: number
}

export interface DiscoveredServer {
  instanceId: string
  serverName: string
  workerInfo: { weight?: number; currentClients?: number; acceptingNewClients?: boolean }
  instanceInfo?: { version?: string; versionHash?: string; openapiHash?: string; updatedAt?: number; serverStartedAt?: number }
  mqttChallengeVerified: boolean
  discoveredAt: number
}

export interface ServerEntry {
  id: string
  source: 'local' | 'discovered'
  serverName: string
  connectionUrl: string | null
  status: 'running' | 'stopped' | 'unknown'
  filePath?: string
  instanceInfo?: DiscoveredServer['instanceInfo']
  workerInfo?: DiscoveredServer['workerInfo']
  mqttChallengeVerified?: boolean
}

export interface TabRuntimeSession {
  mode: 'idle' | 'server' | 'client'
  language: 'typescript' | 'python' | null
  status: 'idle' | 'starting' | 'running' | 'error'
  launchable: boolean
  launchNote: string | null
  launchedFilePath: string | null
  launchedFileUpdatedAt: number | null
  connectionUrl: string | null
  serverName: string | null
  errorMessage: string | null
  lastClientStatus: 'idle' | 'running' | 'success' | 'error'
}

interface RuntimeState {
  activeRuntimePane: EditorPaneId
  tabSessions: Record<string, TabRuntimeSession>
  language: 'typescript' | 'python' | null
  status: 'idle' | 'starting' | 'running' | 'error'
  launchable: boolean
  launchNote: string | null
  launchedServerFilePath: string | null
  launchedServerUpdatedAt: number | null
  connectionUrl: string | null
  serverName: string | null
  diagnostics: RuntimeDiagnostic[]
  compiledCode: string
  analysisSummary: RuntimeAnalysisSummary[]
  openapiDocument: Record<string, unknown> | null
  operations: RuntimeOperation[]
  invocationDrafts: Record<string, string>
  logs: RuntimeLogEntry[]
  requests: RuntimeRequestEntry[]
  highlightedHandler: string | null
  activeRequestId: string | null
  clientRun: RuntimeClientRunEntry | null
  clientTargetUrl: string
  recentClientTargets: string[]
  errorMessage: string | null
  discoveredServers: DiscoveredServer[]
  discoveryStatus: 'idle' | 'discovering' | 'error'
  discoveryError: string | null
  lastDiscoveryAt: number | null
  focusPaneRuntime: (pane: EditorPaneId) => void
  runPane: (pane: EditorPaneId) => Promise<void>
  stopPane: (pane: EditorPaneId) => Promise<void>
  stopTabByPath: (path: string) => Promise<void>
  isTabRunning: (path: string) => boolean
  startCurrentServer: () => Promise<void>
  restartCurrentServer: () => Promise<void>
  stopServer: () => Promise<void>
  invokeOperation: (operationId: string) => Promise<unknown>
  runClientFile: (filePath?: string) => Promise<void>
  setClientTargetUrl: (url: string) => void
  setInvocationDraft: (operationId: string, draft: string) => void
  selectRequest: (requestId: string | null) => void
  clearRuntimeHistory: () => void
  clearClientRun: () => void
  fetchOperations: (url: string) => Promise<void>
  discoverServers: (serverName?: string) => Promise<void>
  switchTarget: (entry: ServerEntry) => Promise<void>
}

type RuntimeHandleEntry = { pane: EditorPaneId; handle: LocalRuntimeHandle }

/**
 * Module-level map of file path → runtime handle.
 * Stored on `window` so it survives Vite HMR module reloads — otherwise the map
 * is reset while the Zustand store (and the running server) remain alive.
 */
const runtimeHandles: Map<string, RuntimeHandleEntry> = (() => {
  const w = globalThis as Record<string, unknown>
  if (!(w.__browserver_runtimeHandles instanceof Map)) {
    w.__browserver_runtimeHandles = new Map<string, RuntimeHandleEntry>()
  }
  return w.__browserver_runtimeHandles as Map<string, RuntimeHandleEntry>
})()

/** Get the in-process server from the active runtime handle (for Browser view direct channels) */
export function getActiveRuntimeServer(): unknown | null {
  for (const [, entry] of runtimeHandles) {
    if (entry.handle.server) return entry.handle.server
  }
  return null
}

/**
 * Get the in-process server instance for a specific CSS connection URL.
 * Returns null if the server is not running in-process (e.g. it's a remote server).
 */
export function getRuntimeServerForConnectionUrl(connectionUrl: string): unknown | null {
  const normalizeCssAddress = (value: string | null | undefined): string | null => {
    if (!value || !value.startsWith('css://')) return null
    try {
      const parsed = new URL(value)
      const server = parsed.host || parsed.pathname.replace(/^\/+/, '')
      return server ? `css://${server}` : null
    } catch {
      return null
    }
  }

  const target = normalizeCssAddress(connectionUrl)
  if (!target) return null

  for (const [, entry] of runtimeHandles) {
    if (!entry.handle.server) continue
    const candidate = normalizeCssAddress(entry.handle.connectionUrl)
    if (candidate === target) {
      return entry.handle.server
    }
  }
  return null
}

/** Resolve an in-process server by serverName when connection URLs are temporarily out of sync. */
export function getRuntimeServerForServerName(serverName: string): unknown | null {
  if (!serverName.trim()) return null
  const target = serverName.trim()
  for (const [, entry] of runtimeHandles) {
    if (entry.handle.server && entry.handle.serverName === target) {
      return entry.handle.server
    }
  }
  return null
}

/** Active plat OpenAPI client for the current playground target (css:// or http(s)://). */
let playgroundClient: { baseUrl: string; client: OpenAPIClient } | null = null
const pendingServerRequests = new Map<string, Map<string, {
  operationId: string
  operationLabel?: string
  method: string
  path: string
  input: Record<string, unknown>
  startedAt: number
}>>()

function debugRuntime(event: string, detail?: unknown): void {
  if (detail === undefined) {
    console.debug(`[RuntimeStore] ${event}`)
    return
  }
  console.debug(`[RuntimeStore] ${event}`, detail)
}

let highlightTimer: number | null = null
const RECENT_CLIENT_TARGETS_KEY = 'browserver:recent-client-targets'

const EMPTY_TAB_SESSION: TabRuntimeSession = {
  mode: 'idle',
  language: null,
  status: 'idle',
  launchable: false,
  launchNote: null,
  launchedFilePath: null,
  launchedFileUpdatedAt: null,
  connectionUrl: null,
  serverName: null,
  errorMessage: null,
  lastClientStatus: 'idle',
}

function createEmptyTabSession(): TabRuntimeSession {
  return { ...EMPTY_TAB_SESSION }
}

function getPaneActivePath(pane: EditorPaneId): string | null {
  const paneTabs = useWorkspaceStore.getState().paneTabs[pane]
  return paneTabs.activePath ?? paneTabs.tabs[0] ?? null
}

function getTabSession(state: RuntimeState, path: string | null | undefined): TabRuntimeSession {
  if (!path) return EMPTY_TAB_SESSION
  return state.tabSessions[path] ?? EMPTY_TAB_SESSION
}

function logEntry(level: RuntimeLogEntry['level'], message: string, detail?: unknown): RuntimeLogEntry {
  return {
    id: crypto.randomUUID(),
    level,
    message,
    detail,
    at: Date.now(),
  }
}

function isSupportedClientTarget(url: string): boolean {
  return /^(https?:\/\/|wss?:\/\/|css:\/\/)/.test(url)
}

function loadRecentClientTargets(): string[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(RECENT_CLIENT_TARGETS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string' && isSupportedClientTarget(value)).slice(0, 8)
  } catch {
    return []
  }
}

function persistRecentClientTargets(targets: string[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(RECENT_CLIENT_TARGETS_KEY, JSON.stringify(targets.slice(0, 8)))
}

function getDefaultClientTarget(state: RuntimeState): string {
  if (state.clientTargetUrl.trim()) return state.clientTargetUrl.trim()
  if (state.connectionUrl) return state.connectionUrl
  if (state.serverName) return `css://${state.serverName}`
  return ''
}

function formatTimelineStage(entry: RuntimeRequestTimelineEntry): string {
  return `[${entry.stage}] ${entry.title}`
}

function normalizePlaygroundTarget(url: string): string {
  const trimmed = url.trim()
  if (trimmed.startsWith('css://')) {
    return normalizeCssTargetUrl(trimmed)
  }
  return normalizeClientApiBaseUrl(trimmed)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function fallbackOperationId(path: string): string {
  const segments = path.split('/').filter(Boolean)
  return segments[segments.length - 1] ?? (path.replace(/^\//, '') || 'request')
}

function resolveOperationSnapshot(
  operations: RuntimeOperation[],
  payload: Record<string, unknown>,
): {
  operationId: string
  operationLabel: string
  method: string
  path: string
} | null {
  const method = typeof payload.method === 'string' ? payload.method.toUpperCase() : null
  const path = typeof payload.path === 'string' ? payload.path : null
  const operationId = typeof payload.operationId === 'string' ? payload.operationId : null

  if (!method || !path) return null
  if (path === '/openapi.json' || path === '/tools') return null

  const matched = operations.find((operation) => (
    (operationId && operation.id === operationId)
      || (operation.method.toUpperCase() === method && operation.path === path)
  ))

  if (matched) {
    return {
      operationId: matched.id,
      operationLabel: matched.label,
      method: matched.method,
      path: matched.path,
    }
  }

  const fallbackId = operationId ?? fallbackOperationId(path)
  return {
    operationId: fallbackId,
    operationLabel: fallbackId,
    method,
    path,
  }
}

function recordRuntimeTelemetry(
  set: (partial: Partial<RuntimeState>) => void,
  get: () => RuntimeState,
  filePath: string,
  pane: EditorPaneId,
  direction: 'request' | 'response',
  payload: unknown,
) {
  const message = asRecord(payload)
  if (!message) return

  const requestId = message.id == null ? null : String(message.id)
  if (!requestId) return

  debugRuntime('telemetry.event', {
    direction,
    pane,
    filePath,
    requestId,
    method: typeof message.method === 'string' ? message.method : undefined,
    path: typeof message.path === 'string' ? message.path : undefined,
    ok: message.ok,
    hasError: Boolean(message.error),
    payload: message,
  })

  const pending = pendingServerRequests.get(filePath) ?? new Map<string, {
    operationId: string
    operationLabel?: string
    method: string
    path: string
    input: Record<string, unknown>
    startedAt: number
  }>()
  if (!pendingServerRequests.has(filePath)) pendingServerRequests.set(filePath, pending)

  if (direction === 'request') {
    const operation = resolveOperationSnapshot(get().operations, message)
    if (!operation) return

    const input = asRecord(message.input) ?? {}
    pending.set(requestId, {
      operationId: operation.operationId,
      operationLabel: operation.operationLabel,
      method: operation.method,
      path: operation.path,
      input,
      startedAt: Date.now(),
    })

    debugRuntime('telemetry.request.tracked', {
      pane,
      filePath,
      requestId,
      operationId: operation.operationId,
      operationLabel: operation.operationLabel,
      method: operation.method,
      path: operation.path,
      pendingCountForFile: pending.size,
    })

    setHighlightedHandler(set, operation.operationId)
    set({
      logs: [
        logEntry('event', `Incoming ${operation.operationLabel} in ${pane}:${filePath}`, input),
        ...get().logs,
      ].slice(0, 200),
    })
    return
  }

  const request = pending.get(requestId)
  if (!request) {
    debugRuntime('telemetry.response.unmatched', {
      pane,
      filePath,
      requestId,
      pendingIds: Array.from(pending.keys()),
      payload: message,
    })
    return
  }
  pending.delete(requestId)

  const endedAt = Date.now()
  const ok = message.ok !== false
  const errorRecord = asRecord(message.error)
  const errorMessage = typeof errorRecord?.message === 'string'
    ? errorRecord.message
    : 'Request failed'

  const entry: RuntimeRequestEntry = {
    id: crypto.randomUUID(),
    operationId: request.operationId,
    operationLabel: request.operationLabel,
    method: request.method,
    path: request.path,
    input: request.input,
    ok,
    result: ok ? message.result : undefined,
    error: ok
      ? undefined
      : {
          status: typeof errorRecord?.status === 'number' ? errorRecord.status : undefined,
          message: errorMessage,
        },
    events: [{ kind: 'response', payload }],
    startedAt: request.startedAt,
    endedAt,
    durationMs: endedAt - request.startedAt,
    timeline: [],
  }

  set({
    activeRequestId: entry.id,
    requests: [entry, ...get().requests].slice(0, 50),
    logs: [
      logEntry(ok ? 'info' : 'error', `${ok ? 'Completed' : 'Failed'} ${entry.operationLabel ?? entry.operationId}`, ok ? entry.result : entry.error),
      ...get().logs,
    ].slice(0, 200),
  })

  debugRuntime('telemetry.response.recorded', {
    pane,
    filePath,
    requestId,
    operationId: entry.operationId,
    operationLabel: entry.operationLabel,
    method: entry.method,
    path: entry.path,
    ok,
    durationMs: entry.durationMs,
    error: entry.error,
    pendingCountForFile: pending.size,
  })
}

function setHighlightedHandler(
  set: (partial: Partial<RuntimeState>) => void,
  handler: string | null,
) {
  if (highlightTimer) {
    window.clearTimeout(highlightTimer)
    highlightTimer = null
  }

  set({ highlightedHandler: handler })

  if (handler) {
    highlightTimer = window.setTimeout(() => {
      set({ highlightedHandler: null })
      highlightTimer = null
    }, 1800)
  }
}

function isRuntimeStale(state: RuntimeState): boolean {
  if (state.status !== 'running' || !state.launchedServerFilePath || state.launchedServerUpdatedAt == null) {
    return false
  }

  const workspace = useWorkspaceStore.getState()
  const currentServerFile = workspace.files.find((file) => file.path === state.launchedServerFilePath)

  return Boolean(currentServerFile && currentServerFile.updatedAt > state.launchedServerUpdatedAt)
}

export function selectRuntimeIsStale(state: RuntimeState): boolean {
  return isRuntimeStale(state)
}

export function selectLocalServers(state: RuntimeState): ServerEntry[] {
  return Object.entries(state.tabSessions)
    .filter(([, session]) => session.mode === 'server' && (session.status === 'running' || session.status === 'starting'))
    .map(([filePath, session]) => ({
      id: `local:${filePath}`,
      source: 'local' as const,
      serverName: session.serverName ?? filePath.split('/').pop() ?? 'unknown',
      connectionUrl: session.connectionUrl,
      status: session.status === 'running' ? 'running' as const : 'unknown' as const,
      filePath,
    }))
}

export function selectAllServers(state: RuntimeState): ServerEntry[] {
  const local = selectLocalServers(state)
  const localNames = new Set(local.map((s) => s.serverName))

  const discovered: ServerEntry[] = state.discoveredServers
    .filter((d) => !localNames.has(d.serverName))
    .map((d) => ({
      id: `discovered:${d.instanceId}`,
      source: 'discovered' as const,
      serverName: d.serverName,
      connectionUrl: `css://${d.serverName}`,
      status: 'unknown' as const,
      instanceInfo: d.instanceInfo,
      workerInfo: d.workerInfo,
      mqttChallengeVerified: d.mqttChallengeVerified,
    }))

  return [...local, ...discovered]
}

export function selectTabRuntimeSession(path: string | null | undefined) {
  return (state: RuntimeState) => getTabSession(state, path)
}

function syncVisibleRuntimeFromPane(
  set: (partial: Partial<RuntimeState>) => void,
  get: () => RuntimeState,
  pane: EditorPaneId,
) {
  const activePath = getPaneActivePath(pane)
  const session = getTabSession(get(), activePath)
  set({
    activeRuntimePane: pane,
    language: session.language,
    status: session.status,
    launchable: session.launchable,
    launchNote: session.launchNote,
    launchedServerFilePath: session.launchedFilePath,
    launchedServerUpdatedAt: session.launchedFileUpdatedAt,
    connectionUrl: session.connectionUrl,
    serverName: session.serverName,
    errorMessage: session.errorMessage,
  })
}

function updateTabSession(
  set: (partial: Partial<RuntimeState>) => void,
  get: () => RuntimeState,
  filePath: string,
  patch: Partial<TabRuntimeSession>,
) {
  const next = {
    ...getTabSession(get(), filePath),
    ...patch,
  }

  set({
    tabSessions: {
      ...get().tabSessions,
      [filePath]: next,
    },
  })

  const workspace = useWorkspaceStore.getState()
  for (const pane of ['primary', 'secondary', 'tertiary'] as EditorPaneId[]) {
    const panePath = workspace.paneTabs[pane].activePath ?? workspace.paneTabs[pane].tabs[0] ?? null
    if (panePath === filePath || (pane === get().activeRuntimePane && panePath)) {
      syncVisibleRuntimeFromPane(set, get, pane)
    }
  }
}

function normalizeLegacyPlatClientImports(source: string): string {
  return source
    .replaceAll('@modularizer/plat/client-server', '@modularizer/plat-client/client-server')
    .replace(/@modularizer\/plat\/client(?!-)/g, '@modularizer/plat-client')
}

export const useRuntimeStore = create<RuntimeState>()((set, get) => ({
  activeRuntimePane: 'primary',
  tabSessions: {},
  language: null,
  status: 'idle',
  launchable: false,
  launchNote: null,
  launchedServerFilePath: null,
  launchedServerUpdatedAt: null,
  connectionUrl: null,
  serverName: null,
  diagnostics: [],
  compiledCode: '',
  analysisSummary: [],
  openapiDocument: null,
  operations: [],
  invocationDrafts: {},
  logs: [],
  requests: [],
  highlightedHandler: null,
  activeRequestId: null,
  clientRun: null,
  clientTargetUrl: '',
  recentClientTargets: loadRecentClientTargets(),
  errorMessage: null,
  discoveredServers: [],
  discoveryStatus: 'idle',
  discoveryError: null,
  lastDiscoveryAt: null,
  focusPaneRuntime: (pane) => {
    syncVisibleRuntimeFromPane(set, get, pane)
  },
  runPane: async (pane) => {
    const workspace = useWorkspaceStore.getState()
    const filePath = workspace.paneTabs[pane].activePath ?? workspace.paneTabs[pane].tabs[0] ?? null
    const targetFile = filePath ? workspace.files.find((file) => file.path === filePath) ?? null : null

    if (!targetFile) {
      if (filePath) {
        updateTabSession(set, get, filePath, {
          mode: 'idle',
          status: 'error',
          errorMessage: 'No file is open in this pane',
        })
      }
      set({
        status: 'error',
        errorMessage: 'No file is open in this pane',
      })
      syncVisibleRuntimeFromPane(set, get, pane)
      return
    }

    syncVisibleRuntimeFromPane(set, get, pane)

    if (targetFile.name.startsWith('server')) {
      updateTabSession(set, get, targetFile.path, {
        mode: 'server',
        language: workspace.sample.serverLanguage,
        status: 'starting',
        launchable: false,
        launchNote: null,
        launchedFilePath: null,
        launchedFileUpdatedAt: null,
        connectionUrl: null,
        serverName: null,
        errorMessage: null,
      })
      set({
        logs: [
          logEntry('info', `Starting ${workspace.sample.name} in ${pane}`),
          ...get().logs,
        ],
      })

      try {
        const existingHandle = runtimeHandles.get(targetFile.path)
        if (existingHandle) {
          await existingHandle.handle.stop()
          runtimeHandles.delete(targetFile.path)
        }

        const handle = workspace.sample.serverLanguage === 'typescript'
          ? await startLocalTsRuntime({
              source: normalizeLegacyPlatClientImports(targetFile.content),
              serverName: `${workspace.sample.id}-${pane}-${targetFile.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
              workspaceFiles: workspace.files.map(f => ({ path: f.path, content: f.content })),
              onRequest: (direction, payload) => {
                recordRuntimeTelemetry(set, get, targetFile.path, pane, direction, payload)
              },
            })
          : await startPythonRuntime({
              source: targetFile.content,
              serverName: `${workspace.sample.id}-${pane}-${targetFile.name.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
            })
        runtimeHandles.set(targetFile.path, { pane, handle })
        playgroundClient = null

        updateTabSession(set, get, targetFile.path, {
          mode: 'server',
          language: handle.language,
          status: 'running',
          launchable: handle.launchable,
          launchNote: handle.launchNote ?? null,
          launchedFilePath: targetFile.path,
          launchedFileUpdatedAt: targetFile.updatedAt,
          connectionUrl: handle.connectionUrl,
          serverName: handle.serverName,
          errorMessage: null,
        })

        set({
          activeRuntimePane: pane,
          language: handle.language,
          status: 'running',
          launchable: handle.launchable,
          launchNote: handle.launchNote ?? null,
          launchedServerFilePath: targetFile.path,
          launchedServerUpdatedAt: targetFile.updatedAt,
          connectionUrl: handle.connectionUrl,
          serverName: handle.serverName,
          logs: [
            logEntry(
              'info',
              handle.launchable
                ? `Runtime ready in ${pane} at ${handle.connectionUrl}`
                : `${handle.language} runtime scaffolded in ${pane}`,
              handle.launchNote,
            ),
            ...get().logs,
          ],
        })
      } catch (error) {
        console.error('Runtime startup error details:', error)
        console.error('Error type:', typeof error)
        console.error('Error constructor:', error?.constructor?.name)
        console.error('Error message:', (error as any)?.message)
        console.error('Error stack:', (error as any)?.stack)
        runtimeHandles.delete(targetFile.path)
        updateTabSession(set, get, targetFile.path, {
          mode: 'server',
          language: workspace.sample.serverLanguage,
          status: 'error',
          launchable: false,
          launchNote: null,
          launchedFilePath: null,
          launchedFileUpdatedAt: null,
          connectionUrl: null,
          serverName: null,
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        set({
          activeRuntimePane: pane,
          language: workspace.sample.serverLanguage,
          status: 'error',
          launchable: false,
          launchNote: null,
          launchedServerFilePath: null,
          launchedServerUpdatedAt: null,
          connectionUrl: null,
          serverName: null,
          diagnostics: [],
          compiledCode: '',
          analysisSummary: [],
          openapiDocument: null,
          operations: [],
          invocationDrafts: {},
          logs: [
            logEntry('error', `Runtime failed to start in ${pane}`, error instanceof Error ? error.message : String(error)),
            ...get().logs,
          ],
        })
      }
      return
    }

    const availableHandle = runtimeHandles.get(targetFile.path)?.handle
      ?? Array.from(runtimeHandles.values())[0]?.handle

    if (!availableHandle) {
      updateTabSession(set, get, targetFile.path, {
        mode: 'client',
        status: 'error',
        errorMessage: 'Start a server pane before running a client pane',
        lastClientStatus: 'error',
      })
      set({
        logs: [
          logEntry('error', `No running server is available for client execution in ${pane}`),
          ...get().logs,
        ],
      })
      return
    }

    updateTabSession(set, get, targetFile.path, {
      mode: 'client',
      status: 'starting',
      errorMessage: null,
      lastClientStatus: 'running',
    })
    set({
      activeRuntimePane: pane,
        clientRun: {
          id: crypto.randomUUID(),
          filePath: targetFile.path,
          targetUrl: getDefaultClientTarget(get()),
          status: 'running',
          logs: [],
          startedAt: Date.now(),
      },
      logs: [
        logEntry('info', `Running ${targetFile.name} in ${pane}`),
        ...get().logs,
      ],
    })

    try {
      const startedAt = Date.now()
      const targetUrl = getDefaultClientTarget(get())
      const result = await runClientSource({
        source: targetFile.content,
        targetUrl,
      })
      const endedAt = Date.now()
      const nextRecentClientTargets = [targetUrl, ...get().recentClientTargets.filter((entry) => entry !== targetUrl)].slice(0, 8)
      persistRecentClientTargets(nextRecentClientTargets)
      updateTabSession(set, get, targetFile.path, {
        mode: 'client',
        status: 'idle',
        errorMessage: null,
        lastClientStatus: 'success',
      })
      set({
        activeRuntimePane: pane,
        clientRun: {
          id: crypto.randomUUID(),
          filePath: targetFile.path,
          targetUrl,
          status: 'success',
          logs: result.logs,
          result: result.result,
          startedAt,
          endedAt,
          durationMs: endedAt - startedAt,
        },
        logs: [
          logEntry('info', `Client run completed in ${pane}`, result.result),
          ...result.logs.map((line) => logEntry('event', `[client:${pane}] ${line}`)),
          ...get().logs,
        ].slice(0, 200),
        recentClientTargets: nextRecentClientTargets,
      })
    } catch (error) {
      updateTabSession(set, get, targetFile.path, {
        mode: 'client',
        status: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        lastClientStatus: 'error',
      })
      set({
        activeRuntimePane: pane,
        clientRun: {
          id: crypto.randomUUID(),
          filePath: targetFile.path,
          targetUrl: getDefaultClientTarget(get()),
          status: 'error',
          logs: [],
          error: error instanceof Error ? error.message : String(error),
          startedAt: Date.now(),
        },
        logs: [
          logEntry('error', `Client run failed in ${pane}`, error instanceof Error ? error.message : error),
          ...get().logs,
        ],
      })
    }
  },
  stopPane: async (pane) => {
    const path = getPaneActivePath(pane)
    if (!path) return
    await get().stopTabByPath(path)

    if (get().activeRuntimePane === pane) {
      syncVisibleRuntimeFromPane(set, get, pane)
    }

    set({
      logs: [
        logEntry('info', `Stopped pane runtime in ${pane}`),
        ...get().logs,
      ],
    })
  },
  stopTabByPath: async (path) => {
    const binding = runtimeHandles.get(path)
    if (binding) {
      await binding.handle.stop()
      runtimeHandles.delete(path)
    }
    pendingServerRequests.get(path)?.clear()
    pendingServerRequests.delete(path)
    updateTabSession(set, get, path, createEmptyTabSession())
  },
  isTabRunning: (path) => {
    const session = get().tabSessions[path]
    if (!session) return false
    if (session.mode !== 'server') return false
    return session.status === 'running' || session.status === 'starting'
  },
  startCurrentServer: async () => {
    await get().runPane(useWorkspaceStore.getState().activeEditorPane)
  },
  restartCurrentServer: async () => {
    const pane = useWorkspaceStore.getState().activeEditorPane
    await get().stopPane(pane)
    await get().runPane(pane)
  },
  stopServer: async () => {
    await get().stopPane(useWorkspaceStore.getState().activeEditorPane)
  },
  invokeOperation: async (operationId: string) => {
    const operation = get().operations.find((entry) => entry.id === operationId)
    if (!operation) return

    const draft = get().invocationDrafts[operationId] ?? '{}'
    let input: Record<string, unknown>

    try {
      const parsed = JSON.parse(draft) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Invocation input must be a JSON object')
      }
      input = parsed as Record<string, unknown>
    } catch {
      throw new Error('Invocation input must be a JSON object')
    }

    const targetUrl = get().clientTargetUrl || get().connectionUrl

    if (!targetUrl) {
      throw new Error('No target URL for invocation')
    }
    try {
      const trimmedTarget = targetUrl.trim()

      const normalizedTarget = normalizePlaygroundTarget(trimmedTarget)
      if (!playgroundClient || normalizePlaygroundTarget(playgroundClient.baseUrl) !== normalizedTarget) {
        await get().fetchOperations(trimmedTarget)
      }
      const client = playgroundClient?.client
      if (!client) {
        throw new Error('No connection for this target — use Connect or start a local server')
      }
      return await invokeOpenApiClientOperation(client, operation, input)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(errorMessage)
    }
  },
  runClientFile: async (filePath) => {
    const workspace = useWorkspaceStore.getState()
    const targetUrl = getDefaultClientTarget(get())
    const targetFile = filePath
      ? workspace.files.find((file) => file.path === filePath)
      : workspace.files.find((file) => file.path === workspace.activeFilePath)
        ?? workspace.files.find((file) => file.name.startsWith('client'))

    if (!targetUrl) {
      set({
        logs: [
          logEntry('error', 'Enter a client target URL first'),
          ...get().logs,
        ],
      })
      return
    }

    if (!isSupportedClientTarget(targetUrl)) {
      set({
        logs: [
          logEntry('error', `Unsupported client target URL: ${targetUrl}`),
          ...get().logs,
        ],
      })
      return
    }

    if (!targetFile) {
      set({
        logs: [
          logEntry('error', 'No client file is available in the current workspace'),
          ...get().logs,
        ],
      })
      return
    }

    if (targetFile.language !== 'typescript') {
      set({
        logs: [
          logEntry('error', `Client playground only supports TypeScript files right now: ${targetFile.name}`),
          ...get().logs,
        ],
      })
      return
    }

    await get().runPane(useWorkspaceStore.getState().activeEditorPane)
  },
  setClientTargetUrl: (url) => set({ clientTargetUrl: url }),
  setInvocationDraft: (operationId, draft) => {
    set({
      invocationDrafts: {
        ...get().invocationDrafts,
        [operationId]: draft,
      },
    })
  },
  selectRequest: (requestId) => {
    const request = requestId ? get().requests.find((entry) => entry.id === requestId) ?? null : null
    set({ activeRequestId: requestId })
    setHighlightedHandler(set, request?.operationId ?? null)
  },
  clearRuntimeHistory: () => set({ logs: [], requests: [], activeRequestId: null }),
  clearClientRun: () => set({ clientRun: null }),
  fetchOperations: async (url: string) => {
    if (!url) return

    const trimmed = url.trim()
    playgroundClient = null

    if (trimmed.startsWith('css://')) {
      try {
        const { client, openapi } = await connectClientSideServer({ baseUrl: trimmed })
        playgroundClient = { baseUrl: normalizeCssTargetUrl(trimmed), client }
        const spec = openapi as Record<string, any>
        const operations = extractOperationsFromOpenApi(spec)
        const invocationDrafts = Object.fromEntries(
          operations.map((operation) => [operation.id, get().invocationDrafts[operation.id] ?? '{}'] as const),
        )
        set({
          openapiDocument: spec as Record<string, unknown>,
          operations,
          invocationDrafts,
        })
        return
      } catch (error) {
        throw new Error(
          error instanceof Error ? error.message : 'Failed to connect to client-side server (css://)',
        )
      }
    }

    const base = normalizeClientApiBaseUrl(trimmed)

    const openapiUrls = [`${base}/openapi.json`, `${base}/openapi.yaml`, `${base}/openapi`]

    for (const openapiUrl of openapiUrls) {
      try {
        const response = await fetch(openapiUrl)
        if (!response.ok) continue
        const openapi = await response.json()
        playgroundClient = { baseUrl: base, client: new OpenAPIClient(openapi, { baseUrl: base }) }
        const operations = extractOperationsFromOpenApi(openapi)
        const invocationDrafts = Object.fromEntries(
          operations.map((operation) => [operation.id, get().invocationDrafts[operation.id] ?? '{}'] as const),
        )
        set({
          openapiDocument: openapi,
          operations,
          invocationDrafts,
        })
        return
      } catch {
        continue
      }
    }


    throw new Error(`Failed to fetch OpenAPI from ${trimmed}`)
  },
  discoverServers: async (serverName) => {
    set({ discoveryStatus: 'discovering', discoveryError: null })
    try {
      const name = serverName ?? get().serverName ?? ''
      if (!name) {
        set({ discoveryStatus: 'error', discoveryError: 'No server name to discover' })
        return
      }
      const { discoverClientSideServers } = await import('@modularizer/plat-client/client-server')
      const result = await discoverClientSideServers(name, {
        workerPool: { discoveryTimeoutMs: 3000 },
      })
      set({
        discoveredServers: result.candidates.map((c) => ({
          instanceId: c.instanceId,
          serverName: c.serverName,
          workerInfo: c.workerInfo ?? {},
          instanceInfo: c.instanceInfo,
          mqttChallengeVerified: c.mqttChallengeVerified ?? false,
          discoveredAt: result.discoveredAt ?? Date.now(),
        })),
        discoveryStatus: 'idle',
        lastDiscoveryAt: Date.now(),
      })
    } catch (error) {
      set({
        discoveryStatus: 'error',
        discoveryError: error instanceof Error ? error.message : String(error),
      })
    }
  },
  switchTarget: async (entry) => {
    const url = entry.connectionUrl ?? `css://${entry.serverName}`
    set({ clientTargetUrl: url })
    const next = [url, ...get().recentClientTargets.filter((t) => t !== url)].slice(0, 8)
    persistRecentClientTargets(next)
    set({ recentClientTargets: next })
    try {
      await get().fetchOperations(url)
    } catch { /* fetchOperations logs its own errors */ }
  },
}))
