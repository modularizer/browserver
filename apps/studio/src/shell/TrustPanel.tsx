import { useMemo, useState } from 'react'
import { useRuntimeStore } from '../store/runtime'
import { useTrustStore } from '../store/trust'

function formatTime(value: number | undefined) {
  if (!value) return 'n/a'
  return new Date(value).toLocaleString()
}

function shortFingerprint(value: string | undefined) {
  if (!value) return 'n/a'
  return value.length > 24 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value
}

export function TrustPanel() {
  const runtimeStatus = useRuntimeStore((state) => state.status)
  const connectionUrl = useRuntimeStore((state) => state.connectionUrl)
  const requests = useRuntimeStore((state) => state.requests)
  const clientRun = useRuntimeStore((state) => state.clientRun)
  const serverName = useTrustStore((state) => state.serverName)
  const publicIdentity = useTrustStore((state) => state.publicIdentity)
  const knownHosts = useTrustStore((state) => state.knownHosts)
  const authorityRecords = useTrustStore((state) => state.authorityRecords)
  const saveState = useTrustStore((state) => state.saveState)
  const trustCurrentHost = useTrustStore((state) => state.trustCurrentHost)
  const importTrustedHostRecord = useTrustStore((state) => state.importTrustedHostRecord)
  const importAuthorityRecord = useTrustStore((state) => state.importAuthorityRecord)
  const removeTrustedHost = useTrustStore((state) => state.removeTrustedHost)
  const removeAuthorityRecord = useTrustStore((state) => state.removeAuthorityRecord)
  const [trustedHostDraft, setTrustedHostDraft] = useState('')
  const [authorityDraft, setAuthorityDraft] = useState('')
  const hostRecord = useMemo(
    () => knownHosts.find((record) => record.serverName === serverName) ?? null,
    [knownHosts, serverName],
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto">
      <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
        <div className="flex items-center gap-2">
          <span className="text-bs-text">host</span>
          <span className="text-bs-text-muted">{serverName ?? 'n/a'}</span>
          <span className="text-[10px] text-bs-text-faint">storage: {saveState}</span>
          <div className="flex-1" />
          <button
            onClick={() => void trustCurrentHost()}
            className="rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text hover:bg-bs-bg-active"
          >
            pin current host
          </button>
        </div>
        <div className="mt-2 grid gap-1 text-[10px] text-bs-text-muted">
          <div>runtime: {runtimeStatus}</div>
          <div>address: {connectionUrl ?? `css://${serverName ?? 'server'}`}</div>
          <div>fingerprint: {shortFingerprint(publicIdentity?.fingerprint)}</div>
          <div>key id: {publicIdentity?.keyId ?? 'n/a'}</div>
          <div>created: {formatTime(publicIdentity?.createdAt)}</div>
          <div>trusted: {hostRecord ? `${hostRecord.source} / ${formatTime(hostRecord.trustedAt)}` : 'not pinned'}</div>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-2 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
            <div className="mb-1 text-bs-text">known hosts</div>
            <div className="flex flex-col gap-1">
              {knownHosts.length > 0 ? knownHosts.map((record) => (
                <div key={record.serverName} className="rounded border border-bs-border bg-bs-bg-panel px-2 py-1">
                  <div className="flex items-center gap-2">
                    <span className="text-bs-text">{record.serverName}</span>
                    <span className="text-bs-text-faint">{record.source}</span>
                    <div className="flex-1" />
                    <button
                      onClick={() => void removeTrustedHost(record.serverName)}
                      className="text-bs-text-faint hover:text-bs-error"
                    >
                      remove
                    </button>
                  </div>
                  <div className="text-[10px] text-bs-text-muted">{shortFingerprint(record.fingerprint)}</div>
                  <div className="text-[10px] text-bs-text-faint">{formatTime(record.trustedAt)}</div>
                </div>
              )) : (
                <span className="text-bs-text-faint">- no known hosts pinned yet -</span>
              )}
            </div>
          </div>

          <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
            <div className="mb-1 text-bs-text">session activity</div>
            <div className="grid gap-1 text-[10px] text-bs-text-muted">
              <div>requests observed: {requests.length}</div>
              <div>last request: {formatTime(requests[0]?.endedAt)}</div>
              <div>client runs: {clientRun ? 1 : 0}</div>
              <div>last client run: {formatTime(clientRun?.endedAt ?? clientRun?.startedAt)}</div>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
            <div className="mb-1 text-bs-text">authority records</div>
            <div className="flex flex-col gap-1">
              {authorityRecords.length > 0 ? authorityRecords.map((record) => (
                <div key={`${record.serverName}:${record.issuedAt}`} className="rounded border border-bs-border bg-bs-bg-panel px-2 py-1">
                  <div className="flex items-center gap-2">
                    <span className="text-bs-text">{record.serverName}</span>
                    {record.authorityName ? (
                      <span className="text-bs-text-faint">{record.authorityName}</span>
                    ) : null}
                    <div className="flex-1" />
                    <button
                      onClick={() => void removeAuthorityRecord(record.serverName)}
                      className="text-bs-text-faint hover:text-bs-error"
                    >
                      remove
                    </button>
                  </div>
                  <div className="text-[10px] text-bs-text-muted">{shortFingerprint(record.keyId)}</div>
                  <div className="text-[10px] text-bs-text-faint">{formatTime(record.issuedAt)}</div>
                </div>
              )) : (
                <span className="text-bs-text-faint">- no authority records imported yet -</span>
              )}
            </div>
          </div>

          <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
            <div className="mb-1 text-bs-text">import trusted host JSON</div>
            <textarea
              value={trustedHostDraft}
              onChange={(event) => setTrustedHostDraft(event.target.value)}
              spellCheck={false}
              placeholder='{"serverName":"demo","fingerprint":"..."}'
              className="h-24 w-full resize-y rounded border border-bs-border bg-bs-bg-panel px-2 py-1 font-mono text-[10px] text-bs-text outline-none focus:border-bs-border-focus"
            />
            <button
              onClick={() => {
                void (async () => {
                  try {
                    await importTrustedHostRecord(trustedHostDraft)
                    setTrustedHostDraft('')
                  } catch (error) {
                    window.alert(error instanceof Error ? error.message : 'Could not import trusted host record')
                  }
                })()
              }}
              className="mt-1 rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text hover:bg-bs-bg-active"
            >
              import trusted host
            </button>
          </div>

          <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
            <div className="mb-1 text-bs-text">import authority record JSON</div>
            <textarea
              value={authorityDraft}
              onChange={(event) => setAuthorityDraft(event.target.value)}
              spellCheck={false}
              placeholder='{"serverName":"demo","signature":"..."}'
              className="h-24 w-full resize-y rounded border border-bs-border bg-bs-bg-panel px-2 py-1 font-mono text-[10px] text-bs-text outline-none focus:border-bs-border-focus"
            />
            <button
              onClick={() => {
                void (async () => {
                  try {
                    await importAuthorityRecord(authorityDraft)
                    setAuthorityDraft('')
                  } catch (error) {
                    window.alert(error instanceof Error ? error.message : 'Could not import authority record')
                  }
                })()
              }}
              className="mt-1 rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text hover:bg-bs-bg-active"
            >
              import authority record
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
