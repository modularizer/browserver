import type { ApprovedNamespace } from './authorityClient'
import type { IdentityUser } from '../store/identity'

export interface ServerAuthorityStatus {
  allowed: boolean
  mode: 'dmz' | 'owned' | 'blocked-anonymous' | 'blocked-unowned' | 'blocked-config'
  namespace: string | null
  reason: string | null
}

export function isAuthorityConfigured(): boolean {
  return typeof import.meta.env.VITE_AUTHORITY_URL === 'string' && import.meta.env.VITE_AUTHORITY_URL.trim().length > 0
}

export function namespaceFromServerName(serverName: string): string | null {
  const trimmed = serverName.trim().replace(/^css:\/\//, '')
  if (!trimmed) return null
  const slashIndex = trimmed.indexOf('/')
  return slashIndex >= 0 ? trimmed.slice(0, slashIndex) : trimmed
}

export function evaluateServerAuthorityStatus(
  serverName: string,
  user: IdentityUser | null,
  namespaces: ApprovedNamespace[],
): ServerAuthorityStatus {
  const trimmed = serverName.trim().replace(/^css:\/\//, '')
  if (!trimmed) {
    return {
      allowed: false,
      mode: 'blocked-config',
      namespace: null,
      reason: 'Server name is empty.',
    }
  }

  if (trimmed.startsWith('dmz/')) {
    return {
      allowed: true,
      mode: 'dmz',
      namespace: 'dmz',
      reason: null,
    }
  }

  if (!isAuthorityConfigured()) {
    return {
      allowed: false,
      mode: 'blocked-config',
      namespace: namespaceFromServerName(trimmed),
      reason: 'Authority integration is not configured. Use dmz/* or set VITE_AUTHORITY_URL.',
    }
  }

  if (!user) {
    return {
      allowed: false,
      mode: 'blocked-anonymous',
      namespace: namespaceFromServerName(trimmed),
      reason: 'Anonymous hosting is restricted to dmz/* server names. Sign in to use custom namespaces.',
    }
  }

  const namespace = namespaceFromServerName(trimmed)
  const isOwned = namespace
    ? namespaces.some((entry) => entry.namespace === namespace)
    : false

  if (isOwned) {
    return {
      allowed: true,
      mode: 'owned',
      namespace,
      reason: null,
    }
  }

  return {
    allowed: false,
    mode: 'blocked-unowned',
    namespace,
    reason: namespace
      ? `You do not own the namespace "${namespace}". Request it or use dmz/* instead.`
      : 'This server name is not available.',
  }
}
