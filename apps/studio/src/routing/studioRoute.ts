export interface ParsedStudioRoute {
  mode: 'ide' | 'preview'
  projectName: string | null
  serverName: string | null
  previewPath?: string
  previewMode?: 'browser' | 'api'
  apiViewMode?: 'client' | 'ts-console' | 'py-console' | 'cli' | 'swagger' | 'redoc' | 'json' | 'yaml'
  targetUrl?: string
  basePath: string
}
const previewApiModeBySuffix = {
  client: 'client',
  ts: 'ts-console',
  python: 'py-console',
  cli: 'cli',
  swagger: 'swagger',
  redoc: 'redoc',
  json: 'json',
  yaml: 'yaml',
} as const
const remoteProtocolByPrefix = {
  http: 'http',
  https: 'https',
  h: 'https',
} as const
function normalizeBasePath(rawBasePath?: string): string {
  const candidate = (rawBasePath ?? '/').trim() || '/'
  if (candidate === '/') return '/'
  return `/${candidate.replace(/^\/+|\/+$/g, '')}/`
}
function trimSurroundingSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}
function encodePathSegments(value: string): string {
  return trimSurroundingSlashes(value)
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}
function decodePathSegments(segments: string[]): string {
  return segments
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')
}
function splitPath(pathname: string): string[] {
  return trimSurroundingSlashes(pathname).split('/').filter(Boolean)
}

function splitBrowserPreviewSegments(previewSegments: string[]): { serverName: string | null; previewPath: string } {
  if (previewSegments.length === 0) {
    return { serverName: null, previewPath: '/' }
  }

  // Browserver server names are currently two-part slugs in practice:
  // `namespace/project` (or `dmz/project`, plus optional pane suffixes on the
  // project segment). Treat any remaining segments as the requested in-site path.
  const serverSegments = previewSegments.length >= 2
    ? previewSegments.slice(0, 2)
    : previewSegments
  const pathSegments = previewSegments.slice(serverSegments.length)
  const serverName = decodePathSegments(serverSegments) || null
  const previewPath = pathSegments.length > 0 ? `/${decodePathSegments(pathSegments)}` : '/'
  return { serverName, previewPath }
}

function stripBasePath(pathname: string, basePath: string): string {
  if (basePath === '/') return pathname
  const baseNoTrailingSlash = basePath.replace(/\/+$/, '')
  return pathname === baseNoTrailingSlash
    ? '/'
    : (pathname.startsWith(`${baseNoTrailingSlash}/`) ? pathname.slice(baseNoTrailingSlash.length) : pathname)
}
export function parseStudioRoute(pathname: string, basePath?: string): ParsedStudioRoute {
  const normalizedBasePath = normalizeBasePath(basePath)
  const routePath = stripBasePath(pathname, normalizedBasePath)
  const segments = splitPath(routePath)
  const resolvePreviewRoute = (previewSegments: string[]): ParsedStudioRoute => {
    const suffix = previewSegments.at(-1) ?? ''
    const apiViewMode = suffix in previewApiModeBySuffix
      ? previewApiModeBySuffix[suffix as keyof typeof previewApiModeBySuffix]
      : null
    const serverSegments = apiViewMode ? previewSegments.slice(0, -1) : previewSegments
    const remotePrefix = serverSegments[0] ?? ''
    if (remotePrefix in remoteProtocolByPrefix) {
      const remoteTarget = decodePathSegments(serverSegments.slice(1)) || null
      const protocol = remoteProtocolByPrefix[remotePrefix as keyof typeof remoteProtocolByPrefix]
      return {
        mode: 'preview',
        projectName: null,
        serverName: remoteTarget,
        previewPath: '/',
        previewMode: 'api',
        apiViewMode: apiViewMode ?? 'client',
        targetUrl: remoteTarget ? `${protocol}://${remoteTarget}` : undefined,
        basePath: normalizedBasePath,
      }
    }
    const browserPreview = splitBrowserPreviewSegments(serverSegments)
    return {
      mode: 'preview',
      projectName: null,
      serverName: browserPreview.serverName,
      previewPath: browserPreview.previewPath,
      previewMode: apiViewMode ? 'api' : 'browser',
      apiViewMode: apiViewMode ?? undefined,
      targetUrl: undefined,
      basePath: normalizedBasePath,
    }
  }
  if (segments.length >= 2 && segments.at(-1) === 'bs') {
    const projectName = decodePathSegments(segments.slice(0, -1)) || null
    return {
      mode: 'ide',
      projectName,
      serverName: null,
      previewPath: undefined,
      previewMode: undefined,
      apiViewMode: undefined,
      targetUrl: undefined,
      basePath: normalizedBasePath,
    }
  }
  if (segments[0] === 'site') {
    return resolvePreviewRoute(segments.slice(1))
  }
  if (segments.length > 0) {
    return {
      mode: 'ide',
      projectName: decodePathSegments(segments) || null,
      serverName: null,
      previewPath: undefined,
      previewMode: undefined,
      apiViewMode: undefined,
      targetUrl: undefined,
      basePath: normalizedBasePath,
    }
  }
  return {
    mode: 'ide',
    projectName: null,
    serverName: null,
    previewPath: undefined,
    previewMode: undefined,
    apiViewMode: undefined,
    targetUrl: undefined,
    basePath: normalizedBasePath,
  }
}
export function buildIdeRoutePath(projectName: string, basePath?: string): string {
  const normalizedBasePath = normalizeBasePath(basePath)
  const encodedProject = encodePathSegments(projectName)
  if (!encodedProject) return normalizedBasePath
  return `${normalizedBasePath}${encodedProject}`
}
