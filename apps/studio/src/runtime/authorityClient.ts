export interface OAuthExchangeResult {
  sub: string
  email?: string
  name?: string
  picture?: string
  id_token?: string
}

export interface ApprovedNamespace {
  namespace: string
  approvedAt: number
}

export interface NamespaceRequestRecord {
  id: string
  namespace: string
  status: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
  submittedAt: number
}

export interface AuthorityClientError extends Error {
  status?: number
}

function getAuthorityUrl(): string {
  const configured = import.meta.env.VITE_AUTHORITY_URL
  if (typeof configured !== 'string' || !configured.trim()) {
    throw Object.assign(new Error('Authority integration is not configured. Set VITE_AUTHORITY_URL to enable sign-in and namespaces.'), {
      status: 0,
    } satisfies Partial<AuthorityClientError>)
  }
  return configured.replace(/\/+$/, '')
}

function toQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value)
  })
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

async function parseResponseBody<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T
  const text = await response.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    return text as T
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getAuthorityUrl()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`.trim()
    try {
      const body = await parseResponseBody<{ error?: string; message?: string } | string>(response)
      if (typeof body === 'string' && body.trim()) {
        message = body.trim()
      } else if (body && typeof body === 'object') {
        message = body.error?.trim() || body.message?.trim() || message
      }
    } catch {
      // Fall back to the status line when the body is not parseable.
    }

    const error = new Error(message) as AuthorityClientError
    error.status = response.status
    throw error
  }

  return parseResponseBody<T>(response)
}

function authedRequestJson<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  return requestJson<T>(path, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  })
}

export function getOAuthStartUrl(redirectUri: string): string {
  return `${getAuthorityUrl()}/oauthStart${toQuery({ redirect_uri: redirectUri })}`
}

export async function oauthExchange(grantId: string): Promise<OAuthExchangeResult> {
  return requestJson<OAuthExchangeResult>('/oauthExchange', {
    method: 'POST',
    body: JSON.stringify({ grant_id: grantId }),
  })
}

export async function getMyNamespaces(token: string): Promise<ApprovedNamespace[]> {
  return authedRequestJson<ApprovedNamespace[]>(token, '/namespaces')
}

export async function getMyRequests(token: string): Promise<NamespaceRequestRecord[]> {
  return authedRequestJson<NamespaceRequestRecord[]>(token, '/requests')
}

export async function requestNamespace(
  token: string,
  namespace: string,
  metadata?: Record<string, unknown>,
): Promise<{ ok: boolean }> {
  return authedRequestJson<{ ok: boolean }>(token, '/requestNamespace', {
    method: 'POST',
    body: JSON.stringify({ namespace, metadata }),
  })
}

export async function getServerNames(token: string, namespace: string): Promise<string[]> {
  return authedRequestJson<string[]>(token, `/servers${toQuery({ ns: namespace })}`)
}

export async function addServerName(
  token: string,
  namespace: string,
  serverName: string,
): Promise<{ ok: boolean }> {
  return authedRequestJson<{ ok: boolean }>(token, '/servers', {
    method: 'POST',
    body: JSON.stringify({ namespace, serverName }),
  })
}

export async function removeServerName(
  token: string,
  serverName: string,
): Promise<{ ok: boolean }> {
  return authedRequestJson<{ ok: boolean }>(token, `/servers/${encodeURIComponent(serverName)}`, {
    method: 'DELETE',
  })
}
