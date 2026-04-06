import { useEffect, useMemo, useRef, useState } from 'react'
import { useRuntimeStore } from '../store/runtime'
import { useWorkspaceStore } from '../store/workspace'

interface ClientTargetFieldProps {
  className?: string
}

const urlPattern = /\b(?:https?:\/\/|wss?:\/\/|css:\/\/)[^\s"'`)\]}>,;]+/g

export function ClientTargetField({ className = '' }: ClientTargetFieldProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const files = useWorkspaceStore((state) => state.files)
  const connectionUrl = useRuntimeStore((state) => state.connectionUrl)
  const serverName = useRuntimeStore((state) => state.serverName)
  const clientTargetUrl = useRuntimeStore((state) => state.clientTargetUrl)
  const setClientTargetUrl = useRuntimeStore((state) => state.setClientTargetUrl)
  const recentClientTargets = useRuntimeStore((state) => state.recentClientTargets)
  const placeholder = connectionUrl ?? (serverName ? `css://${serverName}` : 'css://hello')

  const inferredTargets = useMemo(() => {
    const found = new Set<string>()

    for (const file of files) {
      const matches = file.content.match(urlPattern)
      if (!matches) continue
      for (const match of matches) {
        found.add(match.replace(/[)"'`,;]+$/, ''))
      }
    }

    if (connectionUrl) found.add(connectionUrl)
    if (serverName) found.add(`css://${serverName}`)

    return Array.from(found).filter((value) => value).slice(0, 12)
  }, [connectionUrl, files, serverName])

  const bestSuggestion = useMemo(() => {
    return connectionUrl
      ?? (serverName ? `css://${serverName}` : null)
      ?? recentClientTargets[0]
      ?? inferredTargets[0]
      ?? ''
  }, [connectionUrl, inferredTargets, recentClientTargets, serverName])

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (!clientTargetUrl.trim() && bestSuggestion) {
      setClientTargetUrl(bestSuggestion)
    }
  }, [bestSuggestion, clientTargetUrl, setClientTargetUrl])

  const recentItems = recentClientTargets.filter((value) => value !== clientTargetUrl)
  const inferredItems = inferredTargets.filter(
    (value) => value !== clientTargetUrl && !recentClientTargets.includes(value),
  )

  return (
    <div ref={rootRef} className={`relative flex h-[30px] min-w-0 items-stretch gap-0 ${className}`}>
      <input
        value={clientTargetUrl}
        onChange={(event) => setClientTargetUrl(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="min-w-0 flex-1 rounded-l border border-bs-border bg-bs-bg-editor px-2 text-[11px] text-bs-text outline-none focus:border-bs-border-focus"
      />
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex h-[30px] items-center rounded-r border border-l-0 border-bs-border bg-bs-bg-editor px-2 text-bs-text-faint hover:bg-bs-bg-hover hover:text-bs-text"
        aria-label="Open target suggestions"
        title="Open target suggestions"
      >
        ˅
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-[1900] min-w-full overflow-hidden rounded border border-bs-border bg-bs-bg-panel shadow-[0_18px_50px_rgba(0,0,0,0.4)]">
          {recentItems.length > 0 ? (
            <>
              <div className="border-b border-bs-border bg-bs-bg-sidebar px-3 py-1 text-[10px] uppercase tracking-wide text-bs-text-faint">
                Recent
              </div>
              {recentItems.map((target) => (
                <SuggestionButton
                  key={`recent:${target}`}
                  label={target}
                  onPick={() => {
                    setClientTargetUrl(target)
                    setOpen(false)
                  }}
                />
              ))}
            </>
          ) : null}

          {inferredItems.length > 0 ? (
            <>
              <div className="border-b border-t border-bs-border bg-bs-bg-sidebar px-3 py-1 text-[10px] uppercase tracking-wide text-bs-text-faint">
                Suggested From Project
              </div>
              {inferredItems.map((target) => (
                <SuggestionButton
                  key={`suggested:${target}`}
                  label={target}
                  onPick={() => {
                    setClientTargetUrl(target)
                    setOpen(false)
                  }}
                />
              ))}
            </>
          ) : null}

          {recentItems.length === 0 && inferredItems.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-bs-text-faint">No recent or inferred targets yet</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function SuggestionButton({
  label,
  onPick,
}: {
  label: string
  onPick: () => void
}) {
  return (
    <button
      onClick={onPick}
      className="block w-full border-b border-bs-border px-3 py-2 text-left text-[11px] text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text"
      title={label}
    >
      <span className="block truncate">{label}</span>
    </button>
  )
}
