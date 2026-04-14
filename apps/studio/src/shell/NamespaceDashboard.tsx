import { useEffect, useMemo, useState } from 'react'
import { useIdentityStore } from '../store/identity'
import { useNamespaceStore } from '../store/namespace'

function formatTime(value: number | undefined) {
  if (!value) return 'n/a'
  return new Date(value).toLocaleString()
}

function statusClasses(status: 'pending' | 'approved' | 'rejected') {
  if (status === 'approved') return 'text-bs-good'
  if (status === 'rejected') return 'text-bs-error'
  return 'text-yellow-300'
}

const GOOGLE_SIGN_IN_BUTTON_SRC = 'https://developers.google.com/static/identity/images/branding_guideline_sample_lt_rd_lg.svg'

export function NamespaceDashboard() {
  const user = useIdentityStore((state) => state.user)
  const identityError = useIdentityStore((state) => state.error)
  const signIn = useIdentityStore((state) => state.signIn)
  const signOut = useIdentityStore((state) => state.signOut)
  const namespaces = useNamespaceStore((state) => state.namespaces)
  const requests = useNamespaceStore((state) => state.requests)
  const serverNames = useNamespaceStore((state) => state.serverNames)
  const loading = useNamespaceStore((state) => state.loading)
  const error = useNamespaceStore((state) => state.error)
  const isSessionExpired = useNamespaceStore((state) => state.isSessionExpired)
  const fetchMyNamespaces = useNamespaceStore((state) => state.fetchMyNamespaces)
  const fetchMyRequests = useNamespaceStore((state) => state.fetchMyRequests)
  const requestNamespace = useNamespaceStore((state) => state.requestNamespace)
  const fetchServerNames = useNamespaceStore((state) => state.fetchServerNames)
  const addServerName = useNamespaceStore((state) => state.addServerName)
  const removeServerName = useNamespaceStore((state) => state.removeServerName)
  const [expandedNamespaces, setExpandedNamespaces] = useState<Record<string, boolean>>({})
  const [serverDrafts, setServerDrafts] = useState<Record<string, string>>({})
  const [requesting, setRequesting] = useState(false)
  const [namespaceDraft, setNamespaceDraft] = useState('')
  const [requestNotes, setRequestNotes] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!user) return
    void fetchMyNamespaces()
    void fetchMyRequests()
  }, [fetchMyNamespaces, fetchMyRequests, user])

  const sortedNamespaces = useMemo(
    () => [...namespaces].sort((a, b) => a.namespace.localeCompare(b.namespace)),
    [namespaces],
  )

  const startSignIn = () => {
    try {
      signIn()
    } catch (nextError) {
      setFeedback(nextError instanceof Error ? nextError.message : 'Could not start sign-in.')
    }
  }

  if (!user) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto">
        {isSessionExpired ? (
          <div className="rounded border border-bs-error bg-bs-bg-sidebar px-2 py-1 text-[10px] text-bs-error">
            session expired
          </div>
        ) : null}

        <div className="rounded border border-bs-border bg-bs-bg-sidebar px-3 py-3">
          <div className="max-w-[34rem] text-[12px] leading-5 text-bs-text-faint">
            Sign-in is optional. It gives you access to serve with standard routes under your namespace instead of `dmz/*`.
          </div>
          <div className="mt-3">
            <button
              onClick={startSignIn}
              className="inline-flex rounded focus:outline-none focus:ring-1 focus:ring-bs-border-focus"
              aria-label="Sign in with Google"
            >
              <img
                src={GOOGLE_SIGN_IN_BUTTON_SRC}
                alt="Sign in with Google"
                className="h-10 w-auto"
                draggable={false}
              />
            </button>
          </div>
          {identityError ? <div className="mt-3 text-[10px] text-bs-error">{identityError}</div> : null}
          {feedback ? <div className="mt-2 text-[10px] text-bs-text-faint">{feedback}</div> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-auto">
      {isSessionExpired ? (
        <div className="rounded border border-bs-error bg-bs-bg-sidebar px-2 py-1 text-[10px] text-bs-error">
          session expired
          <button
            onClick={startSignIn}
            className="ml-2 underline hover:no-underline"
          >
            re-authenticate
          </button>
        </div>
      ) : null}

      <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
        <div className="flex items-center gap-2">
          {user.pictureData || user.picture ? (
            <img src={user.pictureData || user.picture} alt="" className="h-6 w-6 rounded-full" />
          ) : (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-bs-bg-active text-[10px] text-bs-text">
              {(user.name || user.email || 'u').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-bs-text">{user.name || 'Signed in'}</div>
            <div className="truncate text-[10px] text-bs-text-faint">{user.email || user.googleSub}</div>
          </div>
          <button
            onClick={signOut}
            className="text-[10px] text-bs-text-faint hover:text-bs-text"
          >
            sign out
          </button>
        </div>
        {identityError ? <div className="mt-2 text-[10px] text-bs-error">{identityError}</div> : null}
        {feedback ? <div className="mt-2 text-[10px] text-bs-text-faint">{feedback}</div> : null}
      </div>

      <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
        <div className="mb-2 flex items-center gap-2">
          <div className="text-bs-text">my namespaces</div>
          <div className="flex-1" />
          {loading ? <div className="text-[10px] text-bs-text-faint">syncing...</div> : null}
        </div>
        <div className="flex flex-col gap-1">
          {sortedNamespaces.length > 0 ? sortedNamespaces.map((entry) => {
            const expanded = expandedNamespaces[entry.namespace] ?? false
            const names = serverNames[entry.namespace] ?? []
            const draft = serverDrafts[entry.namespace] ?? ''
            return (
              <div key={entry.namespace} className="rounded border border-bs-border bg-bs-bg-panel px-2 py-1">
                <button
                  onClick={() => {
                    const nextExpanded = !expanded
                    setExpandedNamespaces((prev) => ({ ...prev, [entry.namespace]: nextExpanded }))
                    if (nextExpanded && !serverNames[entry.namespace]) {
                      void fetchServerNames(entry.namespace)
                    }
                  }}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span className="text-bs-text">{entry.namespace}</span>
                  <span className="text-[10px] text-bs-text-faint">{formatTime(entry.approvedAt)}</span>
                  <div className="flex-1" />
                  <span className="text-[10px] text-bs-text-faint">{expanded ? 'hide' : 'show'}</span>
                </button>
                {expanded ? (
                  <div className="mt-2 flex flex-col gap-1 text-[10px]">
                    {names.length > 0 ? names.map((name) => (
                      <div key={name} className="flex items-center gap-2 rounded border border-bs-border bg-bs-bg-sidebar px-2 py-1">
                        <span className="min-w-0 flex-1 truncate text-bs-text">{name}</span>
                        <button
                          onClick={() => {
                            void (async () => {
                              try {
                                await removeServerName(entry.namespace, name)
                                setFeedback(`Removed ${name}`)
                              } catch (nextError) {
                                setFeedback(nextError instanceof Error ? nextError.message : 'Could not remove server name.')
                              }
                            })()
                          }}
                          className="text-bs-text-faint hover:text-bs-error"
                        >
                          remove
                        </button>
                      </div>
                    )) : (
                      <div className="text-bs-text-faint">- no registered server names -</div>
                    )}
                    <div className="flex items-center gap-2">
                      <input
                        value={draft}
                        onChange={(event) => setServerDrafts((prev) => ({ ...prev, [entry.namespace]: event.target.value }))}
                        placeholder={`${entry.namespace}/hello`}
                        spellCheck={false}
                        className="min-w-0 flex-1 rounded border border-bs-border bg-bs-bg-panel px-2 py-1 text-[10px] text-bs-text outline-none focus:border-bs-border-focus"
                      />
                      <button
                        onClick={() => {
                          if (!draft.trim()) return
                          void (async () => {
                            try {
                              await addServerName(entry.namespace, draft.trim())
                              setServerDrafts((prev) => ({ ...prev, [entry.namespace]: '' }))
                              setFeedback(`Added ${draft.trim()}`)
                            } catch (nextError) {
                              setFeedback(nextError instanceof Error ? nextError.message : 'Could not add server name.')
                            }
                          })()
                        }}
                        className="rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text hover:bg-bs-bg-active"
                      >
                        add
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          }) : (
            <div className="text-[10px] text-bs-text-faint">
              {user ? '- no approved namespaces yet -' : '- sign in to load namespace ownership -'}
            </div>
          )}
        </div>
      </div>

      <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
        <div className="mb-2 text-bs-text">request namespace</div>
        <div className="flex flex-col gap-2">
          <input
            value={namespaceDraft}
            onChange={(event) => setNamespaceDraft(event.target.value)}
            placeholder="my-namespace"
            spellCheck={false}
            className="rounded border border-bs-border bg-bs-bg-panel px-2 py-1 text-[10px] text-bs-text outline-none focus:border-bs-border-focus"
          />
          <textarea
            value={requestNotes}
            onChange={(event) => setRequestNotes(event.target.value)}
            placeholder="optional use case"
            spellCheck={false}
            className="h-20 resize-y rounded border border-bs-border bg-bs-bg-panel px-2 py-1 text-[10px] text-bs-text outline-none focus:border-bs-border-focus"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!namespaceDraft.trim()) return
                setRequesting(true)
                void (async () => {
                  try {
                    await requestNamespace(
                      namespaceDraft.trim(),
                      requestNotes.trim() ? { note: requestNotes.trim() } : undefined,
                    )
                    setFeedback(`Requested namespace ${namespaceDraft.trim()}`)
                    setNamespaceDraft('')
                    setRequestNotes('')
                  } catch (nextError) {
                    setFeedback(nextError instanceof Error ? nextError.message : 'Could not submit namespace request.')
                  } finally {
                    setRequesting(false)
                  }
                })()
              }}
              disabled={!user || requesting || !namespaceDraft.trim()}
              className="rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text hover:bg-bs-bg-active disabled:opacity-50"
            >
              request
            </button>
            <div className="text-[10px] text-bs-text-faint">
              anonymous hosting still works under `dmz/*`
            </div>
          </div>
        </div>
      </div>

      <div className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-2">
        <div className="mb-2 text-bs-text">requests</div>
        <div className="flex flex-col gap-1">
          {requests.length > 0 ? requests.map((entry) => (
            <div
              key={entry.id}
              title={entry.rejectionReason || undefined}
              className="flex items-center gap-2 rounded border border-bs-border bg-bs-bg-panel px-2 py-1 text-[10px]"
            >
              <span className="min-w-0 flex-1 truncate text-bs-text">{entry.namespace}</span>
              <span className="text-bs-text-faint">{formatTime(entry.submittedAt)}</span>
              <span className={statusClasses(entry.status)}>{entry.status}</span>
            </div>
          )) : (
            <div className="text-[10px] text-bs-text-faint">- no namespace requests yet -</div>
          )}
        </div>
        {error ? <div className="mt-2 text-[10px] text-bs-error">{error}</div> : null}
      </div>
    </div>
  )
}
