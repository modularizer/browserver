/**
 * Base URL for HTTP OpenAPI and API calls. Strips `*.html` page paths so
 * e.g. `http://localhost:8080/app/server.html` → `http://localhost:8080/app`.
 */
export function normalizeClientApiBaseUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith('css://')) {
    return trimmed
  }
  try {
    const u = new URL(trimmed)
    if ((u.protocol === 'http:' || u.protocol === 'https:') && /\.html?$/i.test(u.pathname)) {
      u.pathname = u.pathname.replace(/[^/]+$/, '')
      const dir = u.pathname.replace(/\/+$/, '')
      return dir ? `${u.origin}${dir}` : u.origin
    }
    return trimmed.replace(/\/+$/, '')
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export function normalizeCssTargetUrl(url: string): string {
  return url.trim().replace(/\/$/, '')
}

export function buildCssTargetUrl(serverName: string): string {
  const normalizedName = serverName.trim().replace(/^\/+|\/+$/g, '')
  if (!normalizedName) return 'css://'
  const encoded = normalizedName
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('%2F')
  return `css://${encoded}`
}

export function parseCssServerName(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed.startsWith('css://')) return null

  try {
    const parsed = new URL(trimmed)
    const rawName = [parsed.host, parsed.pathname.replace(/^\/+/, '')].filter(Boolean).join('/')
    if (!rawName) return null
    return decodeURIComponent(rawName).replace(/^\/+|\/+$/g, '') || null
  } catch {
    const fallback = trimmed.slice('css://'.length).replace(/^\/+|\/+$/g, '')
    if (!fallback) return null
    try {
      return decodeURIComponent(fallback)
    } catch {
      return fallback
    }
  }
}

