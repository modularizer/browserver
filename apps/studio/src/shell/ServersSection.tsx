import { useMemo } from 'react'
import { evaluateServerAuthorityStatus } from '../runtime/authorityPolicy'
import { useRuntimeStore, type ServerEntry } from '../store/runtime'
import { useIdentityStore } from '../store/identity'
import { useNamespaceStore } from '../store/namespace'

export function ServersSection() {
  const tabSessions = useRuntimeStore((state) => state.tabSessions)
  const discoveredServers = useRuntimeStore((state) => state.discoveredServers)
  const discoveryStatus = useRuntimeStore((state) => state.discoveryStatus)
  const discoveryError = useRuntimeStore((state) => state.discoveryError)
  const lastDiscoveryAt = useRuntimeStore((state) => state.lastDiscoveryAt)
  const discoverServers = useRuntimeStore((state) => state.discoverServers)
  const switchTarget = useRuntimeStore((state) => state.switchTarget)
  const clientTargetUrl = useRuntimeStore((state) => state.clientTargetUrl)
  const connectionUrl = useRuntimeStore((state) => state.connectionUrl)
  const user = useIdentityStore((state) => state.user)
  const namespaces = useNamespaceStore((state) => state.namespaces)

  const activeUrl = clientTargetUrl || connectionUrl || ''

  const servers = useMemo(() => {
    const local: ServerEntry[] = Object.entries(tabSessions)
      .filter(([, session]) => session.mode === 'server' && (session.status === 'running' || session.status === 'starting'))
      .map(([filePath, session]) => ({
        id: `local:${filePath}`,
        source: 'local' as const,
        serverName: session.serverName ?? filePath.split('/').pop() ?? 'unknown',
        connectionUrl: session.connectionUrl,
        status: session.status === 'running' ? 'running' as const : 'unknown' as const,
        filePath,
      }))

    const localNames = new Set(local.map((s) => s.serverName))

    const discovered: ServerEntry[] = discoveredServers
      .filter((d) => !localNames.has(d.serverName))
      .map((d) => ({
        id: `discovered:${d.instanceId}`,
        source: 'discovered' as const,
        serverName: d.serverName,
        connectionUrl: `css://${d.serverName}`,
        status: 'unknown' as const,
        instanceInfo: d.instanceInfo,
        workerInfo: d.workerInfo,
        mqttChallengeVerified: d.mqttChallengeVerified,
      }))

    return [...local, ...discovered]
  }, [tabSessions, discoveredServers])

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <div className="uppercase tracking-[0.16em] text-bs-text-faint">Servers</div>
        <div className="flex-1" />
        {discoveryStatus === 'discovering' ? (
          <span className="text-[10px] text-bs-text-faint animate-pulse">discovering...</span>
        ) : null}
        <button
          onClick={() => void discoverServers()}
          disabled={discoveryStatus === 'discovering'}
          className="rounded bg-bs-bg-hover px-2 py-0.5 text-[10px] text-bs-text-muted hover:bg-bs-bg-active hover:text-bs-text disabled:opacity-50"
        >
          Discover
        </button>
      </div>

      {servers.length > 0 ? (
        <div className="flex flex-col gap-1">
          {servers.map((entry) => (
            <ServerCard
              key={entry.id}
              entry={entry}
              authorityStatus={evaluateServerAuthorityStatus(entry.serverName, user, namespaces)}
              isActive={activeUrl === entry.connectionUrl || activeUrl === `css://${entry.serverName}`}
              onSwitch={() => void switchTarget(entry)}
            />
          ))}
        </div>
      ) : (
        <div className="text-bs-text-muted">
          {discoveryStatus === 'discovering'
            ? 'Searching for servers...'
            : 'No servers found. Launch a server or click Discover.'}
        </div>
      )}

      {discoveryError ? (
        <div className="mt-1 text-[10px] text-bs-error">{discoveryError}</div>
      ) : null}

      {lastDiscoveryAt ? (
        <div className="mt-1 text-[10px] text-bs-text-faint">
          Last discovered: {new Date(lastDiscoveryAt).toLocaleTimeString()}
          {discoveredServers.length > 0 ? ` / ${discoveredServers.length} found` : ''}
        </div>
      ) : null}
    </div>
  )
}

function ServerCard({
  entry,
  authorityStatus,
  isActive,
  onSwitch,
}: {
  entry: ServerEntry
  authorityStatus: ReturnType<typeof evaluateServerAuthorityStatus>
  isActive: boolean
  onSwitch: () => void
}) {
  const url = entry.connectionUrl ?? `css://${entry.serverName}`
  const authorityTone = authorityStatus.allowed
    ? authorityStatus.mode === 'dmz' ? 'text-bs-text-faint' : 'text-bs-good'
    : 'text-bs-error'
  const authorityLabel = authorityStatus.allowed
    ? authorityStatus.mode === 'dmz' ? 'dmz' : 'owned'
    : authorityStatus.mode === 'blocked-anonymous' ? 'sign in'
      : authorityStatus.mode === 'blocked-config' ? 'no authority'
      : 'blocked'

  return (
    <div
      className={`rounded border px-2 py-1.5 cursor-pointer transition-colors ${
        isActive
          ? 'border-bs-accent bg-bs-bg-active'
          : 'border-bs-border bg-bs-bg-sidebar hover:bg-bs-bg-hover'
      }`}
      onClick={onSwitch}
      role="button"
      title={`Switch to ${url}`}
    >
      <div className="flex items-center gap-2">
        <div
          className={`h-1.5 w-1.5 flex-none rounded-full ${
            entry.status === 'running' ? 'bg-bs-good' : 'bg-bs-text-faint'
          }`}
        />
        <span className="flex-1 truncate text-bs-text font-medium">{entry.serverName}</span>
        <span className={`text-[9px] uppercase ${authorityTone}`} title={authorityStatus.reason ?? undefined}>
          {authorityLabel}
        </span>
        <span className="text-[9px] uppercase text-bs-text-faint">{entry.source}</span>
      </div>
      <div className="mt-0.5 truncate text-[10px] text-bs-text-muted">{url}</div>
      {entry.source === 'local' && entry.filePath ? (
        <div className="text-[10px] text-bs-text-faint">{entry.filePath}</div>
      ) : null}
      {entry.source === 'discovered' ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-bs-text-faint">
          {entry.instanceInfo?.version ? <span>v{entry.instanceInfo.version}</span> : null}
          {entry.workerInfo?.weight != null ? <span>weight: {entry.workerInfo.weight}</span> : null}
          {entry.workerInfo?.currentClients != null ? (
            <span>{entry.workerInfo.currentClients} clients</span>
          ) : null}
          {entry.workerInfo?.acceptingNewClients === false ? (
            <span className="text-bs-error">not accepting</span>
          ) : null}
          {entry.mqttChallengeVerified ? <span className="text-bs-good">verified</span> : null}
        </div>
      ) : null}
    </div>
  )
}
