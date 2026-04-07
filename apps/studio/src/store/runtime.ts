import { create } from 'zustand'
import { connectClientSideServer } from '@modularizer/plat-client/client-server'
import type { OpenAPIClient } from '@modularizer/plat-client/client-server'
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

export interface PaneRuntimeSession {
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
  paneSessions: Record<EditorPaneId, PaneRuntimeSession>
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
  focusPaneRuntime: (pane: EditorPaneId) => void
  runPane: (pane: EditorPaneId) => Promise<void>
  stopPane: (pane: EditorPaneId) => Promise<void>
  startCurrentServer: () => Promise<void>
  restartCurrentServer: () => Promise<void>
  stopServer: () => Promise<void>
  invokeOperation: (operationId: string) => Promise<void>
  runClientFile: (filePath?: string) => Promise<void>
  setClientTargetUrl: (url: string) => void
  setInvocationDraft: (operationId: string, draft: string) => void
  selectRequest: (requestId: string | null) => void
  clearRuntimeHistory: () => void
  clearClientRun: () => void
  fetchOperations: (url: string) => Promise<void>
}

const runtimeHandles: Partial<Record<EditorPaneId, LocalRuntimeHandle | null>> = {
  primary: null,
  secondary: null,
  tertiary: null,
}

/** Active plat CSS (MQTT/WebRTC) client for the playground target; not used for HTTP APIs. */
let cssPlaygroundClient: { baseUrl: string; client: OpenAPIClient } | null = null

let highlightTimer: number | null = null
const RECENT_CLIENT_TARGETS_KEY = 'browserver:recent-client-targets'

function createEmptyPaneSession(): PaneRuntimeSession {
  return {
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

export function selectPaneRuntimeSession(pane: EditorPaneId) {
  return (state: RuntimeState) => state.paneSessions[pane]
}

function syncVisibleRuntimeFromPane(
  set: (partial: Partial<RuntimeState>) => void,
  get: () => RuntimeState,
  pane: EditorPaneId,
) {
  const session = get().paneSessions[pane]
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

function updatePaneSession(
  set: (partial: Partial<RuntimeState>) => void,
  get: () => RuntimeState,
  pane: EditorPaneId,
  patch: Partial<PaneRuntimeSession>,
) {
  const next = {
    ...get().paneSessions[pane],
    ...patch,
  }

  set({
    paneSessions: {
      ...get().paneSessions,
      [pane]: next,
    },
  })

  if (get().activeRuntimePane === pane) {
    syncVisibleRuntimeFromPane(set, get, pane)
  }
}

function findRuntimeHandleForTarget(targetUrl: string): LocalRuntimeHandle | null {
  const normalized = targetUrl.trim()
  const panes: EditorPaneId[] = ['primary', 'secondary', 'tertiary']
  for (const pane of panes) {
    const handle = runtimeHandles[pane]
    if (!handle) continue
    if (normalized === handle.connectionUrl || normalized === `css://${handle.serverName}`) {
      return handle
    }
  }
  return null
}

export const useRuntimeStore = create<RuntimeState>()((set, get) => ({
  activeRuntimePane: 'primary',
  paneSessions: {
    primary: createEmptyPaneSession(),
    secondary: createEmptyPaneSession(),
    tertiary: createEmptyPaneSession(),
  },
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
  focusPaneRuntime: (pane) => {
    syncVisibleRuntimeFromPane(set, get, pane)
  },
  runPane: async (pane) => {
    const workspace = useWorkspaceStore.getState()
    const filePath = workspace.paneTabs[pane].activePath ?? workspace.paneTabs[pane].tabs[0] ?? null
    const targetFile = filePath ? workspace.files.find((file) => file.path === filePath) ?? null : null

    if (!targetFile) {
      updatePaneSession(set, get, pane, {
        mode: 'idle',
        status: 'error',
        errorMessage: 'No file is open in this pane',
      })
      syncVisibleRuntimeFromPane(set, get, pane)
      return
    }

    syncVisibleRuntimeFromPane(set, get, pane)

    if (targetFile.name.startsWith('server')) {
      updatePaneSession(set, get, pane, {
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
        if (runtimeHandles[pane]) {
          await runtimeHandles[pane]?.stop()
          runtimeHandles[pane] = null
        }

        const handle = workspace.sample.serverLanguage === 'typescript'
          ? await startLocalTsRuntime({
              source: targetFile.content,
              serverName: `${workspace.sample.id}-${pane}`,
            })
          : await startPythonRuntime({
              source: targetFile.content,
              serverName: `${workspace.sample.id}-${pane}`,
            })
        runtimeHandles[pane] = handle
        cssPlaygroundClient = null

        updatePaneSession(set, get, pane, {
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
        runtimeHandles[pane] = null
        updatePaneSession(set, get, pane, {
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

    const availableHandle = runtimeHandles[pane]
      ?? runtimeHandles.primary
      ?? runtimeHandles.secondary
      ?? runtimeHandles.tertiary

    if (!availableHandle) {
      updatePaneSession(set, get, pane, {
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

    updatePaneSession(set, get, pane, {
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
      updatePaneSession(set, get, pane, {
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
      updatePaneSession(set, get, pane, {
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
    if (runtimeHandles[pane]) {
      await runtimeHandles[pane]?.stop()
      runtimeHandles[pane] = null
    }

    updatePaneSession(set, get, pane, createEmptyPaneSession())
    if (get().activeRuntimePane === pane) {
      set({
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
        errorMessage: null,
      })
    }

    set({
      logs: [
        logEntry('info', `Stopped pane runtime in ${pane}`),
        ...get().logs,
      ],
    })
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
    } catch (error) {
      set({
        logs: [
          logEntry('error', `Invalid JSON for ${operationId}`, error instanceof Error ? error.message : error),
          ...get().logs,
        ],
      })
      return
    }

    const startedAt = Date.now()
    const targetUrl = get().clientTargetUrl || get().connectionUrl

    if (!targetUrl) {
      set({ logs: [logEntry('error', 'No target URL for invocation'), ...get().logs] })
      return
    }

    set({
      activeRequestId: null,
      logs: [
        logEntry('info', `Invoking ${operation.label} at ${targetUrl}`, input),
        ...get().logs,
      ],
    })
    setHighlightedHandler(set, operation.id)

    try {
      const trimmedTarget = targetUrl.trim()

      if (trimmedTarget.startsWith('css://')) {
        if (
          !cssPlaygroundClient
          || normalizeCssTargetUrl(cssPlaygroundClient.baseUrl) !== normalizeCssTargetUrl(trimmedTarget)
        ) {
          await get().fetchOperations(trimmedTarget)
        }
        const cssClient = cssPlaygroundClient?.client
        if (cssClient) {
          const data = await invokeOpenApiClientOperation(cssClient, operation, input)
          const endedAt = Date.now()
          const entry: RuntimeRequestEntry = {
            id: crypto.randomUUID(),
            operationId,
            operationLabel: operation.label,
            method: operation.method,
            path: operation.path,
            input,
            ok: true,
            result: data,
            events: [],
            startedAt,
            endedAt,
            durationMs: endedAt - startedAt,
            timeline: [],
          }
          set({
            activeRequestId: entry.id,
            requests: [entry, ...get().requests].slice(0, 50),
            logs: [
              logEntry('info', `Completed ${entry.operationLabel ?? entry.operationId}`, entry.result),
              ...get().logs,
            ].slice(0, 200),
          })
          return
        }
      }

      let base = normalizeClientApiBaseUrl(trimmedTarget)
      if (base.startsWith('css://')) {
        throw new Error('No connection for this target — use Connect or start a local server')
      }

      const url = new URL(operation.path, `${base}/`)
      const response = await fetch(url.toString(), {
        method: operation.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const result = await response.json()
      const endedAt = Date.now()
      const entry: RuntimeRequestEntry = {
        id: crypto.randomUUID(),
        operationId,
        operationLabel: operation.label,
        method: operation.method,
        path: operation.path,
        input,
        ok: response.ok,
        result: response.ok ? result : undefined,
        error: !response.ok ? { status: response.status, message: result.error || response.statusText } : undefined,
        events: [],
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        timeline: [],
      }
      set({
        activeRequestId: entry.id,
        requests: [entry, ...get().requests].slice(0, 50),
        logs: [
          logEntry(entry.ok ? 'info' : 'error', `${entry.ok ? 'Completed' : 'Failed'} ${entry.operationLabel ?? entry.operationId}`, entry.ok ? entry.result : entry.error),
          ...get().logs,
        ].slice(0, 200),
      })
    } catch (error) {
      const endedAt = Date.now()
      const errorMessage = error instanceof Error ? error.message : String(error)
      const entry: RuntimeRequestEntry = {
        id: crypto.randomUUID(),
        operationId,
        operationLabel: operation.label,
        method: operation.method,
        path: operation.path,
        input,
        ok: false,
        result: undefined,
        error: { message: errorMessage },
        events: [],
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        timeline: [],
      }
      set({
        activeRequestId: entry.id,
        requests: [entry, ...get().requests].slice(0, 50),
        logs: [
          logEntry('error', `Invocation failed for ${operationId}`, errorMessage),
          ...get().logs,
        ],
      })
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
    cssPlaygroundClient = null

    if (trimmed.startsWith('css://')) {
      try {
        const { client, openapi } = await connectClientSideServer({ baseUrl: trimmed })
        cssPlaygroundClient = { baseUrl: normalizeCssTargetUrl(trimmed), client }
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

    let base = normalizeClientApiBaseUrl(trimmed)

    const openapiUrls = [`${base}/openapi.json`, `${base}/openapi.yaml`, `${base}/openapi`]

    for (const openapiUrl of openapiUrls) {
      try {
        const response = await fetch(openapiUrl)
        if (!response.ok) continue
        const openapi = await response.json()
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
}))
