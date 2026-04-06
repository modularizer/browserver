import { useState } from 'react'
import { useCheckpointStore } from '../store/checkpoints'
import { useWorkspaceStore } from '../store/workspace'

interface HistoryPanelProps {
  onCreateCheckpoint: (name: string, note?: string) => Promise<void>
}

function formatTime(value: number) {
  return new Date(value).toLocaleString()
}

export function HistoryPanel({ onCreateCheckpoint }: HistoryPanelProps) {
  const sample = useWorkspaceStore((state) => state.sample)
  const saveState = useCheckpointStore((state) => state.saveState)
  const items = useCheckpointStore((state) => state.items)
  const restoreCheckpoint = useCheckpointStore((state) => state.restoreCheckpoint)
  const deleteCheckpoint = useCheckpointStore((state) => state.deleteCheckpoint)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')

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

      <div className="min-w-0 flex-1 overflow-auto rounded border border-bs-border bg-bs-bg-sidebar p-2">
        <div className="mb-2 text-bs-text">history</div>
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
