import { create } from 'zustand'
import {
  addServerName as authorityAddServerName,
  getMyNamespaces,
  getMyRequests,
  getServerNames,
  removeServerName as authorityRemoveServerName,
  requestNamespace as authorityRequestNamespace,
  AuthorityUnavailableError,
  type ApprovedNamespace,
  type AuthorityClientError,
  type NamespaceRequestRecord,
} from '../runtime/authorityClient'
import { useIdentityStore, type IdentityUser } from './identity'

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function deriveAutoRequestCandidates(user: IdentityUser): string[] {
  const email = user.email || ''
  const name = user.name || ''
  const [emailHandle = '', emailDomain = ''] = email.split('@')
  const isGmail = emailDomain === 'gmail.com'

  const nameParts = name.split(/\s+/).map((p) => slugify(p)).filter(Boolean)
  const first = nameParts[0] || ''
  const last = nameParts[nameParts.length - 1] || ''
  const firstLast = first && last && first !== last ? `${first}${last}` : ''
  const handle = slugify(emailHandle)
  const company = !isGmail && emailDomain ? slugify(emailDomain.split('.')[0] || '') : ''

  const ordered = [
    first,
    firstLast,
    handle,
    first && company ? `${first}-${company}` : '',
    firstLast && company ? `${firstLast}-${company}` : '',
  ]
  const seen = new Set<string>()
  const results: string[] = []
  for (const candidate of ordered) {
    if (candidate && !seen.has(candidate)) {
      seen.add(candidate)
      results.push(candidate)
    }
  }
  return results
}

function isNamespaceTakenError(error: unknown): boolean {
  const status = (error as AuthorityClientError | undefined)?.status
  if (status === 409) return true
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('already taken') || message.includes('already exists')
}

export interface NamespaceState {
  namespaces: ApprovedNamespace[]
  requests: NamespaceRequestRecord[]
  serverNames: Record<string, string[]>
  loading: boolean
  error: string | null
  isSessionExpired: boolean
  authorityUnavailable: boolean
  ensureAuthorityData: () => Promise<void>
  fetchMyNamespaces: () => Promise<void>
  fetchMyRequests: () => Promise<void>
  requestNamespace: (namespace: string, metadata?: Record<string, unknown>) => Promise<void>
  fetchServerNames: (namespace: string) => Promise<void>
  addServerName: (namespace: string, serverName: string) => Promise<void>
  removeServerName: (namespace: string, serverName: string) => Promise<void>
  invalidateCache: () => void
}

interface NamespaceCache {
  googleSub: string
  savedAt: number
  namespaces: ApprovedNamespace[]
  requests: NamespaceRequestRecord[]
  serverNames: Record<string, string[]>
}

const CACHE_KEY = 'browserver:namespace:cache'
const CACHE_TTL_MS = 5 * 60 * 1000

function loadCache(): NamespaceCache | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<NamespaceCache>
    if (!parsed || typeof parsed.googleSub !== 'string' || typeof parsed.savedAt !== 'number') return null
    if (Date.now() - parsed.savedAt > CACHE_TTL_MS) return null
    return {
      googleSub: parsed.googleSub,
      savedAt: parsed.savedAt,
      namespaces: Array.isArray(parsed.namespaces) ? parsed.namespaces : [],
      requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      serverNames: parsed.serverNames && typeof parsed.serverNames === 'object' ? parsed.serverNames : {},
    }
  } catch {
    return null
  }
}

function writeCache(cache: NamespaceCache) {
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
}

function clearCache() {
  window.localStorage.removeItem(CACHE_KEY)
}

function getSignedInUser() {
  return useIdentityStore.getState().user
}

function isSessionError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as AuthorityClientError).status === 401
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return 'Authority request failed.'
}

const initialCache = loadCache()
const initialUser = getSignedInUser()
const cacheMatchesUser = Boolean(initialCache && initialUser && initialCache.googleSub === initialUser.googleSub)
let authorityBootstrapPromise: Promise<void> | null = null

export const useNamespaceStore = create<NamespaceState>()((set, get) => ({
  namespaces: cacheMatchesUser ? initialCache?.namespaces ?? [] : [],
  requests: cacheMatchesUser ? initialCache?.requests ?? [] : [],
  serverNames: cacheMatchesUser ? initialCache?.serverNames ?? {} : {},
  loading: false,
  error: null,
  isSessionExpired: false,
  authorityUnavailable: false,
  ensureAuthorityData: async () => {
    const user = getSignedInUser()
    if (!user) return
    if (!authorityBootstrapPromise) {
      authorityBootstrapPromise = Promise.all([
        get().fetchMyNamespaces(),
        get().fetchMyRequests(),
      ]).then(() => undefined).finally(() => {
        authorityBootstrapPromise = null
      })
    }
    return authorityBootstrapPromise
  },
  fetchMyNamespaces: async () => {
    const user = getSignedInUser()
    if (!user) return
    set({ loading: true, error: null, authorityUnavailable: false })

    let namespaces: ApprovedNamespace[] = []
    try {
      namespaces = await getMyNamespaces(user.idToken)
      set({ namespaces, loading: false, isSessionExpired: false })
      writeCache({
        googleSub: user.googleSub,
        savedAt: Date.now(),
        namespaces,
        requests: get().requests,
        serverNames: get().serverNames,
      })
    } catch (error) {
      if (error instanceof AuthorityUnavailableError) {
        set({
          loading: false,
          authorityUnavailable: true,
          error: error.message,
        })
        return
      }
      set({
        loading: false,
        error: getErrorMessage(error),
        isSessionExpired: isSessionError(error),
      })
      return
    }

    // Auto-request namespaces for users who have none
    console.log('[namespace] fetched namespaces:', namespaces.length, 'checking auto-request...')
    if (namespaces.length === 0) {
      let requests: NamespaceRequestRecord[] = []
      try { requests = await getMyRequests(user.idToken); set({ requests }) } catch { /* use empty */ }
      console.log('[namespace] existing requests:', requests.length)
      if (requests.length === 0) {
        const candidates = deriveAutoRequestCandidates(user)
        console.log('[namespace] auto-request candidates:', candidates, 'user:', { name: user.name, email: user.email })
        let submitted = false
        for (const ns of candidates) {
          try {
            await authorityRequestNamespace(user.idToken, ns)
            console.log('[namespace] requested:', ns)
            submitted = true
            break
          } catch (err) {
            if (isNamespaceTakenError(err)) {
              console.log('[namespace] taken, trying next:', ns)
              continue
            }
            console.warn('[namespace] request failed:', ns, err)
            break
          }
        }
        if (submitted) {
          try { requests = await getMyRequests(user.idToken); set({ requests }) } catch { /* ignore */ }
        }
      }
    }
  },
  fetchMyRequests: async () => {
    const user = getSignedInUser()
    if (!user) return
    set({ loading: true, error: null, authorityUnavailable: false })
    try {
      const requests = await getMyRequests(user.idToken)
      set({ requests, loading: false, isSessionExpired: false })
      writeCache({
        googleSub: user.googleSub,
        savedAt: Date.now(),
        namespaces: get().namespaces,
        requests,
        serverNames: get().serverNames,
      })
    } catch (error) {
      if (error instanceof AuthorityUnavailableError) {
        set({
          loading: false,
          authorityUnavailable: true,
          error: error.message,
        })
        return
      }
      set({
        loading: false,
        error: getErrorMessage(error),
        isSessionExpired: isSessionError(error),
      })
      throw error
    }
  },
  requestNamespace: async (namespace, metadata) => {
    const user = getSignedInUser()
    if (!user) return
    set({ loading: true, error: null })
    try {
      await authorityRequestNamespace(user.idToken, namespace, metadata)
      const requests = await getMyRequests(user.idToken)
      set({ requests, loading: false, isSessionExpired: false })
      writeCache({
        googleSub: user.googleSub,
        savedAt: Date.now(),
        namespaces: get().namespaces,
        requests,
        serverNames: get().serverNames,
      })
    } catch (error) {
      set({
        loading: false,
        error: getErrorMessage(error),
        isSessionExpired: isSessionError(error),
      })
      throw error
    }
  },
  fetchServerNames: async (namespace) => {
    const user = getSignedInUser()
    if (!user) return
    set({ loading: true, error: null })
    try {
      const names = await getServerNames(user.idToken, namespace)
      const serverNames = {
        ...get().serverNames,
        [namespace]: names,
      }
      set({ serverNames, loading: false, isSessionExpired: false })
      writeCache({
        googleSub: user.googleSub,
        savedAt: Date.now(),
        namespaces: get().namespaces,
        requests: get().requests,
        serverNames,
      })
    } catch (error) {
      set({
        loading: false,
        error: getErrorMessage(error),
        isSessionExpired: isSessionError(error),
      })
    }
  },
  addServerName: async (namespace, serverName) => {
    const user = getSignedInUser()
    if (!user) return
    set({ loading: true, error: null })
    try {
      await authorityAddServerName(user.idToken, namespace, serverName)
      const names = await getServerNames(user.idToken, namespace)
      const serverNames = {
        ...get().serverNames,
        [namespace]: names,
      }
      set({ serverNames, loading: false, isSessionExpired: false })
      writeCache({
        googleSub: user.googleSub,
        savedAt: Date.now(),
        namespaces: get().namespaces,
        requests: get().requests,
        serverNames,
      })
    } catch (error) {
      set({
        loading: false,
        error: getErrorMessage(error),
        isSessionExpired: isSessionError(error),
      })
    }
  },
  removeServerName: async (namespace, serverName) => {
    const user = getSignedInUser()
    if (!user) return
    set({ loading: true, error: null })
    try {
      await authorityRemoveServerName(user.idToken, serverName)
      const names = await getServerNames(user.idToken, namespace)
      const serverNames = {
        ...get().serverNames,
        [namespace]: names,
      }
      set({ serverNames, loading: false, isSessionExpired: false })
      writeCache({
        googleSub: user.googleSub,
        savedAt: Date.now(),
        namespaces: get().namespaces,
        requests: get().requests,
        serverNames,
      })
    } catch (error) {
      set({
        loading: false,
        error: getErrorMessage(error),
        isSessionExpired: isSessionError(error),
      })
    }
  },
  invalidateCache: () => {
    clearCache()
    authorityBootstrapPromise = null
    set({
      namespaces: [],
      requests: [],
      serverNames: {},
      error: null,
      isSessionExpired: false,
    })
  },
}))

useIdentityStore.subscribe((state, prevState) => {
  if (state.user?.googleSub === prevState.user?.googleSub) return

  if (!state.user) {
    clearCache()
    authorityBootstrapPromise = null
    useNamespaceStore.setState({
      namespaces: [],
      requests: [],
      serverNames: {},
      loading: false,
      error: null,
      isSessionExpired: false,
    })
    return
  }

  const cache = loadCache()
  if (cache && cache.googleSub === state.user.googleSub) {
    useNamespaceStore.setState({
      namespaces: cache.namespaces,
      requests: cache.requests,
      serverNames: cache.serverNames,
      loading: false,
      error: null,
      isSessionExpired: false,
    })
  } else {
    useNamespaceStore.setState({
      namespaces: [],
      requests: [],
      serverNames: {},
      loading: false,
      error: null,
      isSessionExpired: false,
    })
  }

  // Always refresh authority state on sign-in (auto-request runs inside if needed).
  void useNamespaceStore.getState().ensureAuthorityData().catch(() => {})
})
