import type { DatabaseSnapshot } from '@browserver/database'
import type { WorkspaceSnapshot } from '@browserver/storage'
import type { ProjectBundle } from '../config/projectBundle'
import { ClientTargetField } from './ClientTargetField'
import { HistoryPanel } from './HistoryPanel'
import { TrustPanel } from './TrustPanel'
import { useCheckpointStore } from '../store/checkpoints'
import { useDatabaseStore } from '../store/database'
import { layoutPresets, useLayoutStore } from '../store/layout'
import { useRuntimeStore } from '../store/runtime'
import { useThemeStore } from '../theme'
import {
  getEditorViewId,
  useWorkspaceStore,
} from '../store/workspace'
import { useTrustStore } from '../store/trust'

interface EditorViewHostProps {
  path: string
}

export function EditorViewHost({ path }: EditorViewHostProps) {
  const viewId = getEditorViewId(path)

  if (viewId === 'inspect') return <InspectView />
  if (viewId === 'client') return <ClientView />
  if (viewId === 'swagger') return <OpenApiView variant="swagger" />
  if (viewId === 'redoc') return <OpenApiView variant="redoc" />
  if (viewId === 'data') return <DataView />
  if (viewId === 'trust') return <TrustPanel />
  if (viewId === 'history') return <HistoryView />
  if (viewId === 'logs') return <LogsView />
  if (viewId === 'calls') return <CallsView />
  if (viewId === 'build') return <BuildView />
  if (viewId === 'problems') return <ProblemsView />

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
                <span className="text-bs-text">{activeRequest.operationId}</span>
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

function ClientView() {
  const activeFilePath = useWorkspaceStore((state) => state.activeFilePath)
  const files = useWorkspaceStore((state) => state.files)
  const connectionUrl = useRuntimeStore((state) => state.connectionUrl)
  const serverName = useRuntimeStore((state) => state.serverName)
  const operations = useRuntimeStore((state) => state.operations)
  const invocationDrafts = useRuntimeStore((state) => state.invocationDrafts)
  const setInvocationDraft = useRuntimeStore((state) => state.setInvocationDraft)
  const invokeOperation = useRuntimeStore((state) => state.invokeOperation)
  const clientRun = useRuntimeStore((state) => state.clientRun)
  const runClientFile = useRuntimeStore((state) => state.runClientFile)
  const selectedClientPath = files.find((file) => file.path === activeFilePath && file.name.startsWith('client'))?.path
    ?? files.find((file) => file.name.startsWith('client'))?.path
    ?? undefined
  const targetPlaceholder = connectionUrl ?? (serverName ? `css://${serverName}` : 'css://hello')

  return (
    <div className="flex h-full min-h-0 gap-3 p-3 text-[11px]">
      <div className="flex w-[320px] flex-none flex-col gap-2 overflow-auto rounded border border-bs-border bg-bs-bg-sidebar p-2">
        <div>
          <div className="text-bs-text">client playground</div>
          <div className="text-[10px] text-bs-text-faint">run a client file or invoke runtime operations</div>
        </div>
        <div className="text-[10px] text-bs-text-faint">target url</div>
        <div className="flex items-center gap-2">
          <ClientTargetField className="flex-1" />
          <button
            onClick={() => void runClientFile(selectedClientPath)}
            className="flex h-[30px] w-[30px] items-center justify-center rounded bg-bs-good text-bs-accent-text hover:opacity-90"
            aria-label="Run client"
            title="Run client"
          >
            ▶
          </button>
        </div>
        <div className="text-[10px] text-bs-text-faint">
          client file: {selectedClientPath || 'none selected'}
        </div>
        <div className="border-t border-bs-border pt-2 text-bs-text">operations</div>
        <div className="flex flex-col gap-2">
          {operations.length > 0 ? operations.map((operation) => (
            <div key={operation.id} className="rounded border border-bs-border bg-bs-bg-panel px-2 py-2">
              <div className="text-bs-text">{operation.id}</div>
              <div className="text-[10px] text-bs-text-faint">
                {operation.method} {operation.path}
              </div>
              <textarea
                value={invocationDrafts[operation.id] ?? '{}'}
                onChange={(event) => setInvocationDraft(operation.id, event.target.value)}
                spellCheck={false}
                className="mt-2 h-24 w-full resize-y rounded border border-bs-border bg-bs-bg-sidebar px-2 py-1 font-mono text-[10px] text-bs-text outline-none focus:border-bs-border-focus"
              />
              <button
                onClick={() => void invokeOperation(operation.id)}
                className="mt-2 rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text hover:bg-bs-bg-active"
              >
                invoke
              </button>
            </div>
          )) : (
            <div className="text-bs-text-faint">launch a runtime to inspect client operations</div>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1 overflow-auto rounded border border-bs-border bg-bs-bg-sidebar p-3">
        <div className="mb-2 text-bs-text">latest client run</div>
        {clientRun ? (
          <div className="flex flex-col gap-2">
            <div className="rounded border border-bs-border bg-bs-bg-panel px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-bs-text">{clientRun.status}</span>
                <span className="text-[10px] text-bs-text-faint">{clientRun.filePath}</span>
                <span className="text-[10px] text-bs-text-faint">{clientRun.targetUrl ?? targetPlaceholder}</span>
                {clientRun.durationMs ? (
                  <span className="text-[10px] text-bs-text-faint">{clientRun.durationMs}ms</span>
                ) : null}
              </div>
              {clientRun.error ? <div className="mt-2 text-bs-error">{clientRun.error}</div> : null}
              {typeof clientRun.result !== 'undefined' ? (
                <>
                  <div className="mt-2 text-[10px] uppercase tracking-wide text-bs-text-faint">result</div>
                  <pre className="mt-1 overflow-auto whitespace-pre-wrap text-[10px] text-bs-text-muted">
                    {JSON.stringify(clientRun.result, null, 2)}
                  </pre>
                </>
              ) : null}
            </div>
            <div className="rounded border border-bs-border bg-bs-bg-panel px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-bs-text-faint">console</div>
              {clientRun.logs.length > 0 ? (
                <pre className="mt-1 overflow-auto whitespace-pre-wrap text-[10px] text-bs-text-muted">
                  {clientRun.logs.join('\n')}
                </pre>
              ) : (
                <div className="mt-1 text-bs-text-faint">no client console output</div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-bs-text-faint">run a client to inspect results here</div>
        )}
      </div>
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

function OpenApiView({ variant }: { variant: 'swagger' | 'redoc' }) {
  const openapiDocument = useRuntimeStore((state) => state.openapiDocument)
  const operations = useRuntimeStore((state) => state.operations)
  const serverName = useRuntimeStore((state) => state.serverName)
  const connectionUrl = useRuntimeStore((state) => state.connectionUrl)
  const title = variant === 'swagger' ? 'Swagger' : 'Redoc'
  const info = openapiDocument?.info as { title?: string; description?: string } | undefined
  const paths = Object.entries((openapiDocument?.paths as Record<string, Record<string, { summary?: string; description?: string }>> | undefined) ?? {})

  return (
    <div className={`h-full overflow-auto p-4 text-[11px] ${variant === 'swagger' ? 'bg-bs-bg-editor' : 'bg-bs-bg-sidebar'}`}>
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <div className="rounded border border-bs-border bg-bs-bg-panel px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="text-lg text-bs-text">{title}</div>
            {openapiDocument ? (
              <div className="rounded bg-bs-bg-hover px-2 py-0.5 text-[10px] uppercase tracking-wide text-bs-text-faint">
                OpenAPI {(openapiDocument.openapi as string | undefined) ?? '3.x'}
              </div>
            ) : null}
          </div>
          <div className="mt-2 text-bs-text-muted">
            {openapiDocument
              ? (info?.title ?? serverName ?? 'Browser runtime API')
              : 'OpenAPI target'}
          </div>
          {openapiDocument && info?.description ? (
            <div className="mt-1 text-bs-text-faint">
              {info.description}
            </div>
          ) : null}
          <div className="mt-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-bs-text-faint">target url</div>
            <ClientTargetField />
          </div>
          <div className="mt-2 text-[10px] text-bs-text-faint">
            {connectionUrl ?? (serverName ? `css://${serverName}` : 'enter or choose a target url')}
          </div>
        </div>

        {!openapiDocument ? (
          <div className="rounded border border-bs-border bg-bs-bg-panel px-5 py-8 text-sm text-bs-text-faint">
            No active OpenAPI document is loaded for this pane yet.
          </div>
        ) : variant === 'swagger' ? (
          <div className="rounded border border-bs-border bg-bs-bg-panel px-4 py-3">
            <div className="mb-2 text-[10px] uppercase tracking-wide text-bs-text-faint">Operations</div>
            <div className="flex flex-col gap-2">
              {operations.map((operation) => (
                <div key={`${operation.method}:${operation.path}`} className="rounded border border-bs-border bg-bs-bg-sidebar px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-bs-accent px-1.5 py-0.5 text-[10px] text-bs-accent-text">
                      {operation.method}
                    </span>
                    <span className="font-mono text-bs-text">{operation.path}</span>
                  </div>
                  <div className="mt-1 text-bs-text-muted">{operation.summary ?? operation.id}</div>
                  {operation.inputSchema ? (
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-bs-bg-panel px-2 py-2 text-[10px] text-bs-text-faint">
                      {JSON.stringify(operation.inputSchema, null, 2)}
                    </pre>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded border border-bs-border bg-bs-bg-panel px-5 py-5">
            <div className="mb-4 text-xl text-bs-text">
              {(openapiDocument.info as { title?: string } | undefined)?.title ?? 'API Reference'}
            </div>
            <div className="flex flex-col gap-5">
              {paths.map(([pathKey, methods]) => (
                <div key={pathKey} className="border-l-2 border-bs-accent pl-4">
                  <div className="font-mono text-sm text-bs-text">{pathKey}</div>
                  <div className="mt-2 flex flex-col gap-3">
                    {Object.entries(methods ?? {}).map(([method, spec]) => (
                      <div key={`${method}:${pathKey}`} className="rounded border border-bs-border bg-bs-bg-sidebar px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-bs-bg-active px-2 py-0.5 text-[10px] uppercase tracking-wide text-bs-text">
                            {method}
                          </span>
                          <span className="text-bs-text">{spec?.summary ?? `${method.toUpperCase()} ${pathKey}`}</span>
                        </div>
                        {(spec as { description?: string } | undefined)?.description ? (
                          <div className="mt-2 text-bs-text-muted">
                            {(spec as { description?: string }).description}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {openapiDocument ? (
          <details className="rounded border border-bs-border bg-bs-bg-panel px-4 py-3">
            <summary className="cursor-pointer text-bs-text-faint">raw OpenAPI</summary>
            <pre className="mt-3 overflow-auto whitespace-pre-wrap text-[10px] text-bs-text-muted">
              {JSON.stringify(openapiDocument, null, 2)}
            </pre>
          </details>
        ) : null}
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
  const showSidebar = useLayoutStore((state) => state.showSidebar)
  const showBottom = useLayoutStore((state) => state.showBottom)
  const showRight = useLayoutStore((state) => state.showRight)

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
              <span className="text-bs-text">{request.operationId}</span>
              <span className="text-bs-text-faint">{request.method}</span>
              <span className="truncate text-bs-text-muted">{request.path}</span>
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

function InspectSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-bs-border bg-bs-bg-panel px-3 py-3">
      <div className="mb-2 uppercase tracking-[0.16em] text-bs-text-faint">{title}</div>
      {children}
    </div>
  )
}
