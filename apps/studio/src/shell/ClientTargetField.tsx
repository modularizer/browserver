import { useEffect, useMemo, useRef, useState } from 'react'
import { useRuntimeStore, type ServerEntry } from '../store/runtime'
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
  const tabSessions = useRuntimeStore((state) => state.tabSessions)
  const discoveredServers = useRuntimeStore((state) => state.discoveredServers)
  const discoveryStatus = useRuntimeStore((state) => state.discoveryStatus)
  const discoverServers = useRuntimeStore((state) => state.discoverServers)
  const switchTarget = useRuntimeStore((state) => state.switchTarget)
  const placeholder = connectionUrl ?? (serverName ? `css://${serverName}` : 'css://hello')

  const localServers = useMemo(() => {
    return Object.entries(tabSessions)
      .filter(([, session]) => session.mode === 'server' && (session.status === 'running' || session.status === 'starting'))
      .map(([filePath, session]): ServerEntry => ({
        id: `local:${filePath}`,
        source: 'local',
        serverName: session.serverName ?? filePath.split('/').pop() ?? 'unknown',
        connectionUrl: session.connectionUrl,
        status: session.status === 'running' ? 'running' : 'unknown',
        filePath,
      }))
  }, [tabSessions])

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

    // Remove URLs that are already covered by local or discovered servers
    const serverUrls = new Set<string>()
    for (const s of localServers) {
      if (s.connectionUrl) serverUrls.add(s.connectionUrl)
      serverUrls.add(`css://${s.serverName}`)
    }
    for (const d of discoveredServers) {
      serverUrls.add(`css://${d.serverName}`)
    }

    return Array.from(found)
      .filter((value) => value && !serverUrls.has(value))
      .slice(0, 12)
  }, [connectionUrl, discoveredServers, files, localServers, serverName])

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

  const recentItems = recentClientTargets.filter((value) => {
    if (value === clientTargetUrl) return false
    // Exclude items that match a local or discovered server
    for (const s of localServers) {
      if (value === s.connectionUrl || value === `css://${s.serverName}`) return false
    }
    for (const d of discoveredServers) {
      if (value === `css://${d.serverName}`) return false
    }
    return true
  })
  const inferredItems = inferredTargets.filter(
    (value) => value !== clientTargetUrl && !recentClientTargets.includes(value),
  )

  const handleServerPick = (entry: ServerEntry) => {
    void switchTarget(entry)
    setOpen(false)
  }

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
          {localServers.length > 0 ? (
            <>
              <div className="border-b border-bs-border bg-bs-bg-sidebar px-3 py-1 text-[10px] uppercase tracking-wide text-bs-text-faint">
                Local Servers
              </div>
              {localServers.map((entry) => (
                <ServerSuggestionButton
                  key={entry.id}
                  entry={entry}
                  onPick={() => handleServerPick(entry)}
                />
              ))}
            </>
          ) : null}

          {discoveredServers.length > 0 ? (
            <>
              <div className="flex items-center border-b border-t border-bs-border bg-bs-bg-sidebar px-3 py-1">
                <span className="text-[10px] uppercase tracking-wide text-bs-text-faint">Discovered</span>
                <div className="flex-1" />
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void discoverServers()
                  }}
                  disabled={discoveryStatus === 'discovering'}
                  className="text-[10px] text-bs-text-faint hover:text-bs-text disabled:opacity-50"
                >
                  {discoveryStatus === 'discovering' ? 'scanning...' : 'refresh'}
                </button>
              </div>
              {discoveredServers.map((d) => {
                const entry: ServerEntry = {
                  id: `discovered:${d.instanceId}`,
                  source: 'discovered',
                  serverName: d.serverName,
                  connectionUrl: `css://${d.serverName}`,
                  status: 'unknown',
                  instanceInfo: d.instanceInfo,
                  workerInfo: d.workerInfo,
                  mqttChallengeVerified: d.mqttChallengeVerified,
                }
                return (
                  <ServerSuggestionButton
                    key={entry.id}
                    entry={entry}
                    onPick={() => handleServerPick(entry)}
                  />
                )
              })}
            </>
          ) : null}

          {recentItems.length > 0 ? (
            <>
              <div className="border-b border-t border-bs-border bg-bs-bg-sidebar px-3 py-1 text-[10px] uppercase tracking-wide text-bs-text-faint">
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

          {localServers.length === 0 && discoveredServers.length === 0 && recentItems.length === 0 && inferredItems.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-bs-text-faint">No servers or targets found</div>
          ) : null}

          {discoveredServers.length === 0 ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                void discoverServers()
              }}
              disabled={discoveryStatus === 'discovering'}
              className="block w-full border-t border-bs-border px-3 py-2 text-left text-[11px] text-bs-text-faint hover:bg-bs-bg-hover hover:text-bs-text disabled:opacity-50"
            >
              {discoveryStatus === 'discovering' ? 'Discovering servers...' : 'Discover servers...'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ServerSuggestionButton({
  entry,
  onPick,
}: {
  entry: ServerEntry
  onPick: () => void
}) {
  const url = entry.connectionUrl ?? `css://${entry.serverName}`

  return (
    <button
      onClick={onPick}
      className="block w-full border-b border-bs-border px-3 py-2 text-left hover:bg-bs-bg-hover"
      title={url}
    >
      <div className="flex items-center gap-2">
        <div
          className={`h-1.5 w-1.5 flex-none rounded-full ${
            entry.status === 'running' ? 'bg-bs-good' : 'bg-bs-text-faint'
          }`}
        />
        <span className="flex-1 truncate text-[11px] text-bs-text font-medium">{entry.serverName}</span>
        <span className="text-[9px] uppercase text-bs-text-faint">{entry.source}</span>
      </div>
      <div className="mt-0.5 truncate text-[10px] text-bs-text-muted pl-3.5">{url}</div>
      {entry.source === 'discovered' && entry.instanceInfo?.version ? (
        <div className="mt-0.5 flex items-center gap-2 pl-3.5 text-[10px] text-bs-text-faint">
          <span>v{entry.instanceInfo.version}</span>
          {entry.mqttChallengeVerified ? <span className="text-bs-good">verified</span> : null}
        </div>
      ) : null}
    </button>
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
