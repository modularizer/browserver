import { create } from 'zustand'
import { getOAuthStartUrl, oauthExchange, type OAuthExchangeResult } from '../runtime/authorityClient'
import { isAuthorityConfigured } from '../runtime/authorityPolicy'

export interface IdentityUser {
  googleSub: string
  email: string
  name: string
  picture: string
  /** Cached data URL of the profile picture (avoids repeated fetches to Google's rate-limited URLs) */
  pictureData: string
  idToken: string
  signedInAt: number
}

interface IdentityState {
  user: IdentityUser | null
  error: string | null
  signIn: () => void
  maybeAutoReauthenticate: () => boolean
  handleOAuthCallback: (grantId: string) => Promise<void>
  handleSessionToken: (jwt: string, pictureData?: string) => void
  signOut: () => void
}

const IDENTITY_STORAGE_KEY = 'browserver:identity'
const IDENTITY_SESSION_HINT_KEY = 'browserver:identity:session-hint'
const AUTO_REAUTH_ATTEMPT_KEY = 'browserver:identity:auto-reauth-attempted'

function setSessionHint(enabled: boolean) {
  if (enabled) {
    window.localStorage.setItem(IDENTITY_SESSION_HINT_KEY, '1')
    return
  }
  window.localStorage.removeItem(IDENTITY_SESSION_HINT_KEY)
}

function hasSessionHint(): boolean {
  return window.localStorage.getItem(IDENTITY_SESSION_HINT_KEY) === '1'
}

function clearAutoReauthAttempt() {
  window.sessionStorage.removeItem(AUTO_REAUTH_ATTEMPT_KEY)
}

function hasAutoReauthAttempted(): boolean {
  return window.sessionStorage.getItem(AUTO_REAUTH_ATTEMPT_KEY) === '1'
}

function markAutoReauthAttempted() {
  window.sessionStorage.setItem(AUTO_REAUTH_ATTEMPT_KEY, '1')
}

function readStoredUser(): IdentityUser | null {
  try {
    const raw = window.localStorage.getItem(IDENTITY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<IdentityUser>
    if (!parsed || typeof parsed.googleSub !== 'string') return null
    return {
      googleSub: parsed.googleSub,
      email: typeof parsed.email === 'string' ? parsed.email : '',
      name: typeof parsed.name === 'string' ? parsed.name : '',
      picture: typeof parsed.picture === 'string' ? parsed.picture : '',
      pictureData: typeof parsed.pictureData === 'string' ? parsed.pictureData : '',
      idToken: typeof parsed.idToken === 'string' ? parsed.idToken : '',
      signedInAt: typeof parsed.signedInAt === 'number' ? parsed.signedInAt : Date.now(),
    }
  } catch {
    return null
  }
}

function storeUser(user: IdentityUser | null) {
  if (!user) {
    window.localStorage.removeItem(IDENTITY_STORAGE_KEY)
    return
  }
  window.localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(user))
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT')
  const payload = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(payload))
}

function getJwtExpiration(jwt: string): number | null {
  const claims = decodeJwtPayload(jwt)
  return typeof claims.exp === 'number' ? claims.exp * 1000 : null
}

function isTokenExpired(jwt: string, leewayMs = 60_000): boolean {
  const expiresAt = getJwtExpiration(jwt)
  return expiresAt !== null && expiresAt <= Date.now() + leewayMs
}

function toIdentityUser(result: OAuthExchangeResult): IdentityUser {
  return {
    googleSub: result.sub,
    email: result.email ?? '',
    name: result.name ?? '',
    picture: result.picture ?? '',
    pictureData: '',
    idToken: result.id_token ?? '',
    signedInAt: Date.now(),
  }
}

export const selectIsSignedIn = (state: IdentityState) => state.user !== null

export const useIdentityStore = create<IdentityState>()((set) => ({
  user: (() => {
    const stored = readStoredUser()
    if (!stored) return null
    if (stored.idToken && isTokenExpired(stored.idToken)) {
      storeUser(null)
      return null
    }
    setSessionHint(true)
    return stored
  })(),
  error: null,
  signIn: () => {
    const redirectUri = `${window.location.origin}${window.location.pathname}`
    window.location.href = getOAuthStartUrl(redirectUri)
  },
  maybeAutoReauthenticate: () => {
    if (!isAuthorityConfigured()) return false
    if (!hasSessionHint()) return false
    if (hasAutoReauthAttempted()) return false
    markAutoReauthAttempted()
    const redirectUri = `${window.location.origin}${window.location.pathname}`
    window.location.href = getOAuthStartUrl(redirectUri)
    return true
  },
  handleOAuthCallback: async (grantId) => {
    if (!grantId.trim()) return
    try {
      const result = await oauthExchange(grantId)
      const user = toIdentityUser(result)
      storeUser(user)
      setSessionHint(true)
      clearAutoReauthAttempt()
      set({ user, error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not complete sign-in.'
      set({ error: message })
      throw error
    }
  },
  handleSessionToken: (jwt, pictureData) => {
    try {
      const claims = decodeJwtPayload(jwt)
      const user: IdentityUser = {
        googleSub: typeof claims.sub === 'string' ? claims.sub : '',
        email: typeof claims.email === 'string' ? claims.email : '',
        name: typeof claims.name === 'string' ? claims.name : '',
        picture: typeof claims.picture === 'string' ? claims.picture : '',
        pictureData: pictureData || '',
        idToken: jwt,
        signedInAt: Date.now(),
      }
      if (!user.googleSub) throw new Error('JWT missing sub claim')
      storeUser(user)
      setSessionHint(true)
      clearAutoReauthAttempt()
      set({ user, error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid session token.'
      set({ error: message })
    }
  },
  signOut: () => {
    storeUser(null)
    setSessionHint(false)
    clearAutoReauthAttempt()
    set({ user: null, error: null })
  },
}))
