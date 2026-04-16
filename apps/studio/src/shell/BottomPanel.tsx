import { useState } from 'react'
import { selectRuntimeIsStale, useRuntimeStore } from '../store/runtime'
import { useDatabaseStore } from '../store/database'
import { useServerDatabaseStore } from '../store/serverDatabase'
import { BuildPanel } from './BuildPanel'
import { HistoryPanel } from './HistoryPanel'
import { NamespaceDashboard } from './NamespaceDashboard'
import { TrustPanel } from './TrustPanel'
import { useWorkspaceStore, type BottomPanelId, type EditorViewId } from '../store/workspace'
import { useLayoutStore } from '../store/layout'

const tabs: Array<{ id: BottomPanelId; label: string; body: string }> = [
  { id: 'logs', label: 'Logs', body: 'log output will stream here' },
  { id: 'calls', label: 'Calls', body: 'incoming calls will appear here' },
  { id: 'client', label: 'Client', body: 'client playground output will appear here' },
  { id: 'data', label: 'Data', body: 'local database tables will appear here' },
  { id: 'trust', label: 'Trust', body: 'host identity and known hosts will appear here' },
  { id: 'namespace', label: 'Account', body: 'namespace ownership and requests will appear here' },
  { id: 'history', label: 'History', body: 'project checkpoints will appear here' },
  { id: 'build', label: 'Build', body: 'build output will appear here' },
  { id: 'problems', label: 'Problems', body: 'no problems' },
]

interface BottomPanelProps {
  onCreateCheckpoint: (name: string, note?: string) => Promise<void>
  collapsed?: boolean
  onRestore?: () => void
  onStartTabDrag: (viewId: EditorViewId) => void
  onEndTabDrag: () => void
}

const bottomTabToViewId: Record<BottomPanelId, EditorViewId> = {
  logs: 'logs',
  calls: 'calls',
  client: 'client',
  data: 'data',
  trust: 'trust',
  namespace: 'namespace',
  history: 'history',
  build: 'build',
  problems: 'problems',
}

export function BottomPanel({ onCreateCheckpoint, collapsed = false, onRestore, onStartTabDrag, onEndTabDrag }: BottomPanelProps) {
  const active = useWorkspaceStore((state) => state.activeBottomPanel)
  const activeFilePath = useWorkspaceStore((state) => state.activeFilePath)
  const dirtyFilePaths = useWorkspaceStore((state) => state.dirtyFilePaths)
  const saveState = useWorkspaceStore((state) => state.saveState)
  const setActive = useWorkspaceStore((state) => state.setActiveBottomPanel)
  const setActivePanel = useWorkspaceStore((state) => state.setActivePanel)
  const toggleBottom = useLayoutStore((state) => state.toggleBottom)
  const logs = useRuntimeStore((state) => state.logs)
  const requests = useRuntimeStore((state) => state.requests)
  const activeRequestId = useRuntimeStore((state) => state.activeRequestId)
  const selectRequest = useRuntimeStore((state) => state.selectRequest)
  const clearRuntimeHistory = useRuntimeStore((state) => state.clearRuntimeHistory)
  const clientRun = useRuntimeStore((state) => state.clientRun)
  const runClientFile = useRuntimeStore((state) => state.runClientFile)
  const clientTargetUrl = useRuntimeStore((state) => state.clientTargetUrl)
  const setClientTargetUrl = useRuntimeStore((state) => state.setClientTargetUrl)
  const clearClientRun = useRuntimeStore((state) => state.clearClientRun)
  const diagnostics = useRuntimeStore((state) => state.diagnostics)
  const compiledCode = useRuntimeStore((state) => state.compiledCode)
  const runtimeLanguage = useRuntimeStore((state) => state.language)
  const runtimeStatus = useRuntimeStore((state) => state.status)
  const launchable = useRuntimeStore((state) => state.launchable)
  const launchNote = useRuntimeStore((state) => state.launchNote)
  const runtimeIsStale = useRuntimeStore(selectRuntimeIsStale)
  const localTables = useDatabaseStore((state) => state.tables)
  const localActiveTableName = useDatabaseStore((state) => state.activeTableName)
  const databaseSaveState = useDatabaseStore((state) => state.saveState)
  const filter = useDatabaseStore((state) => state.filter)
  const setFilter = useDatabaseStore((state) => state.setFilter)
  const setLocalActiveTable = useDatabaseStore((state) => state.setActiveTable)
  const updateCell = useDatabaseStore((state) => state.updateCell)
  const insertRow = useDatabaseStore((state) => state.insertRow)
  const deleteRow = useDatabaseStore((state) => state.deleteRow)
  const serverTables = useServerDatabaseStore((state) => state.tables)
  const serverActiveTableName = useServerDatabaseStore((state) => state.activeTableName)
  const setServerActiveTable = useServerDatabaseStore((state) => state.setActiveTable)
  const serverConnectedName = useServerDatabaseStore((state) => state.connectedServerName)
  const serverError = useServerDatabaseStore((state) => state.error)
  const refreshServerTables = useServerDatabaseStore((state) => state.refresh)
  const [dataSource, setDataSource] = useState<'local' | 'server'>('local')
  const isServer = dataSource === 'server'
  const tables = isServer ? serverTables : localTables
  const activeTableName = isServer ? serverActiveTableName : localActiveTableName
  const setActiveTable = isServer ? setServerActiveTable : setLocalActiveTable
  const activeTab = tabs.find((tab) => tab.id === active) ?? tabs[0]
  const activeTable = tables.find((table) => table.name === activeTableName) ?? tables[0] ?? null
  const filteredRows = activeTable
    ? activeTable.rows.filter((row) => {
        if (!filter.trim()) return true
        const haystack = Object.values(row.values).join(' ').toLowerCase()
        return haystack.includes(filter.trim().toLowerCase())
      })
    : []

  return (
    <div
      className={`${collapsed ? 'h-[26px] cursor-pointer hover:bg-bs-bg-hover' : 'h-full'} flex flex-col overflow-hidden bg-bs-bg-panel`}
      onMouseDown={() => setActivePanel('bottom')}
      onClick={collapsed ? onRestore : undefined}
    >
      {/* Tab bar */}
      <div className="flex-none h-[26px] flex items-center gap-0 border-b border-bs-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', tab.id)
              onStartTabDrag(bottomTabToViewId[tab.id])
            }}
            onDragEnd={onEndTabDrag}
            onClick={() => {
              setActive(tab.id)
            }}
            className={`h-full px-3 text-[11px] ${
              tab.id === active
                ? 'text-bs-text border-b border-b-bs-accent'
                : 'text-bs-text-faint hover:text-bs-text-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <button
          onClick={collapsed ? undefined : toggleBottom}
          className="flex-1 self-stretch"
          aria-label={collapsed ? 'Restore bottom panel' : 'Collapse bottom panel'}
          title={collapsed ? 'Restore bottom panel' : 'Collapse bottom panel'}
        />
        {(active === 'logs' || active === 'calls' || active === 'client') ? (
          <button
            onClick={() => {
              if (active === 'client') {
                clearClientRun()
              } else {
                clearRuntimeHistory()
              }
            }}
            className="px-3 text-[10px] text-bs-text-faint hover:text-bs-text"
          >
            clear
          </button>
        ) : null}
        <button
          onClick={(event) => {
            event.stopPropagation()
            if (!collapsed) {
              toggleBottom()
            }
          }}
          className="px-2 text-[11px] text-bs-text-faint hover:text-bs-text"
          aria-label={collapsed ? 'Restore bottom panel' : 'Collapse bottom panel'}
          title={collapsed ? 'Restore bottom panel' : 'Collapse bottom panel'}
        >
          {collapsed ? '˄' : '˅'}
        </button>
      </div>

      {collapsed ? null : (
      <div className="flex-1 overflow-auto p-2 font-mono text-[11px] text-bs-text-muted">
        {activeTab.id === 'logs' ? (
          <div className="flex flex-col gap-1">
            {logs.length > 0 ? logs.map((entry) => (
              <div key={entry.id} className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-1">
                <div className="flex items-center gap-2">
                  <span className="uppercase text-bs-text-faint">{entry.level}</span>
                  <span className="text-bs-text">{entry.message}</span>
                </div>
              </div>
            )) : (
              <span className="text-bs-text-faint">- runtime logs will stream here -</span>
            )}
          </div>
        ) : null}

        {activeTab.id === 'calls' ? (
          <div className="flex flex-col gap-1">
            {requests.length > 0 ? requests.map((request) => (
              <button
                key={request.id}
                onClick={() => selectRequest(request.id)}
                className={`w-full rounded border px-2 py-1 text-left ${
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
              <span className="text-bs-text-faint">- runtime calls will appear here -</span>
            )}
          </div>
        ) : null}

        {activeTab.id === 'client' ? (
          <div className="flex flex-col gap-2">
            <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-1">
              <div className="mt-1 flex items-center gap-2">
                <input
                  value={clientTargetUrl}
                  onChange={(event) => setClientTargetUrl(event.target.value)}
                  placeholder={launchNote ?? 'css://hello'}
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded border border-bs-border bg-bs-bg-panel px-2 py-1 text-[10px] text-bs-text outline-none focus:border-bs-border-focus"
                />
                <button
                  onClick={() => void runClientFile(activeFilePath)}
                  className="flex h-[24px] w-[24px] items-center justify-center rounded bg-bs-good text-bs-accent-text hover:opacity-90"
                  aria-label="Run client"
                  title="Run client"
                >
                  ▶
                </button>
                <span className="text-bs-text-faint">
                  {clientRun
                    ? `${clientRun.status}${clientRun.durationMs ? ` / ${clientRun.durationMs}ms` : ''}`
                    : activeTab.body}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-bs-text-faint">
                client file: {activeFilePath || 'none selected'}
              </div>
            </div>
            {clientRun ? (
              <>
                <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-1">
                  <div className="text-bs-text">status: {clientRun.status}</div>
                  <div className="text-bs-text-faint">{clientRun.filePath}</div>
                  <div className="text-bs-text-faint">{clientRun.targetUrl ?? clientTargetUrl ?? 'no target'}</div>
                  {clientRun.error ? <div className="text-bs-error">{clientRun.error}</div> : null}
                  {typeof clientRun.result !== 'undefined' ? (
                    <pre className="mt-1 overflow-auto whitespace-pre-wrap text-[10px] text-bs-text-muted">
                      {JSON.stringify(clientRun.result, null, 2)}
                    </pre>
                  ) : null}
                </div>
                <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
                  <div className="mb-1 text-bs-text-faint">console</div>
                  {clientRun.logs.length > 0 ? (
                    <pre className="overflow-auto whitespace-pre-wrap text-[10px] text-bs-text-muted">
                      {clientRun.logs.join('\n')}
                    </pre>
                  ) : (
                    <span className="text-bs-text-faint">- no client console output -</span>
                  )}
                </div>
                {clientRun.compiledCode ? (
                  <details className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-1">
                    <summary className="cursor-pointer text-bs-text-faint">compiled client</summary>
                    <pre className="mt-1 overflow-auto whitespace-pre-wrap text-[10px] text-bs-text-muted">
                      {clientRun.compiledCode}
                    </pre>
                  </details>
                ) : null}
              </>
            ) : (
              <span className="text-bs-text-faint">- run the active `client.ts` file against the launched runtime -</span>
            )}
          </div>
        ) : null}

        {activeTab.id === 'data' ? (
          <div className="flex h-full min-h-0 gap-2">
            <div className="flex w-52 flex-none flex-col gap-1 overflow-auto rounded border border-bs-border bg-bs-bg-sidebar p-2">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setDataSource('local')}
                  className={`flex-1 rounded px-2 py-0.5 text-[10px] ${dataSource === 'local' ? 'bg-bs-bg-active text-bs-text' : 'text-bs-text-faint hover:text-bs-text'}`}
                >local</button>
                <button
                  onClick={() => setDataSource('server')}
                  className={`flex-1 rounded px-2 py-0.5 text-[10px] ${dataSource === 'server' ? 'bg-bs-bg-active text-bs-text' : 'text-bs-text-faint hover:text-bs-text'}`}
                >server</button>
              </div>
              <div className="text-bs-text">tables</div>
              <div className="text-[10px] text-bs-text-faint">
                {isServer
                  ? (serverConnectedName ? `live: ${serverConnectedName}` : 'server not running')
                  : `storage: ${databaseSaveState}`}
              </div>
              {isServer && serverError ? <div className="text-[10px] text-bs-error">{serverError}</div> : null}
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
                <span className="text-bs-text-faint">- no local tables yet -</span>
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
                {activeTable && !isServer ? (
                  <button
                    onClick={() => insertRow(activeTable.name)}
                    className="rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text hover:bg-bs-bg-active"
                  >
                    add row
                  </button>
                ) : null}
                {isServer ? (
                  <button
                    onClick={() => void refreshServerTables()}
                    className="rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text hover:bg-bs-bg-active"
                  >
                    refresh
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
                                readOnly={isServer}
                                onChange={(event) => {
                                  if (isServer) return
                                  updateCell(activeTable.name, row.id, column.name, event.target.value)
                                }}
                                className={`w-full rounded border border-transparent px-1 py-1 text-bs-text outline-none focus:border-bs-border-focus ${isServer ? 'bg-bs-bg-sidebar text-bs-text-muted' : 'bg-bs-bg-panel'}`}
                              />
                            </td>
                          ))}
                          <td className="px-2 py-1 align-top">
                            {isServer ? (
                              <span className="text-bs-text-faint">read-only</span>
                            ) : (
                              <button
                                onClick={() => deleteRow(activeTable.name, row.id)}
                                className="rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text-faint hover:text-bs-text"
                              >
                                delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredRows.length === 0 ? (
                    <div className="px-2 py-2 text-bs-text-faint">- no rows match this filter -</div>
                  ) : null}
                </div>
              ) : (
                <span className="text-bs-text-faint">- local database tables will appear here -</span>
              )}
            </div>
          </div>
        ) : null}

        {activeTab.id === 'trust' ? <TrustPanel /> : null}

        {activeTab.id === 'namespace' ? <NamespaceDashboard /> : null}

        {activeTab.id === 'history' ? <HistoryPanel onCreateCheckpoint={onCreateCheckpoint} /> : null}

        {activeTab.id === 'build' ? (
          <div className="flex h-full flex-col gap-2">
            <BuildPanel />
            <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-1">
              <div className="text-bs-text">runtime: {runtimeLanguage ?? 'unknown'} / {runtimeStatus}</div>
              <div className="text-bs-text-faint">
                {saveState === 'saving'
                  ? `persisting ${activeFilePath}`
                  : dirtyFilePaths.length > 0
                    ? `${dirtyFilePaths.length} file(s) changed since hydrate`
                    : 'workspace storage is idle'}
              </div>
              {runtimeIsStale ? <div className="text-bs-warn">source changed since launch; restart to rebuild</div> : null}
              {!launchable && launchNote ? <div className="text-bs-text-faint">{launchNote}</div> : null}
            </div>
            {compiledCode ? (
              <pre className="overflow-auto rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2 whitespace-pre-wrap text-[10px] text-bs-text-muted">
                {compiledCode}
              </pre>
            ) : (
              <span className="text-bs-text-faint">
                - {runtimeLanguage === 'python' ? 'compiled output will come from plat_browser once integrated' : 'launch the runtime to capture compiled output'} -
              </span>
            )}
          </div>
        ) : null}

        {activeTab.id === 'problems' ? (
          <div className="flex flex-col gap-1">
            {diagnostics.length > 0 ? diagnostics.map((diagnostic) => (
              <div key={`${diagnostic.code}-${diagnostic.line ?? 0}-${diagnostic.column ?? 0}`} className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-1">
                <div className="flex items-center gap-2">
                  <span className={diagnostic.category === 'error' ? 'text-bs-error' : 'text-bs-warn'}>
                    {diagnostic.category}
                  </span>
                  <span className="text-bs-text">TS{diagnostic.code}</span>
                  <span className="text-bs-text-faint">
                    {diagnostic.line ? `L${diagnostic.line}:${diagnostic.column ?? 1}` : 'no location'}
                  </span>
                </div>
                <div className="mt-1 text-bs-text-muted">{diagnostic.message}</div>
              </div>
            )) : (
              <span className="text-bs-text-faint">- {launchable ? 'no compile problems' : launchNote ?? 'no problems'} -</span>
            )}
          </div>
        ) : null}
      </div>
      )}
    </div>
  )
}
