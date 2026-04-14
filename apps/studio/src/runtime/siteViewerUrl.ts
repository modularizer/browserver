function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/g, '')
}

function isLocalDevHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}

function normalizePreviewPath(previewPath?: string): string {
  const candidate = (previewPath ?? '/').trim() || '/'
  if (candidate === '/') return '/'
  return candidate.startsWith('/') ? candidate : `/${candidate}`
}

function encodePath(value: string): string {
  return value
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export function resolveSiteViewerOrigin(): string | null {
  const configured = import.meta.env.VITE_SITE_VIEWER_ORIGIN?.trim()
  if (configured) return trimTrailingSlashes(configured)

  if (typeof window === 'undefined') return null
  const { protocol, hostname, port } = window.location
  if (!isLocalDevHost(hostname) || (protocol !== 'http:' && protocol !== 'https:')) return null
  if (port === '5174') return trimTrailingSlashes(window.location.origin)
  return `${protocol}//${hostname}:5174`
}

function decodePathSegments(segments: string[]): string[] {
  return segments.map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return segment
    }
  })
}

export function parseSiteViewerUrl(raw: string): {
  serverName: string
  previewPath: string
  search: string
} | null {
  const origin = resolveSiteViewerOrigin()
  if (!origin) return null

  let viewerOrigin: URL
  let candidate: URL
  try {
    viewerOrigin = new URL(origin)
    candidate = new URL(raw)
  } catch {
    return null
  }

  if (candidate.origin !== viewerOrigin.origin) return null

  const decodedSegments = decodePathSegments(candidate.pathname.split('/').filter(Boolean))
  if (decodedSegments.length < 2) return null

  const serverName = decodedSegments.slice(0, 2).join('/').replace(/^\/+|\/+$/g, '')
  if (!serverName) return null

  const previewSegments = decodedSegments.slice(2)
  const previewPath = previewSegments.length > 0 ? `/${previewSegments.join('/')}` : '/'
  return {
    serverName,
    previewPath,
    search: candidate.search,
  }
}

export function buildSiteViewerUrl(serverName: string, previewPath?: string): string | null {
  const origin = resolveSiteViewerOrigin()
  if (!origin) return null

  const encodedServerPath = encodePath(serverName.trim())
  if (!encodedServerPath) return null

  const encodedPreviewPath = encodePath(normalizePreviewPath(previewPath))
  const pathname = encodedPreviewPath
    ? `/${encodedServerPath}/${encodedPreviewPath}`
    : `/${encodedServerPath}/`

  try {
    return new URL(pathname, `${origin}/`).toString()
  } catch {
    return null
  }
}
