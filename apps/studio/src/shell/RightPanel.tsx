import { useState } from 'react'
import { useCheckpointStore } from '../store/checkpoints'
import { useDatabaseStore } from '../store/database'
import { selectRuntimeIsStale, useRuntimeStore, type RuntimeRequestEntry } from '../store/runtime'
import { useLayoutStore } from '../store/layout'
import { useTrustStore } from '../store/trust'
import { selectActiveFile, useWorkspaceStore, type EditorViewId } from '../store/workspace'
import type { RuntimeOperation } from '../runtime/types'
import { ServersSection } from './ServersSection'

function formatTime(value: number | undefined) {
  if (!value) return 'n/a'
  return new Date(value).toLocaleString()
}

function shortValue(value: string | undefined) {
  if (!value) return 'n/a'
  return value.length > 32 ? `${value.slice(0, 16)}...${value.slice(-10)}` : value
}

interface RightPanelProps {
  onStartTabDrag: (viewId: EditorViewId) => void
  onEndTabDrag: () => void
}

const rightPanelToViewId: Record<'inspector' | 'client' | 'trust', EditorViewId> = {
  inspector: 'inspect',
  client: 'api',
  trust: 'trust',
}

export function RightPanel({ onStartTabDrag, onEndTabDrag }: RightPanelProps) {
  const sample = useWorkspaceStore((state) => state.sample)
  const files = useWorkspaceStore((state) => state.files)
  const dirtyFilePaths = useWorkspaceStore((state) => state.dirtyFilePaths)
  const saveState = useWorkspaceStore((state) => state.saveState)
  const activeFile = useWorkspaceStore(selectActiveFile)
  const setActivePanel = useWorkspaceStore((state) => state.setActivePanel)
  const activeRightPanelTab = useWorkspaceStore((state) => state.activeRightPanelTab)
  const setActiveRightPanelTab = useWorkspaceStore((state) => state.setActiveRightPanelTab)
  const toggleRight = useLayoutStore((state) => state.toggleRight)
  const runtimeLanguage = useRuntimeStore((state) => state.language)
  const runtimeStatus = useRuntimeStore((state) => state.status)
  const launchable = useRuntimeStore((state) => state.launchable)
  const launchNote = useRuntimeStore((state) => state.launchNote)
  const connectionUrl = useRuntimeStore((state) => state.connectionUrl)
  const runtimeIsStale = useRuntimeStore(selectRuntimeIsStale)
  const operations = useRuntimeStore((state) => state.operations)
  const analysisSummary = useRuntimeStore((state) => state.analysisSummary)
  const diagnostics = useRuntimeStore((state) => state.diagnostics)
  const invokeOperation = useRuntimeStore((state) => state.invokeOperation)
  const invocationDrafts = useRuntimeStore((state) => state.invocationDrafts)
  const setInvocationDraft = useRuntimeStore((state) => state.setInvocationDraft)
  const requests = useRuntimeStore((state) => state.requests)
  const activeRequestId = useRuntimeStore((state) => state.activeRequestId)
  const selectRequest = useRuntimeStore((state) => state.selectRequest)
  const clientRun = useRuntimeStore((state) => state.clientRun)
  const runClientFile = useRuntimeStore((state) => state.runClientFile)
  const clientTargetUrl = useRuntimeStore((state) => state.clientTargetUrl)
  const setClientTargetUrl = useRuntimeStore((state) => state.setClientTargetUrl)
  const errorMessage = useRuntimeStore((state) => state.errorMessage)
  const tables = useDatabaseStore((state) => state.tables)
  const activeTableName = useDatabaseStore((state) => state.activeTableName)
  const databaseSaveState = useDatabaseStore((state) => state.saveState)
  const trustServerName = useTrustStore((state) => state.serverName)
  const publicIdentity = useTrustStore((state) => state.publicIdentity)
  const knownHosts = useTrustStore((state) => state.knownHosts)
  const authorityRecords = useTrustStore((state) => state.authorityRecords)
  const trustSaveState = useTrustStore((state) => state.saveState)
  const checkpoints = useCheckpointStore((state) => state.items)
  const checkpointSaveState = useCheckpointStore((state) => state.saveState)
  const activeRequest = requests.find((request) => request.id === activeRequestId) ?? null
  const activeTable = tables.find((table) => table.name === activeTableName) ?? tables[0] ?? null
  const hostRecord = knownHosts.find((record) => record.serverName === trustServerName) ?? null

  return (
    <div
      className="group relative h-full flex flex-col overflow-hidden bg-bs-bg-panel"
      onMouseDown={() => setActivePanel('inspector')}
    >
      <div
        onClick={toggleRight}
        className="flex h-[30px] cursor-pointer items-center border-b border-bs-border px-2 hover:bg-bs-bg-hover"
        aria-label="Collapse right panel"
        title="Collapse right panel"
        role="button"
      >
        {([
          ['inspector', 'Inspect'],
          ['client', 'Client'],
          ['trust', 'Trust'],
        ] as const).map(([tabId, label]) => (
          <button
            key={tabId}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', tabId)
              onStartTabDrag(rightPanelToViewId[tabId])
            }}
            onDragEnd={onEndTabDrag}
            onClick={() => setActiveRightPanelTab(tabId)}
            className={`rounded px-2 py-1 text-[11px] ${
              activeRightPanelTab === tabId
                ? 'bg-bs-bg-active text-bs-text'
                : 'text-bs-text-faint hover:text-bs-text'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={(event) => {
            event.stopPropagation()
            toggleRight()
          }}
          className="rounded px-1.5 py-0.5 text-bs-text-faint hover:bg-bs-bg-hover hover:text-bs-text"
          aria-label="Collapse right panel"
          title="Collapse right panel"
        >
          ›
        </button>
      </div>
      <button
        onClick={toggleRight}
        className="absolute left-0 top-0 h-full w-[25px] border-r border-transparent hover:border-bs-border hover:bg-bs-bg-hover/80"
        aria-label="Collapse right panel"
        title="Collapse right panel"
      />

      <div className="flex flex-1 flex-col gap-3 overflow-auto p-3 text-[11px]">
        {activeRightPanelTab === 'inspector' ? (
          <>
            <Section title="Runtime">
              <div className="text-bs-text">{runtimeLanguage ?? sample.serverLanguage}</div>
              <div className="text-bs-text">{runtimeStatus}</div>
              <div className="text-bs-text-muted">{launchable ? 'launchable' : 'blocked'}</div>
              <div className="text-bs-text-muted">{runtimeIsStale ? 'restart required' : 'runtime matches current source'}</div>
              <div className="text-bs-text-muted">{connectionUrl ?? 'not running'}</div>
              <div className="text-bs-text-muted">{diagnostics.length} compile diagnostics</div>
              {launchNote ? <div className="text-bs-text-muted">{launchNote}</div> : null}
              {errorMessage ? <div className="text-bs-error">{errorMessage}</div> : null}
            </Section>

            <Section title="Workspace">
              <div className="text-bs-text">{sample.name}</div>
              <div className="text-bs-text-muted">{sample.description}</div>
              <div className="mt-1 text-bs-text-muted">{files.length} tracked files</div>
              <div className="text-bs-text-muted">{dirtyFilePaths.length} dirty files</div>
              <div className="text-bs-text-muted">storage status: {saveState}</div>
            </Section>

            <Section title="Active File">
              <div className="text-bs-text">{activeFile?.name ?? 'No file selected'}</div>
              <div className="text-bs-text-muted">{activeFile?.language ?? 'n/a'}</div>
              <div className="text-bs-text-muted">{dirtyFilePaths.includes(activeFile?.path ?? '') ? 'Modified' : 'Saved'}</div>
            </Section>

            <Section title="Source Analysis">
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
            </Section>

            <Section title="Selected Request">
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
                <div className="text-bs-text-muted">select a call in the bottom panel to inspect it</div>
              )}
            </Section>

            <Section title="Database">
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
            </Section>
          </>
        ) : null}

        {activeRightPanelTab === 'client' ? (
          <div className="flex flex-col gap-6">
            <Section title="Target">
              <div className="flex items-center gap-2">
                <input
                  value={clientTargetUrl}
                  onChange={(event) => setClientTargetUrl(event.target.value)}
                  placeholder={connectionUrl ?? `css://${trustServerName ?? sample.id}`}
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded border border-bs-border bg-bs-bg-panel px-2 py-1 text-[11px] text-bs-text outline-none focus:border-bs-border-focus"
                />
              </div>
            </Section>

            <ServersSection />

            <Section title="Methods">
              <div className="flex flex-col">
                {operations.length > 0 ? (
                  operations.map((operation) => (
                    <OperationItem
                      key={operation.id}
                      operation={operation}
                      draft={invocationDrafts[operation.id] ?? '{}'}
                      setDraft={(val) => setInvocationDraft(operation.id, val)}
                      invoke={invokeOperation}
                      latestRequest={requests.find((r) => r.operationId === operation.id) ?? null}
                    />
                  ))
                ) : (
                  <div className="text-bs-text-muted">Launch the runtime to see available methods</div>
                )}
              </div>
            </Section>

            <Section title="Run Client File">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-bs-text font-medium">{activeFile?.name ?? 'No file selected'}</div>
                  <div className="text-[10px] text-bs-text-faint">Executes the active file as a client</div>
                </div>
                <button
                  onClick={() => void runClientFile(activeFile?.path)}
                  className="flex h-7 px-3 items-center justify-center rounded bg-bs-bg-hover text-bs-text hover:bg-bs-bg-active text-[11px]"
                >
                  Run
                </button>
              </div>
              {clientRun && (
                <div className="mt-2 rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
                  <div className="flex items-center gap-2">
                    <div className={`h-1.5 w-1.5 rounded-full ${clientRun.status === 'success' ? 'bg-bs-good' : clientRun.status === 'error' ? 'bg-bs-error' : 'bg-bs-text-faint'}`} />
                    <span className="text-bs-text font-medium uppercase text-[9px]">{clientRun.status}</span>
                    <span className="text-bs-text-faint ml-auto">{clientRun.durationMs}ms</span>
                  </div>
                  {clientRun.error && <div className="mt-1 text-bs-error text-[10px]">{clientRun.error}</div>}
                  {typeof clientRun.result !== 'undefined' && (
                    <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[10px] text-bs-text-muted max-h-32 border-t border-bs-border pt-2">
                      {JSON.stringify(clientRun.result, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </Section>
          </div>
        ) : null}

        {activeRightPanelTab === 'trust' ? (
          <>
            <Section title="Host Trust">
              <div className="text-bs-text">{trustServerName ?? 'No host identity loaded'}</div>
              <div className="text-bs-text-muted">storage: {trustSaveState}</div>
              <div className="text-bs-text-muted">fingerprint: {shortValue(publicIdentity?.fingerprint)}</div>
              <div className="text-bs-text-muted">key id: {publicIdentity?.keyId ?? 'n/a'}</div>
              <div className="text-bs-text-muted">
                current host: {hostRecord ? `${hostRecord.source} / ${formatTime(hostRecord.trustedAt)}` : 'not pinned'}
              </div>
            </Section>

            <Section title="Known Hosts">
              <div className="text-bs-text-muted">{knownHosts.length} known host(s)</div>
              {knownHosts.slice(0, 5).map((record) => (
                <div key={record.serverName} className="mt-1 rounded border border-bs-border bg-bs-bg-sidebar px-2 py-1">
                  <div className="text-bs-text">{record.serverName}</div>
                  <div className="text-[10px] text-bs-text-faint">{shortValue(record.fingerprint)}</div>
                </div>
              ))}
            </Section>

            <Section title="Authority Records">
              <div className="text-bs-text-muted">{authorityRecords.length} authority record(s)</div>
              <div className="text-bs-text-muted">latest: {authorityRecords[0] ? formatTime(authorityRecords[0].issuedAt) : 'none'}</div>
            </Section>

            <Section title="Checkpoints">
              <div className="text-bs-text-muted">{checkpoints.length} saved checkpoint(s)</div>
              <div className="text-bs-text-muted">storage: {checkpointSaveState}</div>
              <div className="text-bs-text-muted">latest: {checkpoints[0] ? formatTime(checkpoints[0].createdAt) : 'none yet'}</div>
            </Section>
          </>
        ) : null}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 uppercase tracking-[0.16em] text-bs-text-faint">{title}</div>
      {children}
    </div>
  )
}

function OperationItem({
  operation,
  draft,
  setDraft,
  invoke,
  latestRequest,
}: {
  operation: RuntimeOperation
  draft: string
  setDraft: (value: string) => void
  invoke: (id: string) => Promise<unknown>
  latestRequest: RuntimeRequestEntry | null
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="border-b border-bs-border last:border-0">
      <div
        className="flex items-center gap-2 py-2 cursor-pointer hover:bg-bs-bg-hover px-1 -mx-1 rounded"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className={`text-[9px] text-bs-text-faint transition-transform duration-100 ${isExpanded ? 'rotate-90' : ''}`}>
          ▶
        </span>
        <span className="font-mono text-bs-text flex-1 truncate">
          {operation.label}
        </span>
        {latestRequest && (
          <div className={`h-1.5 w-1.5 rounded-full ${latestRequest.ok ? 'bg-bs-good' : 'bg-bs-error'}`} title={latestRequest.ok ? 'Success' : 'Error'} />
        )}
      </div>

      {isExpanded && (
        <div className="pb-3 pl-4 flex flex-col gap-3">
          {operation.summary && (
            <div className="text-bs-text-muted leading-relaxed">{operation.summary}</div>
          )}

          <OperationForm
            operation={operation}
            value={draft}
            onChange={setDraft}
          />

          <div className="flex items-center gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation()
                void invoke(operation.id)
              }}
              className="bg-bs-good text-bs-accent-text px-3 py-1 rounded text-[11px] font-medium hover:opacity-90"
            >
              Run
            </button>
            {latestRequest && (
              <span className="text-[10px] text-bs-text-faint">
                {latestRequest.durationMs}ms
              </span>
            )}
          </div>

          {latestRequest && (
            <div className="bg-bs-bg-sidebar rounded border border-bs-border overflow-hidden">
               <div className="bg-bs-bg-hover px-2 py-1 text-[9px] text-bs-text-faint border-b border-bs-border flex justify-between">
                 <span>Result</span>
                 <span>{new Date(latestRequest.endedAt).toLocaleTimeString()}</span>
               </div>
               <pre className="p-2 text-[10px] text-bs-text-muted overflow-auto max-h-40 whitespace-pre-wrap">
                 {JSON.stringify(latestRequest.ok ? latestRequest.result : latestRequest.error, null, 2)}
               </pre>
            </div>
          )}
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
    <div className="flex flex-col gap-3">
      {Object.entries(properties).map(([key, propSchema]) => {
        const val = json[key]
        const update = (newVal: any) => {
          onChange(JSON.stringify({ ...json, [key]: newVal }, null, 2))
        }

        return (
          <div key={key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[10px] text-bs-text font-medium truncate">{key}</label>
              <span className="text-[9px] text-bs-text-faint uppercase">{propSchema.type}</span>
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
                className="w-full rounded border border-bs-border bg-bs-bg-panel px-2 py-1 text-[11px] text-bs-text outline-none focus:border-bs-border-focus"
              />
            ) : (
              <input
                type="text"
                value={typeof val === 'string' ? val : (val === undefined ? '' : JSON.stringify(val))}
                onChange={e => update(e.target.value)}
                className="w-full rounded border border-bs-border bg-bs-bg-panel px-2 py-1 text-[11px] text-bs-text outline-none focus:border-bs-border-focus"
              />
            )}
            {propSchema.description && (
              <div className="text-[9px] text-bs-text-faint italic">{propSchema.description}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
