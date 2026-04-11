export interface ParsedStudioRoute {
  mode: 'ide' | 'preview'
  projectName: string | null
  serverName: string | null
  basePath: string
}

function normalizeBasePath(rawBasePath?: string): string {
  const candidate = (rawBasePath ?? '/').trim() || '/'
  if (candidate === '/') return '/'
  return `/${candidate.replace(/^\/+|\/+$/g, '')}/`
}

function trimSurroundingSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
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

function stripBasePath(pathname: string, basePath: string): string {
  if (basePath === '/') return pathname
  const baseNoTrailingSlash = basePath.replace(/\/+$/, '')
  return pathname === baseNoTrailingSlash
    ? '/'
    : (pathname.startsWith(`${baseNoTrailingSlash}/`) ? pathname.slice(baseNoTrailingSlash.length) : pathname)
}

/**
 * Route rules:
 * - /<project>/bs -> IDE for project
 * - /<server>      -> full-page preview for server
 * - /site/<server> -> legacy preview route
 */
export function parseStudioRoute(pathname: string, basePath?: string): ParsedStudioRoute {
  const normalizedBasePath = normalizeBasePath(basePath)
  const routePath = stripBasePath(pathname, normalizedBasePath)
  const segments = splitPath(routePath)

  if (segments.length >= 2 && segments.at(-1) === 'bs') {
    const projectName = decodePathSegments(segments.slice(0, -1)) || null
    return {
      mode: 'ide',
      projectName,
      serverName: null,
      basePath: normalizedBasePath,
    }
  }

  if (segments[0] === 'site') {
    return {
      mode: 'preview',
      projectName: null,
      serverName: decodePathSegments(segments.slice(1)) || null,
      basePath: normalizedBasePath,
    }
  }

  if (segments.length > 0) {
    return {
      mode: 'preview',
      projectName: null,
      serverName: decodePathSegments(segments),
      basePath: normalizedBasePath,
    }
  }

  return {
    mode: 'ide',
    projectName: null,
    serverName: null,
    basePath: normalizedBasePath,
  }
}
