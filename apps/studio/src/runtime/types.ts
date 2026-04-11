export interface RuntimeOperation {
  id: string
  /** Display name without HTTP verb/path noise (e.g. `add` instead of `POST /add`). */
  label: string
  method: string
  path: string
  summary?: string
  inputSchema?: Record<string, unknown>
}

export interface RuntimeDiagnostic {
  category: 'error' | 'warning' | 'message'
  code: number
  message: string
  line?: number
  column?: number
}

export interface RuntimeInvocationEvent {
  kind: 'event' | 'response'
  payload: unknown
}

export interface RuntimeRequestTimelineEntry {
  id: string
  at: number
  stage: 'invoke' | 'event' | 'response' | 'result' | 'error'
  title: string
  detail?: unknown
}

export interface RuntimeInvocationResult {
  requestId: string
  operationId: string
  method: string
  path: string
  input: Record<string, unknown>
  ok: boolean
  result?: unknown
  error?: { status?: number; message: string }
  events: RuntimeInvocationEvent[]
  timeline: RuntimeRequestTimelineEntry[]
}

export interface RuntimeAnalysisSummary {
  controller: string
  methods: string[]
}

export interface LocalRuntimeHandle {
  language: 'typescript' | 'python'
  launchable: boolean
  launchNote?: string
  serverName: string
  connectionUrl: string | null
  stop: () => Promise<void>
  /** The in-process server instance (for direct channel creation, e.g. Browser view) */
  server?: unknown
}
