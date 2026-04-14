import { createBrowserverCssFetchConnection, type BrowserverCssFetchConnection } from './cssTransport'

interface PlatRequestMessage {
  type: 'PLAT_REQUEST'
  id: string
  clientId?: string
  serverName: string
  method: string
  path: string
  headers: Record<string, string>
  body?: ArrayBuffer
}

interface PlatResponseMessage {
  type: 'PLAT_RESPONSE'
  id: string
  status: number
  statusText: string
  headers: Record<string, string>
  body?: ArrayBuffer
  error?: string
}

/**
 * Connections are keyed by the canonical (authority-matched) server name.
 * An alias map tracks every requested name that resolved to each canonical
 * name, so later requests naming either form reuse the same pipe.
 */
const connectionsByMatched = new Map<string, Promise<BrowserverCssFetchConnection>>()
const requestedToMatched = new Map<string, string>()

interface ResolvedCssServer {
  matchedServerName: string
  initialPath: string
}

async function resolveAndConnect(requestedName: string): Promise<BrowserverCssFetchConnection> {
  const cachedMatch = requestedToMatched.get(requestedName)
  if (cachedMatch) {
    const cached = connectionsByMatched.get(cachedMatch)
    if (cached) return cached
  }

  const pending = (async () => {
    const connection = await createBrowserverCssFetchConnection(`css://${requestedName}`)
    requestedToMatched.set(requestedName, connection.matchedServerName)
    return connection
  })()

  const tentative = pending.then((c) => c)
  // Store under requested name too so a second call while pending reuses.
  const placeholderKey = `__pending:${requestedName}`
  connectionsByMatched.set(placeholderKey, tentative)

  try {
    const connection = await pending
    connectionsByMatched.delete(placeholderKey)
    const existing = connectionsByMatched.get(connection.matchedServerName)
    if (existing) {
      // Another caller raced to resolve the same canonical. Drop ours.
      await connection.close?.()
      return existing
    }
    connectionsByMatched.set(connection.matchedServerName, Promise.resolve(connection))
    return connection
  } catch (err) {
    connectionsByMatched.delete(placeholderKey)
    requestedToMatched.delete(requestedName)
    throw err
  }
}

export async function resolveCssServer(requestedName: string): Promise<ResolvedCssServer> {
  const connection = await resolveAndConnect(requestedName)
  return {
    matchedServerName: connection.matchedServerName,
    initialPath: connection.initialPath,
  }
}

const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
])

const MIME_BY_EXT: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  wasm: 'application/wasm',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  map: 'application/json; charset=utf-8',
}

function sniffContentType(path: string, upstream: string | undefined): string | undefined {
  if (upstream && !/^application\/octet-stream\b/i.test(upstream)) return upstream
  const match = /\.([A-Za-z0-9]+)(?:[?#]|$)/.exec(path)
  const ext = match?.[1]?.toLowerCase()
  if (ext && MIME_BY_EXT[ext]) return MIME_BY_EXT[ext]
  return upstream
}

function combineResolvedRequestPath(initialPath: string, requestPath: string): string {
  const parse = (value: string) => {
    const queryIndex = value.indexOf('?')
    return {
      pathname: queryIndex >= 0 ? value.slice(0, queryIndex) : value,
      search: queryIndex >= 0 ? value.slice(queryIndex) : '',
    }
  }

  const base = parse(initialPath || '')
  const incoming = parse(requestPath || '/')
  const normalizedBase = base.pathname ? `/${base.pathname.replace(/^\/+|\/+$/g, '')}` : ''
  const normalizedIncoming = incoming.pathname.startsWith('/') ? incoming.pathname : `/${incoming.pathname}`
  const pathname = normalizedBase && normalizedIncoming !== '/'
    ? `${normalizedBase}${normalizedIncoming}`
    : (normalizedBase || normalizedIncoming || '/')
  const search = incoming.search || base.search
  return `${pathname || '/'}${search}`
}

async function handleRequest(msg: PlatRequestMessage): Promise<PlatResponseMessage> {
  console.log('[browserver-sw-client] PLAT_REQUEST', msg.method, msg.serverName, msg.path)
  try {
    const connection = await resolveAndConnect(msg.serverName)
    const effectivePath = combineResolvedRequestPath(connection.initialPath, msg.path)
    const response = await connection.fetch(effectivePath, {
      method: msg.method,
      headers: msg.headers,
      body: msg.body as BodyInit | undefined,
    })
    const headers: Record<string, string> = {}
    response.headers.forEach((v, k) => {
      if (!STRIPPED_RESPONSE_HEADERS.has(k.toLowerCase())) headers[k] = v
    })
    const sniffed = sniffContentType(effectivePath, headers['content-type'])
    if (sniffed) headers['content-type'] = sniffed
    const body = await response.arrayBuffer()
    const v = body.byteLength >= 4 ? new Uint8Array(body, 0, 4) : null
    console.log(
      '[browserver-sw-client] PLAT_RESPONSE', effectivePath, response.status,
      'bytes=', body.byteLength, 'ct=', headers['content-type'],
      'first=', v ? [v[0], v[1], v[2], v[3]].map((b) => b.toString(16)).join(' ') : '-',
    )
    return {
      type: 'PLAT_RESPONSE',
      id: msg.id,
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
    }
  } catch (err) {
    console.error('[browserver-sw-client] handleRequest error', msg.path, err)
    return {
      type: 'PLAT_RESPONSE',
      id: msg.id,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { 'content-type': 'text/plain' },
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

let installed: Promise<void> | null = null

export function installCssServiceWorker(): Promise<void> {
  if (installed) return installed
  installed = (async () => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      throw new Error('Service workers are not supported in this browser')
    }
    const base = import.meta.env.BASE_URL || '/'
    const workerUrl = `${base}plat-service-worker.js`
    const registration = await navigator.serviceWorker.register(workerUrl, { scope: base })
    if (registration.waiting) {
      registration.waiting.postMessage({ type: 'PLAT_SKIP_WAITING' })
    }
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        const onChange = () => {
          navigator.serviceWorker.removeEventListener('controllerchange', onChange)
          resolve()
        }
        navigator.serviceWorker.addEventListener('controllerchange', onChange)
        setTimeout(() => {
          navigator.serviceWorker.removeEventListener('controllerchange', onChange)
          resolve()
        }, 2000)
      })
    }

    navigator.serviceWorker.addEventListener('message', async (event) => {
      const msg = event.data as PlatRequestMessage
      if (!msg || msg.type !== 'PLAT_REQUEST') return
      const response = await handleRequest(msg)
      const target = (event.source as ServiceWorker | null) ?? navigator.serviceWorker.controller
      const transfer = response.body ? [response.body] : []
      target?.postMessage(response, transfer)
    })
  })()
  return installed
}

function encodeServerNameSegment(serverName: string): string {
  return serverName
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('%2F')
}

export function buildCssIframeUrl(serverName: string, extraPath: string = ''): string {
  const base = import.meta.env.BASE_URL || '/'
  const encoded = encodeServerNameSegment(serverName)
  const tail = extraPath ? (extraPath.startsWith('/') ? extraPath : `/${extraPath}`) : '/'
  return `${base}__css/${encoded}${tail}`
}
