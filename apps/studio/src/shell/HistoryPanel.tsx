import { useEffect, useMemo, useState } from 'react'
import { useCheckpointStore } from '../store/checkpoints'
import { transactionTouchesFilePath, useHistoryStore } from '../store/history'
import { selectActiveFile, useWorkspaceStore } from '../store/workspace'

interface HistoryPanelProps {
  onCreateCheckpoint: (name: string, note?: string) => Promise<void>
}

function formatTime(value: number) {
  return new Date(value).toLocaleString()
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index])
}

export function HistoryPanel({ onCreateCheckpoint }: HistoryPanelProps) {
  const sample = useWorkspaceStore((state) => state.sample)
  const activeFile = useWorkspaceStore(selectActiveFile)
  const saveState = useCheckpointStore((state) => state.saveState)
  const items = useCheckpointStore((state) => state.items)
  const transactions = useHistoryStore((state) => state.items)
  const squashTransactions = useHistoryStore((state) => state.squashTransactions)
  const renameTransaction = useHistoryStore((state) => state.renameTransaction)
  const restoreCheckpoint = useCheckpointStore((state) => state.restoreCheckpoint)
  const deleteCheckpoint = useCheckpointStore((state) => state.deleteCheckpoint)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([])
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null)
  const [isSquashMode, setIsSquashMode] = useState(false)
  const [renamingTxId, setRenamingTxId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [historyScope, setHistoryScope] = useState<'all' | 'focused'>('all')

  const activeFilePath = activeFile?.path ?? null
  const filteredTransactions = useMemo(() => {
    if (historyScope === 'focused' && activeFilePath) {
      return transactions.filter((entry) => transactionTouchesFilePath(entry, activeFilePath))
    }
    return transactions
  }, [historyScope, activeFilePath, transactions])
  const txRows = useMemo(() => filteredTransactions.slice().reverse().slice(0, 30), [filteredTransactions])

  const selectTx = (id: string, shiftKey: boolean) => {
    if (!shiftKey || !selectionAnchorId) {
      setSelectionAnchorId(id)
      setSelectedTxIds((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]))
      return
    }

    const anchorIndex = txRows.findIndex((entry) => entry.id === selectionAnchorId)
    const targetIndex = txRows.findIndex((entry) => entry.id === id)
    if (anchorIndex === -1 || targetIndex === -1) {
      setSelectionAnchorId(id)
      setSelectedTxIds([id])
      return
    }

    const start = Math.min(anchorIndex, targetIndex)
    const end = Math.max(anchorIndex, targetIndex)
    setSelectedTxIds(txRows.slice(start, end + 1).map((entry) => entry.id))
  }

  const selectedIndexes = selectedTxIds
    .map((id) => transactions.findIndex((entry) => entry.id === id))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)
  const hasConsecutiveSelection = selectedIndexes.length >= 2
    && selectedIndexes.every((value, index) => index === 0 || value === selectedIndexes[index - 1] + 1)
  const canEnterSquashMode = txRows.length >= 2

  useEffect(() => {
    if (historyScope === 'focused' && !activeFile) {
      setHistoryScope('all')
    }
  }, [historyScope, activeFile])

  useEffect(() => {
    const visibleIds = new Set(txRows.map((entry) => entry.id))
    setSelectedTxIds((current) => {
      const next = current.filter((id) => visibleIds.has(id))
      return sameIds(current, next) ? current : next
    })
    setSelectionAnchorId((current) => (current && visibleIds.has(current) ? current : null))
  }, [historyScope, activeFilePath, txRows])

  return (
    <div className="flex h-full min-h-0 gap-2">
      <div className="flex w-72 flex-none flex-col gap-2 rounded border border-bs-border bg-bs-bg-sidebar p-2">
        <div>
          <div className="text-bs-text">project checkpoints</div>
          <div className="text-[10px] text-bs-text-faint">
            {sample.name} / storage: {saveState}
          </div>
        </div>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="checkpoint name"
          className="rounded border border-bs-border bg-bs-bg-panel px-2 py-1 text-[11px] text-bs-text outline-none focus:border-bs-border-focus"
        />
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="note (optional)"
          spellCheck={false}
          className="h-24 resize-y rounded border border-bs-border bg-bs-bg-panel px-2 py-1 text-[11px] text-bs-text outline-none focus:border-bs-border-focus"
        />
        <button
          onClick={() => {
            const nextName = name.trim() || `Checkpoint ${new Date().toLocaleTimeString()}`
            void onCreateCheckpoint(nextName, note.trim() || undefined).then(() => {
              setName('')
              setNote('')
            })
          }}
          className="rounded bg-bs-bg-hover px-2 py-1 text-bs-text hover:bg-bs-bg-active"
        >
          save checkpoint
        </button>
      </div>

      <div className="bs-scrollbar min-w-0 flex-1 overflow-auto rounded border border-bs-border bg-bs-bg-sidebar p-2">
        <div className="mb-2 text-bs-text">history</div>
        <div className="mb-2 inline-flex rounded border border-bs-border bg-bs-bg-panel p-0.5 text-[10px]">
          <button
            onClick={() => setHistoryScope('all')}
            className={`rounded px-2 py-0.5 ${historyScope === 'all' ? 'bg-bs-bg-active text-bs-text' : 'text-bs-text-faint hover:text-bs-text'}`}
          >
            all
          </button>
          <button
            onClick={() => setHistoryScope('focused')}
            disabled={!activeFile}
            className={`rounded px-2 py-0.5 ${historyScope === 'focused' ? 'bg-bs-bg-active text-bs-text' : 'text-bs-text-faint hover:text-bs-text'} ${activeFile ? '' : 'opacity-60'}`}
            title={activeFile ? `Show only ${activeFile.name}` : 'Open a file to filter history'}
          >
            focused file
          </button>
        </div>
        <div className="mb-3 rounded border border-bs-border bg-bs-bg-panel px-3 py-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-[0.12em] text-bs-text-faint">editor transactions</div>
            {isSquashMode ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setIsSquashMode(false)
                    setSelectedTxIds([])
                    setSelectionAnchorId(null)
                  }}
                  className="rounded px-2 py-0.5 text-[10px] text-bs-text-faint hover:bg-bs-bg-hover hover:text-bs-text"
                  title="Exit squash mode"
                >
                  cancel
                </button>
                <button
                  onClick={() => {
                    void squashTransactions(selectedTxIds).then((ok) => {
                      if (ok) {
                        setSelectedTxIds([])
                        setSelectionAnchorId(null)
                        setIsSquashMode(false)
                      }
                    })
                  }}
                  disabled={!hasConsecutiveSelection}
                  className={`rounded px-2 py-0.5 text-[10px] ${
                    hasConsecutiveSelection
                      ? 'bg-bs-bg-hover text-bs-text hover:bg-bs-bg-active'
                      : 'bg-bs-bg-panel text-bs-text-faint opacity-60'
                  }`}
                  title={hasConsecutiveSelection ? 'Squash selected consecutive transactions' : 'Select at least two consecutive transactions'}
                >
                  squash selected
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsSquashMode(true)}
                disabled={!canEnterSquashMode}
                className={`rounded px-2 py-0.5 text-[10px] ${
                  canEnterSquashMode
                    ? 'bg-bs-bg-hover text-bs-text hover:bg-bs-bg-active'
                    : 'bg-bs-bg-panel text-bs-text-faint opacity-60'
                }`}
                title={canEnterSquashMode ? 'Enable squash mode' : 'Need at least two transactions to squash'}
              >
                start squash
              </button>
            )}
          </div>
            <div className="mt-2 flex flex-col gap-1">
              {txRows.length > 0 ? txRows.map((tx) => (
                <div
                  key={tx.id}
                  className={`group flex items-center gap-2 rounded px-1 py-1 text-[11px] select-none ${
                    isSquashMode
                      ? `cursor-pointer ${selectedTxIds.includes(tx.id) ? 'bg-bs-bg-active' : 'hover:bg-bs-bg-hover'}`
                      : 'cursor-default hover:bg-bs-bg-hover/50'
                  }`}
                  onClick={(event) => {
                    if (!isSquashMode) return
                    event.preventDefault()
                    selectTx(tx.id, event.shiftKey)
                  }}
                  onKeyDown={(event) => {
                    if (!isSquashMode) return
                    if (event.key === ' ' || event.key === 'Enter') {
                      event.preventDefault()
                      selectTx(tx.id, event.shiftKey)
                    }
                  }}
                  role={isSquashMode ? 'checkbox' : undefined}
                  tabIndex={isSquashMode ? 0 : undefined}
                  aria-checked={isSquashMode ? selectedTxIds.includes(tx.id) : undefined}
                >
                  {isSquashMode && (
                    <input
                      type="checkbox"
                      checked={selectedTxIds.includes(tx.id)}
                      onChange={() => {}}
                      onClick={(event) => {
                        event.stopPropagation()
                      }}
                      className="pointer-events-none h-3 w-3 rounded border-bs-border bg-bs-bg-panel"
                    />
                  )}
                  {renamingTxId === tx.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => {
                        if (renameValue.trim()) {
                          void renameTransaction(tx.id, renameValue).then(() => {
                            setRenamingTxId(null)
                            setRenameValue('')
                          })
                        } else {
                          setRenamingTxId(null)
                          setRenameValue('')
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          if (renameValue.trim()) {
                            void renameTransaction(tx.id, renameValue).then(() => {
                              setRenamingTxId(null)
                              setRenameValue('')
                            })
                          }
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          setRenamingTxId(null)
                          setRenameValue('')
                        }
                      }}
                      onClick={(event) => event.stopPropagation()}
                      className="w-full rounded border border-bs-border-focus bg-bs-bg-editor px-1 py-0 text-[11px] text-bs-text outline-none"
                    />
                  ) : (
                    <>
                      <span className="flex-1 text-bs-text">{tx.label}</span>
                      <button
                        onClick={(event) => {
                          event.stopPropagation()
                          setRenamingTxId(tx.id)
                          setRenameValue(tx.label)
                        }}
                        className="invisible rounded px-1 text-[10px] text-bs-text-faint hover:bg-bs-bg-active hover:text-bs-text group-hover:visible"
                        title="Rename transaction"
                      >
                        ✎
                      </button>
                    </>
                  )}
                  <span className="text-bs-text-faint">{formatTime(tx.ts)}</span>
                </div>
              )) : (
                <div className="text-[11px] text-bs-text-faint">- no editor transactions yet -</div>
              )}
            </div>
        </div>
        <div className="flex flex-col gap-2">
          {items.length > 0 ? items.map((item) => (
            <div key={item.id} className="rounded border border-bs-border bg-bs-bg-panel px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-bs-text">{item.name}</span>
                <span className="text-[10px] text-bs-text-faint">{formatTime(item.createdAt)}</span>
                <div className="flex-1" />
                <button
                  onClick={() => void restoreCheckpoint(item.id)}
                  className="rounded bg-bs-bg-hover px-2 py-0.5 text-[10px] text-bs-text hover:bg-bs-bg-active"
                >
                  restore
                </button>
                <button
                  onClick={() => void deleteCheckpoint(item.id)}
                  className="rounded bg-bs-bg-hover px-2 py-0.5 text-[10px] text-bs-text-faint hover:text-bs-error"
                >
                  delete
                </button>
              </div>
              {item.note ? <div className="mt-1 text-[11px] text-bs-text-muted">{item.note}</div> : null}
              <div className="mt-1 text-[10px] text-bs-text-faint">
                {item.bundle.workspace.files.length} files / {item.bundle.database.tables.length} tables / theme {item.bundle.ui.themeId}
              </div>
            </div>
          )) : (
            <div className="text-bs-text-faint">- no checkpoints yet -</div>
          )}
        </div>
      </div>
    </div>
  )
}
