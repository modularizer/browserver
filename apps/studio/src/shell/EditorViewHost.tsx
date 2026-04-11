import { useEffect, useMemo, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import SwaggerUI from 'swagger-ui-react'
import 'swagger-ui-react/swagger-ui.css'
import { RedocStandalone } from 'redoc'
import {
  createClientSideServerMQTTWebRTCPeerPool,
  createPlatFetch,
  generateBridgeScript,
  parseClientSideServerAddress,
} from '@modularizer/plat-client/client-server'
import type { ClientSideServerChannel } from '@modularizer/plat-client/client-server'
import type { DatabaseSnapshot } from '@browserver/database'
import type { WorkspaceSnapshot } from '@browserver/storage'
import type { ProjectBundle } from '../config/projectBundle'
import { ClientTargetField } from './ClientTargetField'
import { ServersSection } from './ServersSection'
import { TsConsoleView, PythonConsoleView, CliEmulatorView } from './ApiConsoleViews'
import { HistoryPanel } from './HistoryPanel'
import { TrustPanel } from './TrustPanel'
import { useCheckpointStore } from '../store/checkpoints'
import { useDatabaseStore } from '../store/database'
import { useLayoutStore } from '../store/layout'
import {
  useRuntimeStore,
  getRuntimeServerForConnectionUrl,
  getRuntimeServerForServerName,
} from '../store/runtime'
import { createInProcessChannel } from '../runtime/inProcessChannel'
import { useThemeStore } from '../theme'
import {
  getEditorViewId,
  useWorkspaceStore,
} from '../store/workspace'
import { useTrustStore } from '../store/trust'
import type { RuntimeOperation } from '../runtime/types'

interface EditorViewHostProps {
  path: string
}

export function EditorViewHost({ path }: EditorViewHostProps) {
  const viewId = getEditorViewId(path)

  if (viewId === 'inspect') return <InspectView />
  if (viewId === 'api' || viewId === 'client' || viewId === 'swagger' || viewId === 'redoc') return <ApiView />
  if (viewId === 'data') return <DataView />
  if (viewId === 'trust') return <TrustPanel />
  if (viewId === 'history') return <HistoryView />
  if (viewId === 'logs') return <LogsView />
  if (viewId === 'calls') return <CallsView />
  if (viewId === 'build') return <BuildView />
  if (viewId === 'problems') return <ProblemsView />
  if (viewId === 'browser') return <BrowserView />

  return (
    <div className="flex h-full items-center justify-center text-sm text-bs-text-faint">
      Unknown editor surface
    </div>
  )
}

function InspectView() {
  const sample = useWorkspaceStore((state) => state.sample)
  const files = useWorkspaceStore((state) => state.files)
  const dirtyFilePaths = useWorkspaceStore((state) => state.dirtyFilePaths)
  const saveState = useWorkspaceStore((state) => state.saveState)
  const activeFilePath = useWorkspaceStore((state) => state.activeFilePath)
  const runtimeLanguage = useRuntimeStore((state) => state.language)
  const runtimeStatus = useRuntimeStore((state) => state.status)
  const launchable = useRuntimeStore((state) => state.launchable)
  const launchNote = useRuntimeStore((state) => state.launchNote)
  const connectionUrl = useRuntimeStore((state) => state.connectionUrl)
  const diagnostics = useRuntimeStore((state) => state.diagnostics)
  const analysisSummary = useRuntimeStore((state) => state.analysisSummary)
  const requests = useRuntimeStore((state) => state.requests)
  const activeRequestId = useRuntimeStore((state) => state.activeRequestId)
  const selectRequest = useRuntimeStore((state) => state.selectRequest)
  const tables = useDatabaseStore((state) => state.tables)
  const activeTableName = useDatabaseStore((state) => state.activeTableName)
  const databaseSaveState = useDatabaseStore((state) => state.saveState)
  const activeRequest = requests.find((request) => request.id === activeRequestId) ?? null
  const activeFile = files.find((file) => file.path === activeFilePath) ?? null
  const activeTable = tables.find((table) => table.name === activeTableName) ?? tables[0] ?? null

  return (
    <div className="h-full overflow-auto bg-bs-bg-panel p-3 text-[11px]">
      <div className="grid gap-4 xl:grid-cols-2">
        <InspectSection title="Runtime">
          <div className="text-bs-text">{runtimeLanguage ?? sample.serverLanguage}</div>
          <div className="text-bs-text">{runtimeStatus}</div>
          <div className="text-bs-text-muted">{launchable ? 'launchable' : 'blocked'}</div>
          <div className="text-bs-text-muted">{connectionUrl ?? 'not running'}</div>
          <div className="text-bs-text-muted">{diagnostics.length} compile diagnostics</div>
          {launchNote ? <div className="text-bs-text-muted">{launchNote}</div> : null}
        </InspectSection>

        <InspectSection title="Workspace">
          <div className="text-bs-text">{sample.name}</div>
          <div className="text-bs-text-muted">{files.length} tracked files</div>
          <div className="text-bs-text-muted">{dirtyFilePaths.length} dirty files</div>
          <div className="text-bs-text-muted">storage: {saveState}</div>
        </InspectSection>

        <InspectSection title="Active File">
          <div className="text-bs-text">{activeFile?.name ?? 'No file selected'}</div>
          <div className="text-bs-text-muted">{activeFile?.language ?? 'n/a'}</div>
          <div className="text-bs-text-muted">{dirtyFilePaths.includes(activeFile?.path ?? '') ? 'Modified' : 'Saved'}</div>
        </InspectSection>

        <InspectSection title="Database">
          <div className="text-bs-text-muted">{tables.length} local table(s)</div>
          <div className="text-bs-text-muted">storage: {databaseSaveState}</div>
          {activeTable ? (
            <div className="mt-2 rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
              <div className="text-bs-text">{activeTable.name}</div>
              <div className="text-bs-text-faint">{activeTable.rows.length} rows</div>
              <div className="mt-1 text-bs-text-muted">
                {activeTable.columns.map((column) => `${column.name}:${column.type}`).join(', ')}
              </div>
            </div>
          ) : null}
        </InspectSection>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <InspectSection title="Source Analysis">
          {analysisSummary.length > 0 ? (
            <div className="flex flex-col gap-1">
              {analysisSummary.map((controller) => (
                <div key={controller.controller} className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-1">
                  <div className="text-bs-text">{controller.controller}</div>
                  <div className="text-bs-text-muted">{controller.methods.join(', ') || 'no exposed methods'}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-bs-text-muted">launch the runtime to inspect controllers</div>
          )}
        </InspectSection>

        <InspectSection title="Selected Request">
          {activeRequest ? (
            <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
              <div className="flex items-center gap-2">
                <span className={activeRequest.ok ? 'text-bs-good' : 'text-bs-error'}>
                  {activeRequest.ok ? 'ok' : 'error'}
                </span>
                <span className="text-bs-text">{activeRequest.operationLabel ?? activeRequest.operationId}</span>
                <span className="text-bs-text-faint">{activeRequest.durationMs}ms</span>
              </div>
              <div className="mt-2 text-bs-text-faint">input</div>
              <pre className="mt-1 overflow-auto whitespace-pre-wrap text-[10px] text-bs-text-muted">
                {JSON.stringify(activeRequest.input, null, 2)}
              </pre>
              <div className="mt-2 text-bs-text-faint">result</div>
              <pre className="mt-1 overflow-auto whitespace-pre-wrap text-[10px] text-bs-text-muted">
                {JSON.stringify(activeRequest.ok ? activeRequest.result : activeRequest.error, null, 2)}
              </pre>
              <button
                onClick={() => selectRequest(null)}
                className="mt-2 rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text hover:bg-bs-bg-active"
              >
                clear selection
              </button>
            </div>
          ) : (
            <div className="text-bs-text-muted">select a call in a `Calls` pane or bottom panel to inspect it</div>
          )}
        </InspectSection>
      </div>
    </div>
  )
}

type ApiViewMode = 'client' | 'ts-console' | 'py-console' | 'cli' | 'swagger' | 'redoc' | 'json' | 'yaml'

function ApiView() {
  const [mode, setMode] = useState<ApiViewMode>('client')
  const clientTargetUrl = useRuntimeStore((state) => state.clientTargetUrl)
  const openapiDocument = useRuntimeStore((state) => state.openapiDocument)
  const operations = useRuntimeStore((state) => state.operations)
  const invocationDrafts = useRuntimeStore((state) => state.invocationDrafts)
  const setInvocationDraft = useRuntimeStore((state) => state.setInvocationDraft)
  const invokeOperation = useRuntimeStore((state) => state.invokeOperation)
  const fetchOperations = useRuntimeStore((state) => state.fetchOperations)

  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connectGeneration = useRef(0)

  const handleConnect = async () => {
    if (!clientTargetUrl) return
    // Skip if operations are already loaded (e.g. from runPane)
    const currentOps = useRuntimeStore.getState().operations
    if (currentOps.length > 0) return

    const gen = ++connectGeneration.current
    setIsConnecting(true)
    setError(null)
    try {
      await fetchOperations(clientTargetUrl)
      if (gen !== connectGeneration.current) return // stale
      const ops = useRuntimeStore.getState().operations
      if (ops.length === 0) {
        setError('No operations found at target')
      }
    } catch (e) {
      if (gen !== connectGeneration.current) return // stale
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      if (gen === connectGeneration.current) {
        setIsConnecting(false)
      }
    }
  }

  const forceConnect = async () => {
    if (!clientTargetUrl) return
    const gen = ++connectGeneration.current
    setIsConnecting(true)
    setError(null)
    try {
      await fetchOperations(clientTargetUrl)
      if (gen !== connectGeneration.current) return
      const ops = useRuntimeStore.getState().operations
      if (ops.length === 0) {
        setError('No operations found at target')
      }
    } catch (e) {
      if (gen !== connectGeneration.current) return
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      if (gen === connectGeneration.current) {
        setIsConnecting(false)
      }
    }
  }

  useEffect(() => {
    if (clientTargetUrl) {
      void handleConnect()
    }
  }, [clientTargetUrl])

  const specJson = openapiDocument ? JSON.stringify(openapiDocument) : null
  const stableSpec = useMemo(
    () => (specJson ? JSON.parse(specJson) : null),
    [specJson],
  )

  return (
    <div className="flex h-full min-h-0 flex-col text-[11px]">
      {/* Shared top bar */}
      <div className="flex h-[34px] flex-none items-center gap-2 border-b border-bs-border bg-bs-bg-panel px-2">
        <ClientTargetField className="flex-1 min-w-0 max-w-md" />
        <button
          onClick={forceConnect}
          disabled={isConnecting}
          className={`flex h-[26px] w-[26px] flex-none items-center justify-center rounded border border-bs-border bg-bs-bg-editor text-bs-text-faint hover:bg-bs-bg-hover hover:text-bs-text ${isConnecting ? 'animate-spin' : ''}`}
          title="Connect / Sync"
        >
          ↻
        </button>
        <div className="flex-1" />
        <div className="mx-1 h-4 w-px bg-bs-border" />
        <div className="flex items-center gap-0.5">
          {([
            ['client', 'Client'],
            ['ts-console', 'TS'],
            ['py-console', 'Python'],
            ['cli', 'CLI'],
            ['swagger', 'Swagger'],
            ['redoc', 'Redoc'],
            ['json', 'JSON'],
            ['yaml', 'YAML'],
          ] as const).map(([m, label]) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded px-2 py-1 text-[10px] font-medium ${
                mode === m
                  ? 'bg-bs-bg-active text-bs-text'
                  : 'text-bs-text-faint hover:bg-bs-bg-hover hover:text-bs-text-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex-none border-b border-bs-border bg-bs-error/10 px-3 py-1.5 text-bs-error whitespace-pre-wrap overflow-auto max-h-24 font-mono text-[10px]">
          {error}
        </div>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 h-0">
        {mode === 'client' ? (
          <ApiClientBody
            operations={operations}
            invocationDrafts={invocationDrafts}
            setInvocationDraft={setInvocationDraft}
            invokeOperation={invokeOperation}
            isConnecting={isConnecting}
          />
        ) : mode === 'ts-console' ? (
          <TsConsoleView />
        ) : mode === 'py-console' ? (
          <PythonConsoleView />
        ) : mode === 'cli' ? (
          <CliEmulatorView />
        ) : mode === 'swagger' ? (
          <div className="h-full overflow-auto bg-white">
            {stableSpec ? (
              <SwaggerUI spec={stableSpec} />
            ) : (
              <div className="p-8 text-sm text-gray-400">
                No OpenAPI document loaded yet. Start a server or connect to a target.
              </div>
            )}
          </div>
        ) : mode === 'redoc' ? (
          <div className="h-full overflow-auto bg-white">
            {stableSpec ? (
              <RedocStandalone spec={stableSpec} />
            ) : (
              <div className="p-8 text-sm text-gray-400">
                No OpenAPI document loaded yet. Start a server or connect to a target.
              </div>
            )}
          </div>
        ) : (
          <ReadonlyMonacoView
            content={openapiDocument}
            language={mode === 'yaml' ? 'yaml' : 'json'}
          />
        )}
      </div>
    </div>
  )
}

/** Minimal JSON→YAML serializer (no dependency). Handles the shapes OpenAPI produces. */
function jsonToYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    if (value.includes('\n')) return `|\n${value.split('\n').map((l) => `${pad}  ${l}`).join('\n')}`
    if (/[:{}\[\],&*?|>!%#@`"']/.test(value) || value === '' || value.trim() !== value) return JSON.stringify(value)
    return value
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value.map((item) => {
      const inner = jsonToYaml(item, indent + 1)
      return inner.includes('\n') && (typeof item === 'object')
        ? `${pad}- ${inner.trimStart()}`
        : `${pad}- ${inner}`
    }).join('\n')
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    return entries.map(([k, v]) => {
      const key = /[:{}\[\],&*?|>!%#@`"'\s]/.test(k) ? JSON.stringify(k) : k
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length > 0) {
        return `${pad}${key}:\n${jsonToYaml(v, indent + 1)}`
      }
      if (Array.isArray(v) && v.length > 0) {
        return `${pad}${key}:\n${jsonToYaml(v, indent + 1)}`
      }
      return `${pad}${key}: ${jsonToYaml(v, indent + 1)}`
    }).join('\n')
  }
  return String(value)
}

function ReadonlyMonacoView({ content, language }: { content: Record<string, unknown> | null; language: 'json' | 'yaml' }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  const text = useMemo(() => {
    if (!content) return ''
    return language === 'yaml' ? jsonToYaml(content) : JSON.stringify(content, null, 2)
  }, [content, language])

  useEffect(() => {
    if (!containerRef.current) return

    if (!editorRef.current) {
      editorRef.current = monaco.editor.create(containerRef.current, {
        value: text,
        language,
        readOnly: true,
        minimap: { enabled: false },
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        fontSize: 12,
        automaticLayout: true,
        wordWrap: 'on',
      })
    } else {
      const model = editorRef.current.getModel()
      if (model) {
        monaco.editor.setModelLanguage(model, language)
        model.setValue(text)
      }
    }

    return () => {}
  }, [text, language])

  useEffect(() => {
    return () => {
      editorRef.current?.dispose()
      editorRef.current = null
    }
  }, [])

  if (!content) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-bs-text-faint">
        No OpenAPI document loaded yet. Start a server or connect to a target.
      </div>
    )
  }

  return <div ref={containerRef} className="h-full w-full" />
}

function ApiClientBody({
  operations,
  invocationDrafts,
  setInvocationDraft,
  invokeOperation,
  isConnecting,
}: {
  operations: RuntimeOperation[]
  invocationDrafts: Record<string, string>
  setInvocationDraft: (operationId: string, draft: string) => void
  invokeOperation: (id: string) => Promise<unknown>
  isConnecting: boolean
}) {
   return (
     <div className="flex h-full min-h-0 bg-bs-bg-panel p-3 text-[11px]">
       <div className="flex w-[260px] flex-none flex-col gap-1 overflow-auto rounded border border-bs-border bg-bs-bg-sidebar p-3 shadow-sm">
          <ServersSection />
      </div>

      <div className="ml-3 flex min-w-0 flex-1 flex-col gap-1 overflow-auto rounded border border-bs-border bg-bs-bg-sidebar p-3 shadow-sm">
          {operations.length > 0 ? operations.map((operation) => (
            <OperationItem
              key={operation.id}
              operation={operation}
              draft={invocationDrafts[operation.id] ?? '{}'}
              setDraft={(val) => setInvocationDraft(operation.id, val)}
              invoke={invokeOperation}
            />
          )) : (
           <div className="py-4 text-center text-bs-text-faint italic border border-dashed border-bs-border rounded">
             {isConnecting ? 'Fetching operations...' : 'Connect to a target to see methods'}
           </div>
         )}
      </div>
    </div>
  )
}

function OperationItem({
  operation,
  draft,
  setDraft,
  invoke,
}: {
  operation: RuntimeOperation
  draft: string
  setDraft: (value: string) => void
  invoke: (id: string) => Promise<unknown>
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; data: unknown; durationMs: number } | null>(null)

  const handleInvoke = async () => {
    setPending(true)
    setResult(null)
    const start = Date.now()
    try {
      const data = await invoke(operation.id)
      setResult({ ok: true, data, durationMs: Date.now() - start })
    } catch (e) {
      setResult({ ok: false, data: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mb-1 overflow-hidden rounded border border-bs-border bg-bs-bg-panel transition-all">
      <div
        className="flex items-center gap-2 p-2 cursor-pointer hover:bg-bs-bg-hover"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className={`text-[8px] text-bs-text-faint transition-transform duration-100 ${isExpanded ? 'rotate-90' : ''}`}>
          ▶
        </span>
        <span className="font-mono text-[11px] font-semibold text-bs-text flex-1 truncate">
          {operation.label}
        </span>
        {pending && (
          <div className="h-3 w-3 animate-spin rounded-full border border-bs-border border-t-bs-accent" />
        )}
        {!pending && result && (
          <div className={`h-1.5 w-1.5 rounded-full ${result.ok ? 'bg-bs-good' : 'bg-bs-error'}`} />
        )}
      </div>

      {isExpanded && (
        <div className="border-t border-bs-border bg-bs-bg-sidebar p-3 flex flex-col gap-3">
          {operation.summary && (
            <div className="text-bs-text-muted leading-relaxed text-[10px] italic">{operation.summary}</div>
          )}

          <div className="flex flex-wrap gap-3">
            {/* Input + Run */}
            <div className="flex min-w-[180px] max-w-[280px] flex-col gap-3">
              <OperationForm
                operation={operation}
                value={draft}
                onChange={setDraft}
              />

              <div className="flex items-center justify-between">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleInvoke()
                  }}
                  disabled={pending}
                  className="bg-bs-good text-bs-accent-text px-4 py-1 rounded text-[11px] font-bold hover:opacity-90 shadow-sm disabled:opacity-50"
                >
                  {pending ? 'Running...' : 'Run'}
                </button>
                {result && (
                  <span className="text-[10px] font-mono text-bs-text-faint">
                    {result.durationMs}ms
                  </span>
                )}
              </div>
            </div>

            {/* Result */}
            <div className="min-w-[200px] flex-1">
              {pending ? (
                <div className="flex items-center justify-center gap-2 py-6 text-bs-text-faint">
                  <div className="h-3 w-3 animate-spin rounded-full border border-bs-border border-t-bs-accent" />
                  <span className="text-[10px]">Running...</span>
                </div>
              ) : result ? (
                <div className="rounded border border-bs-border bg-bs-bg-panel p-3 h-full">
                  <div className="flex items-center justify-between border-b border-bs-border pb-2 mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${result.ok ? 'bg-bs-good' : 'bg-bs-error'}`} />
                      <span className="text-bs-text-faint text-[9px] uppercase tracking-tighter">{result.ok ? 'Success' : 'Error'}</span>
                    </div>
                    <span className="text-bs-text-faint font-mono text-[10px]">{result.durationMs}ms</span>
                  </div>
                  {!result.ok ? <div className="text-bs-error text-[10px] font-medium mb-2">{String(result.data)}</div> : null}
                  <pre className="overflow-auto whitespace-pre-wrap text-[10px] text-bs-text p-2 bg-bs-bg-sidebar rounded border border-bs-border max-h-48">
                    {JSON.stringify(result.data, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="flex items-center justify-center py-6 text-bs-text-faint text-[10px] italic">
                  Run to see result
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function OperationForm({
  operation,
  value,
  onChange,
}: {
  operation: RuntimeOperation
  value: string
  onChange: (value: string) => void
}) {
  const schema = operation.inputSchema
  const properties = schema?.properties as Record<string, any> | undefined

  if (!properties || Object.keys(properties).length === 0) {
    return null
  }

  let json: any = {}
  try {
    json = JSON.parse(value)
  } catch (e) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="h-24 w-full resize-y rounded border border-bs-border bg-bs-bg-panel px-2 py-1 font-mono text-[10px] text-bs-text outline-none focus:border-bs-border-focus"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 border-l-2 border-bs-border pl-3">
      {Object.entries(properties).map(([key, propSchema]) => {
        const val = json[key]
        const update = (newVal: any) => {
          onChange(JSON.stringify({ ...json, [key]: newVal }, null, 2))
        }

        return (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] text-bs-text font-bold font-mono">{key}</label>
              <span className="text-[9px] text-bs-text-faint font-mono uppercase">{propSchema.type}</span>
            </div>
            {propSchema.type === 'boolean' ? (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!val}
                  onChange={e => update(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-bs-border bg-bs-bg-panel accent-bs-good"
                />
                <span className="text-[10px] text-bs-text-muted">{!!val ? 'true' : 'false'}</span>
              </label>
            ) : propSchema.type === 'number' || propSchema.type === 'integer' ? (
              <input
                type="number"
                value={val ?? ''}
                onChange={e => update(e.target.value === '' ? undefined : Number(e.target.value))}
                className="w-full rounded border border-bs-border bg-bs-bg-panel px-2 py-1 text-[11px] text-bs-text outline-none focus:border-bs-border-focus font-mono"
              />
            ) : (
              <input
                type="text"
                value={typeof val === 'string' ? val : (val === undefined ? '' : JSON.stringify(val))}
                onChange={e => update(e.target.value)}
                className="w-full rounded border border-bs-border bg-bs-bg-panel px-2 py-1 text-[11px] text-bs-text outline-none focus:border-bs-border-focus font-mono"
              />
            )}
            {propSchema.description && (
              <div className="text-[9px] text-bs-text-faint leading-tight italic">{propSchema.description}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function DataView() {
  const tables = useDatabaseStore((state) => state.tables)
  const activeTableName = useDatabaseStore((state) => state.activeTableName)
  const saveState = useDatabaseStore((state) => state.saveState)
  const filter = useDatabaseStore((state) => state.filter)
  const setFilter = useDatabaseStore((state) => state.setFilter)
  const setActiveTable = useDatabaseStore((state) => state.setActiveTable)
  const updateCell = useDatabaseStore((state) => state.updateCell)
  const insertRow = useDatabaseStore((state) => state.insertRow)
  const deleteRow = useDatabaseStore((state) => state.deleteRow)
  const activeTable = tables.find((table) => table.name === activeTableName) ?? tables[0] ?? null
  const filteredRows = activeTable
    ? activeTable.rows.filter((row) => {
        if (!filter.trim()) return true
        const haystack = Object.values(row.values).join(' ').toLowerCase()
        return haystack.includes(filter.trim().toLowerCase())
      })
    : []

  return (
    <div className="flex h-full min-h-0 gap-3 p-3 text-[11px]">
      <div className="flex w-56 flex-none flex-col gap-1 overflow-auto rounded border border-bs-border bg-bs-bg-sidebar p-2">
        <div className="text-bs-text">tables</div>
        <div className="text-[10px] text-bs-text-faint">storage: {saveState}</div>
        {tables.length > 0 ? tables.map((table) => (
          <button
            key={table.name}
            onClick={() => setActiveTable(table.name)}
            className={`rounded px-2 py-1 text-left ${
              table.name === activeTable?.name
                ? 'bg-bs-bg-active text-bs-text'
                : 'text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text'
            }`}
          >
            <div>{table.name}</div>
            <div className="text-[10px] text-bs-text-faint">{table.rows.length} rows</div>
          </button>
        )) : (
          <div className="text-bs-text-faint">no local tables yet</div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2 rounded border border-bs-border bg-bs-bg-sidebar px-2 py-1">
          <span className="text-bs-text">{activeTable?.name ?? 'No table selected'}</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="filter rows"
            className="min-w-0 flex-1 rounded border border-bs-border bg-bs-bg-panel px-2 py-1 text-[10px] text-bs-text outline-none focus:border-bs-border-focus"
          />
          {activeTable ? (
            <button
              onClick={() => insertRow(activeTable.name)}
              className="rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text hover:bg-bs-bg-active"
            >
              add row
            </button>
          ) : null}
        </div>

        {activeTable ? (
          <div className="min-h-0 overflow-auto rounded border border-bs-border bg-bs-bg-sidebar">
            <table className="w-full border-collapse text-left text-[10px]">
              <thead className="sticky top-0 bg-bs-bg-panel">
                <tr>
                  {activeTable.columns.map((column) => (
                    <th key={column.name} className="border-b border-bs-border px-2 py-1 text-bs-text">
                      {column.name}
                    </th>
                  ))}
                  <th className="border-b border-bs-border px-2 py-1 text-bs-text-faint">actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.id} className="border-b border-bs-border">
                    {activeTable.columns.map((column) => (
                      <td key={column.name} className="px-2 py-1 align-top">
                        <input
                          value={String(row.values[column.name] ?? '')}
                          onChange={(event) => updateCell(activeTable.name, row.id, column.name, event.target.value)}
                          className="w-full rounded border border-transparent bg-bs-bg-panel px-1 py-1 text-bs-text outline-none focus:border-bs-border-focus"
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1 align-top">
                      <button
                        onClick={() => deleteRow(activeTable.name, row.id)}
                        className="rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text-faint hover:text-bs-text"
                      >
                        delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredRows.length === 0 ? (
              <div className="px-2 py-2 text-bs-text-faint">no rows match this filter</div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center rounded border border-bs-border bg-bs-bg-sidebar text-bs-text-faint">
            local database tables will appear here
          </div>
        )}
      </div>
    </div>
  )
}

function HistoryView() {
  const sample = useWorkspaceStore((state) => state.sample)
  const files = useWorkspaceStore((state) => state.files)
  const tables = useDatabaseStore((state) => state.tables)
  const exportTrust = useTrustStore((state) => state.exportSnapshot)
  const createCheckpoint = useCheckpointStore((state) => state.createCheckpoint)
  const themeId = useThemeStore((state) => state.themeId)
  const layoutPresetId = useLayoutStore((state) => state.presetId)
  const sidebarWidth = useLayoutStore((state) => state.sidebarWidth)
  const bottomHeight = useLayoutStore((state) => state.bottomHeight)
  const rightWidth = useLayoutStore((state) => state.rightWidth)
  const showSidebar = useLayoutStore((state) => state.sidebarWidth > 0)
  const showBottom = useLayoutStore((state) => state.bottomHeight > 0)
  const showRight = useLayoutStore((state) => state.rightWidth > 0)

  const saveCheckpoint = async (name: string, note?: string) => {
    const workspace: WorkspaceSnapshot = {
      id: sample.id,
      name: sample.name,
      serverLanguage: sample.serverLanguage,
      files: files.map(({ path, language, content, updatedAt }) => ({
        path,
        language,
        content,
        updatedAt,
      })),
      updatedAt: Date.now(),
    }
    const database: DatabaseSnapshot = {
      workspaceId: sample.id,
      tables,
      updatedAt: Date.now(),
    }
    const bundle: ProjectBundle = {
      version: 1,
      exportedAt: Date.now(),
      workspace,
      database,
      trust: exportTrust() ?? undefined,
      ui: {
        themeId,
        presetId: layoutPresetId,
        layout: {
          sidebarWidth,
          bottomHeight,
          rightWidth,
          showSidebar,
          showBottom,
          showRight,
        },
      },
    }

    await createCheckpoint({
      workspaceId: sample.id,
      name,
      note,
      bundle,
    })
  }

  return <HistoryPanel onCreateCheckpoint={saveCheckpoint} />
}

function LogsView() {
  const logs = useRuntimeStore((state) => state.logs)

  return (
    <div className="h-full overflow-auto bg-bs-bg-panel p-3 font-mono text-[11px] text-bs-text-muted">
      <div className="mb-2 text-bs-text">runtime logs</div>
      <div className="flex flex-col gap-1">
        {logs.length > 0 ? logs.map((entry) => (
          <div key={entry.id} className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-1">
            <div className="flex items-center gap-2">
              <span className="uppercase text-bs-text-faint">{entry.level}</span>
              <span className="text-bs-text">{entry.message}</span>
            </div>
          </div>
        )) : (
          <div className="text-bs-text-faint">No runtime logs yet</div>
        )}
      </div>
    </div>
  )
}

function CallsView() {
  const requests = useRuntimeStore((state) => state.requests)
  const activeRequestId = useRuntimeStore((state) => state.activeRequestId)
  const selectRequest = useRuntimeStore((state) => state.selectRequest)

  return (
    <div className="h-full overflow-auto bg-bs-bg-panel p-3 text-[11px]">
      <div className="mb-2 text-bs-text">runtime calls</div>
      <div className="flex flex-col gap-1">
        {requests.length > 0 ? requests.map((request) => (
          <button
            key={request.id}
            onClick={() => selectRequest(request.id)}
            className={`w-full rounded border px-2 py-2 text-left ${
              request.id === activeRequestId
                ? 'border-bs-border-focus bg-bs-bg-active'
                : 'border-bs-border bg-bs-bg-sidebar'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className={request.ok ? 'text-bs-good' : 'text-bs-error'}>{request.ok ? 'ok' : 'error'}</span>
              <span className="text-bs-text">{request.operationLabel ?? request.operationId}</span>
              <span className="text-bs-text-faint">{request.durationMs}ms</span>
            </div>
          </button>
        )) : (
          <div className="text-bs-text-faint">No runtime calls yet</div>
        )}
      </div>
    </div>
  )
}

function BuildView() {
  const compiledCode = useRuntimeStore((state) => state.compiledCode)
  const runtimeLanguage = useRuntimeStore((state) => state.language)
  const launchNote = useRuntimeStore((state) => state.launchNote)

  return (
    <div className="h-full overflow-auto bg-bs-bg-panel p-3 font-mono text-[11px] text-bs-text-muted">
      <div className="mb-2 text-bs-text">build output</div>
      <div className="mb-3 text-[10px] text-bs-text-faint">
        {runtimeLanguage ?? 'runtime'} {launchNote ? ` / ${launchNote}` : ''}
      </div>
      {compiledCode ? (
        <pre className="whitespace-pre-wrap rounded border border-bs-border bg-bs-bg-sidebar p-3 text-[10px] text-bs-text-muted">
          {compiledCode}
        </pre>
      ) : (
        <div className="text-bs-text-faint">No compiled output yet</div>
      )}
    </div>
  )
}

function ProblemsView() {
  const diagnostics = useRuntimeStore((state) => state.diagnostics)

  return (
    <div className="h-full overflow-auto bg-bs-bg-panel p-3 text-[11px]">
      <div className="mb-2 text-bs-text">problems</div>
      <div className="flex flex-col gap-2">
        {diagnostics.length > 0 ? diagnostics.map((diagnostic) => (
          <div key={`${diagnostic.code}:${diagnostic.line ?? 0}:${diagnostic.column ?? 0}:${diagnostic.message}`} className="rounded border border-bs-border bg-bs-bg-sidebar px-3 py-2">
            <div className={diagnostic.category === 'error' ? 'text-bs-error' : 'text-bs-warn'}>
              {diagnostic.category.toUpperCase()} {diagnostic.code}
            </div>
            <div className="mt-1 text-bs-text">{diagnostic.message}</div>
            {diagnostic.line ? (
              <div className="mt-1 text-[10px] text-bs-text-faint">
                line {diagnostic.line}{diagnostic.column ? `:${diagnostic.column}` : ''}
              </div>
            ) : null}
          </div>
        )) : (
          <div className="text-bs-text-faint">No compile problems</div>
        )}
      </div>
    </div>
  )
}

function BrowserView() {
  const tabSessions = useRuntimeStore((state) => state.tabSessions)
  const connectionUrl = useRuntimeStore((state) => state.connectionUrl)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const channelRef = useRef<ClientSideServerChannel | null>(null)
  const connectedUrlRef = useRef<string | null>(null)
  const peerPoolRef = useRef<Awaited<ReturnType<typeof createClientSideServerMQTTWebRTCPeerPool>> | null>(null)
  const activeBlobUrlRef = useRef<string | null>(null)
  const [browserUrl, setBrowserUrl] = useState('/')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debugBrowser = (event: string, detail?: unknown) => {
    if (detail === undefined) {
      console.debug(`[BrowserView] ${event}`)
      return
    }
    console.debug(`[BrowserView] ${event}`, detail)
  }

  const hasRunningServer = Object.values(tabSessions).some((session) => (
    session.mode === 'server' && session.status === 'running'
  ))

  const parseBrowserTarget = (rawInput: string): {
    connectionUrl: string | null
    requestPath: string | null
    normalizedUrl: string | null
  } => {
    const trimmed = rawInput.trim()
    if (!trimmed.startsWith('css://')) {
      return { connectionUrl: null, requestPath: null, normalizedUrl: null }
    }

    try {
      const parsed = new URL(trimmed)
      const server = parsed.host || parsed.pathname.replace(/^\/+/, '')
      if (!server) {
        return { connectionUrl: null, requestPath: null, normalizedUrl: null }
      }

      const connectionTarget = `css://${server}`
      const pathPart = parsed.pathname || '/'
      const requestPath = `${pathPart}${parsed.search}`
      const normalizedUrl = `${connectionTarget}${pathPart}${parsed.search}`
      return { connectionUrl: connectionTarget, requestPath, normalizedUrl }
    } catch {
      return { connectionUrl: null, requestPath: null, normalizedUrl: null }
    }
  }

  async function closeChannel(): Promise<void> {
    debugBrowser('channel.close.start', {
      connectedUrl: connectedUrlRef.current,
      hasChannel: Boolean(channelRef.current),
    })
    if (channelRef.current && typeof channelRef.current.close === 'function') {
      await channelRef.current.close()
    }
    channelRef.current = null
    connectedUrlRef.current = null
    debugBrowser('channel.close.done')
  }

  async function ensureChannel(preferredConnectionUrl?: string | null) {
    const targetConnectionUrl = preferredConnectionUrl ?? connectedUrlRef.current
    if (!targetConnectionUrl || !targetConnectionUrl.startsWith('css://')) return null

    debugBrowser('channel.ensure.start', {
      targetConnectionUrl,
      currentlyConnectedUrl: connectedUrlRef.current,
      hasExistingChannel: Boolean(channelRef.current),
    })

    if (channelRef.current && connectedUrlRef.current === targetConnectionUrl) return channelRef.current
    if (channelRef.current && connectedUrlRef.current !== targetConnectionUrl) {
      await closeChannel()
    }

    if (!peerPoolRef.current) {
      peerPoolRef.current = createClientSideServerMQTTWebRTCPeerPool()
    }

    const address = parseClientSideServerAddress(targetConnectionUrl)
    const session = await peerPoolRef.current.connect(address)
    channelRef.current = session
    connectedUrlRef.current = targetConnectionUrl
    debugBrowser('channel.ensure.connected', {
      targetConnectionUrl,
      transport: 'mqtt-webrtc',
    })
    return session
  }

  const clearActiveBlobUrl = () => {
    if (!activeBlobUrlRef.current) return
    URL.revokeObjectURL(activeBlobUrlRef.current)
    activeBlobUrlRef.current = null
  }

  const ensurePlatFetch = async (preferredConnectionUrl?: string | null): Promise<typeof fetch | null> => {
    const targetConnectionUrl = preferredConnectionUrl ?? connectedUrlRef.current
    if (!targetConnectionUrl || !targetConnectionUrl.startsWith('css://')) return null

    const targetServerName = (() => {
      try {
        const parsed = new URL(targetConnectionUrl)
        return parsed.host || parsed.pathname.replace(/^\/+/, '')
      } catch {
        return ''
      }
    })()

    // Prefer in-process server for the exact target URL or server name.
    const inProcessServer = getRuntimeServerForConnectionUrl(targetConnectionUrl)
      ?? (targetServerName ? getRuntimeServerForServerName(targetServerName) : null)
    debugBrowser('fetch.ensure.start', {
      targetConnectionUrl,
      targetServerName,
      inProcessServerFound: Boolean(inProcessServer),
    })
    if (inProcessServer) {
      connectedUrlRef.current = targetConnectionUrl
      const channel = createInProcessChannel(inProcessServer)
      debugBrowser('fetch.ensure.selected', {
        targetConnectionUrl,
        mode: 'in-process',
        createPlatFetchAvailable: true,
      })
      return createPlatFetch({ channel })
    }

    // Remote server path via MQTT+WebRTC.
    const channel = channelRef.current ?? await ensureChannel(targetConnectionUrl)
    if (!channel) return null
    debugBrowser('fetch.ensure.selected', {
      targetConnectionUrl,
      mode: 'remote-channel',
      createPlatFetchAvailable: true,
    })
    return createPlatFetch({ channel })
  }

  const navigate = async (path: string) => {
    const traceId = crypto.randomUUID().slice(0, 8)
    debugBrowser('navigate.start', { traceId, input: path })
    const target = parseBrowserTarget(path)
    debugBrowser('navigate.parsed', { traceId, target })

    if (!target.connectionUrl || !target.requestPath) {
      setError('Enter a full css://server-name/path address in the URL bar.')
      debugBrowser('navigate.invalid-target', { traceId, path })
      return
    }

    if (target.normalizedUrl) {
      setBrowserUrl(target.normalizedUrl)
    }

    const platFetch = await ensurePlatFetch(target.connectionUrl)
    if (!platFetch) {
      setError(`Unable to connect to ${target.connectionUrl}.`)
      debugBrowser('navigate.no-fetch', { traceId, targetConnectionUrl: target.connectionUrl })
      return
    }

    setLoading(true)
    setError(null)

    try {
      const response = await platFetch(target.requestPath)
      debugBrowser('navigate.response', {
        traceId,
        requestPath: target.requestPath,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type') || '',
      })

      if (!response.ok) {
        setError(`${response.status} ${response.statusText}`)
        setLoading(false)
        debugBrowser('navigate.response.error', { traceId, status: response.status, statusText: response.statusText })
        return
      }

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('text/html')) {
        clearActiveBlobUrl()
        const text = await response.text()
        const blob = new Blob([text], { type: contentType })
        const blobUrl = URL.createObjectURL(blob)
        activeBlobUrlRef.current = blobUrl
        if (iframeRef.current) {
          iframeRef.current.srcdoc = ''
          iframeRef.current.src = blobUrl
        }
        debugBrowser('navigate.render.blob', { traceId, contentType })
        setLoading(false)
        return
      }

      clearActiveBlobUrl()
      const html = injectBridgeScript(await response.text())
      if (iframeRef.current) {
        iframeRef.current.src = 'about:blank'
        iframeRef.current.srcdoc = html
      }
      debugBrowser('navigate.render.html', { traceId, bridgeInjected: true })
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      debugBrowser('navigate.exception', {
        traceId,
        error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      })
      setLoading(false)
    }
  }

  const injectBridgeScript = (html: string): string => {
    const bridgeScript = `<script>${generateBridgeScript()}</script>`
    if (html.includes('<head>')) {
      return html.replace('<head>', `<head>${bridgeScript}`)
    }
    if (html.includes('</head>')) {
      return html.replace('</head>', `${bridgeScript}</head>`)
    }
    if (html.includes('<html>')) {
      return html.replace('<html>', `<html><head>${bridgeScript}</head>`)
    }
    return bridgeScript + html
  }

  const encodeResponseBody = async (response: Response): Promise<ArrayBuffer> => {
    return await response.arrayBuffer()
  }

  const encodeJsonBody = (value: unknown): ArrayBuffer => {
    return new TextEncoder().encode(JSON.stringify(value)).buffer
  }

  // Auto-navigate on mount or server restart
  useEffect(() => {
    if (hasRunningServer && browserUrl.trim().startsWith('css://')) {
      const timer = setTimeout(() => navigate(browserUrl), 200)
      return () => clearTimeout(timer)
    }
  }, [hasRunningServer, browserUrl])

  // Create in-process channel whenever any server tab is running.
  useEffect(() => {
    if (!hasRunningServer) {
      clearActiveBlobUrl()
      void closeChannel()
      return
    }

    return () => {
      clearActiveBlobUrl()
      void closeChannel()
    }
  }, [hasRunningServer])

  useEffect(() => {
    if (!connectionUrl?.startsWith('css://')) return
    setBrowserUrl((current) => (current.trim().startsWith('css://') ? current : `${connectionUrl}/`))
  }, [connectionUrl])

  // Handle bridge requests emitted by plat's generated iframe script.
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const data = event.data
      if (!data || data.type !== 'plat-fetch') return

      if (event.source !== iframeRef.current?.contentWindow) return
      const replyTarget = event.source as Window

      const platFetch = await ensurePlatFetch()
      if (!platFetch) {
        debugBrowser('bridge.no-server-connection', { id: data.id, path: data.path })
        const body = encodeJsonBody({ error: 'No server connection' })
        replyTarget.postMessage({
          type: 'plat-fetch-response',
          id: data.id,
          ok: false,
          status: 503,
          statusText: 'No server connection',
          contentType: 'application/json',
          body,
          headers: {},
        }, '*', [body])
        return
      }

      try {
        const response = await platFetch(data.path, {
          method: data.method,
          headers: data.headers,
          body: data.body,
        })

        debugBrowser('bridge.response', {
          id: data.id,
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type') || '',
        })

        const respHeaders: Record<string, string> = {}
        response.headers.forEach((v, k) => { respHeaders[k] = v })

        const body = await encodeResponseBody(response)
        replyTarget.postMessage({
          type: 'plat-fetch-response',
          id: data.id,
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type') || 'application/octet-stream',
          body,
          headers: respHeaders,
        }, '*', [body])
      } catch (err) {
        debugBrowser('bridge.exception', {
          id: data.id,
          error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
        })
        const body = encodeJsonBody({ error: String(err) })
        replyTarget.postMessage({
          type: 'plat-fetch-response',
          id: data.id,
          ok: false,
          status: 500,
          statusText: err instanceof Error ? err.message : 'Unknown error',
          contentType: 'application/json',
          body,
          headers: {},
        }, '*', [body])
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])


  return (
    <div className="flex h-full flex-col bg-bs-bg-panel">
      {/* URL bar */}
      <div className="flex items-center gap-2 border-b border-bs-border px-3 py-2">
        <button
          onClick={() => navigate(browserUrl)}
          className="rounded bg-bs-bg-hover px-2 py-1 text-[11px] text-bs-text hover:bg-bs-border"
          title="Reload"
        >
          {loading ? '...' : '\u21BB'}
        </button>
        <input
          type="text"
          value={browserUrl}
          onChange={(e) => setBrowserUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate(browserUrl)
          }}
          className="flex-1 rounded border border-bs-border bg-bs-bg-sidebar px-2 py-1 font-mono text-[11px] text-bs-text outline-none focus:border-bs-border-focus"
          placeholder="css://server-name/path"
        />
        <button
          onClick={() => navigate(browserUrl)}
          className="rounded bg-bs-good px-3 py-1 text-[11px] font-medium text-bs-accent-text hover:opacity-90"
        >
          Go
        </button>
      </div>

      {/* Error display */}
      {error && (
        <div className="border-b border-bs-border bg-red-500/10 px-3 py-2 text-[11px] text-bs-error">
          {error}
        </div>
      )}

      {/* Not running state */}
      {!hasRunningServer && (
        <div className="flex flex-1 items-center justify-center text-[12px] text-bs-text-faint">
          Start a server with a StaticFolder to preview it here
        </div>
      )}

      {/* Iframe */}
      <iframe
        ref={iframeRef}
        className={`flex-1 border-0 bg-white ${!hasRunningServer ? 'hidden' : ''}`}
        sandbox="allow-scripts allow-same-origin"
        title="Browser Preview"
      />
    </div>
  )
}

function InspectSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-bs-border bg-bs-bg-panel px-3 py-3">
      <div className="mb-2 uppercase tracking-[0.16em] text-bs-text-faint">{title}</div>
      {children}
    </div>
  )
}
