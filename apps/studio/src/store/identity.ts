import { create } from 'zustand'
import { authSession, type AuthSessionResult } from '../runtime/authorityClient'
import { isAuthorityConfigured } from '../runtime/authorityPolicy'

export interface IdentityUser {
  googleSub: string
  email: string
  name: string
  picture: string
  /** Cached data URL of the profile picture (avoids repeated fetches to Google's rate-limited URLs) */
  pictureData: string
  /** Authority-issued session JWT (NOT the Google ID token). */
  idToken: string
  signedInAt: number
}

interface IdentityState {
  user: IdentityUser | null
  error: string | null
  /** Trigger Google Identity Services One Tap. Returns true if a prompt was requested. */
  promptSignIn: () => boolean
  /**
   * Render the Google Sign-In button into the supplied element. Idempotent;
   * call whenever the button host mounts. Options override the defaults.
   * See https://developers.google.com/identity/gsi/web/reference/js-reference#GsiButtonConfiguration
   */
  renderSignInButton: (host: HTMLElement, options?: Record<string, unknown>) => void
  /** Exchange a Google-issued ID token (from GIS callback) for an authority session. */
  completeSignIn: (credential: string) => Promise<void>
  /** Attempt a silent re-auth via GIS One Tap if the user previously signed in. */
  maybeAutoReauthenticate: () => boolean
  signOut: () => void
}

type GoogleAccountsId = {
  initialize: (config: {
    client_id: string
    callback: (response: { credential: string }) => void
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
  }) => void
  prompt: () => void
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
  disableAutoSelect: () => void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } }
  }
}

const IDENTITY_STORAGE_KEY = 'browserver:identity'
const IDENTITY_SESSION_HINT_KEY = 'browserver:identity:session-hint'
const AUTO_REAUTH_ATTEMPT_KEY = 'browserver:identity:auto-reauth-attempted'

const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || ''

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
  try {
    const claims = decodeJwtPayload(jwt)
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null
  } catch {
    return null
  }
}

function isTokenExpired(jwt: string, leewayMs = 60_000): boolean {
  const expiresAt = getJwtExpiration(jwt)
  return expiresAt !== null && expiresAt <= Date.now() + leewayMs
}

function toIdentityUser(result: AuthSessionResult): IdentityUser {
  return {
    googleSub: result.google_sub,
    email: result.profile.email ?? '',
    name: result.profile.name ?? '',
    picture: result.profile.picture ?? '',
    pictureData: result.picture_data ?? '',
    idToken: result.session_token,
    signedInAt: Date.now(),
  }
}

export const selectIsSignedIn = (state: IdentityState) => state.user !== null

let gisInitialized = false
let pendingCredentialHandler: ((credential: string) => void) | null = null

function getGsi(): GoogleAccountsId | null {
  return window.google?.accounts?.id ?? null
}

function ensureGisInitialized(): GoogleAccountsId | null {
  if (!GOOGLE_CLIENT_ID) return null
  const gsi = getGsi()
  if (!gsi) return null
  if (gisInitialized) return gsi
  gsi.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response) => {
      pendingCredentialHandler?.(response.credential)
    },
    auto_select: false,
    cancel_on_tap_outside: true,
  })
  gisInitialized = true
  return gsi
}

export const useIdentityStore = create<IdentityState>()((set, get) => {
  pendingCredentialHandler = (credential) => { void get().completeSignIn(credential) }

  return {
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
    promptSignIn: () => {
      const gsi = ensureGisInitialized()
      if (!gsi) {
        set({ error: GOOGLE_CLIENT_ID ? 'Google sign-in is still loading. Try again in a moment.' : 'Sign-in is not configured (missing VITE_GOOGLE_CLIENT_ID).' })
        return false
      }
      gsi.prompt()
      return true
    },
    renderSignInButton: (host, options) => {
      const gsi = ensureGisInitialized()
      if (!gsi || !host) return
      host.innerHTML = ''
      gsi.renderButton(host, {
        type: 'standard',
        theme: 'outline',
        size: 'medium',
        text: 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        ...options,
      })
    },
    completeSignIn: async (credential) => {
      if (!credential.trim()) return
      try {
        const result = await authSession(credential, 'user')
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
    maybeAutoReauthenticate: () => {
      if (!isAuthorityConfigured()) return false
      if (!hasSessionHint()) return false
      if (hasAutoReauthAttempted()) return false
      const gsi = ensureGisInitialized()
      if (!gsi) return false
      markAutoReauthAttempted()
      gsi.prompt()
      return true
    },
    signOut: () => {
      storeUser(null)
      setSessionHint(false)
      clearAutoReauthAttempt()
      getGsi()?.disableAutoSelect()
      set({ user: null, error: null })
    },
  }
})
