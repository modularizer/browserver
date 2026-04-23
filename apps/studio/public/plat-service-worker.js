/* eslint-disable */
// Browserver Service Worker — intercepts HTTP requests from iframes rendering
// client-side-server (css://) sites and forwards them to the main thread, which
// routes through the plat channel.
//
// Scope: the directory this file is served from (e.g. "/" or "/browserver/").
// Intercepted URLs:
//   1) Any request under `${scope}__css/<encodedServerName>/...` — the serverName
//      is recovered from the first path segment and the rest becomes the request
//      path sent to the css server.
//   2) Same-origin requests whose referrer is already inside `${scope}__css/...`.
//      This catches absolute URLs emitted by the hosted site after the iframe is
//      already rendering through the css bridge.
// Everything else passes through to the network unchanged.

const pending = new Map()

function computeBase() {
  // self.location is the URL this worker script was fetched from.
  // Strip the filename to get the base path.
  const path = new URL(self.location.href).pathname
  return path.replace(/plat-service-worker\.js$/, '')
}
const BASE = computeBase()
const CSS_PREFIX = BASE + '__css/'
console.log('[browserver-sw] loaded; base=', BASE, 'prefix=', CSS_PREFIX)

function randomId() {
  return 'sw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

function stripBasePath(pathname) {
  if (BASE === '/') return pathname
  const baseNoTrailingSlash = BASE.replace(/\/+$/, '')
  if (pathname === baseNoTrailingSlash) return '/'
  return pathname.startsWith(baseNoTrailingSlash + '/') ? pathname.slice(baseNoTrailingSlash.length) : pathname
}

function isWorkbenchPath(pathname) {
  const stripped = stripBasePath(pathname)
  if (!stripped || stripped === '/') return true
  if (stripped.startsWith('/__css/')) return false
  if (stripped === '/site' || stripped.startsWith('/site/')) return false
  if (stripped.startsWith('/assets/')) return true
  if (stripped === '/plat-service-worker.js') return true
  return true
}

function isDevOrAppAssetPath(pathname) {
  const stripped = stripBasePath(pathname)
  return (
    stripped.startsWith('/@vite/')
    || stripped.startsWith('/@fs/')
    || stripped.startsWith('/src/')
    || stripped.startsWith('/node_modules/')
    || stripped === '/favicon.ico'
    || stripped.startsWith('/favicon-')
  )
}

function parseCssReferrerTarget(referrerUrl, requestUrl) {
  if (!referrerUrl.pathname.startsWith(CSS_PREFIX)) return null
  const rest = referrerUrl.pathname.slice(CSS_PREFIX.length)
  const slash = rest.indexOf('/')
  const encodedName = slash === -1 ? rest : rest.slice(0, slash)
  if (!encodedName) return null

  let serverName
  try { serverName = decodeURIComponent(encodedName) } catch { serverName = encodedName }

  const strippedPath = stripBasePath(requestUrl.pathname)
  return {
    serverName,
    path: `${strippedPath || '/'}${requestUrl.search}`,
  }
}

// (base64 helpers removed — we now pass ArrayBuffers directly via structured cloning)

function parseCssTarget(request) {
  const u = new URL(request.url)
  if (u.origin !== self.location.origin) return null

  if (u.pathname.startsWith(CSS_PREFIX)) {
    const rest = u.pathname.slice(CSS_PREFIX.length)
    const slash = rest.indexOf('/')
    const encodedName = slash === -1 ? rest : rest.slice(0, slash)
    if (!encodedName) return null
    const tail = slash === -1 ? '' : rest.slice(slash)
    let serverName
    try { serverName = decodeURIComponent(encodedName) } catch { serverName = encodedName }
    return { serverName, path: (tail || '/') + u.search }
  }

  if (isWorkbenchPath(u.pathname) || isDevOrAppAssetPath(u.pathname)) {
    return null
  }

  if (!request.referrer) {
    return null
  }

  try {
    const referrerUrl = new URL(request.referrer)
    if (referrerUrl.origin !== self.location.origin) return null
    return parseCssReferrerTarget(referrerUrl, u)
  } catch {
    return null
  }
}

async function readBodyBuffer(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const buf = await req.arrayBuffer()
  if (buf.byteLength === 0) return undefined
  return buf
}

self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

self.addEventListener('message', (event) => {
  const msg = event.data
  if (!msg) return
  if (msg.type === 'PLAT_SKIP_WAITING') { self.skipWaiting(); return }
  if (msg.type === 'PLAT_RESPONSE') {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    p.resolve(msg)
  }
})

async function resolveClient(clientId) {
  // We must post PLAT_REQUEST to a host page that has the main-thread handler
  // installed — NOT the iframe that originated the request. The iframe's URL
  // is inside /__css/, so prefer any client outside that prefix.
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const host = all.find((c) => {
    try { return !new URL(c.url).pathname.startsWith(CSS_PREFIX) } catch { return false }
  })
  if (host) return host
  if (clientId) {
    const c = await self.clients.get(clientId)
    if (c) return c
  }
  return all[0]
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  // console.log('[browserver-sw] fetch event', req.url, 'referrer=', req.referrer, 'mode=', req.mode, 'dest=', req.destination)
  const target = parseCssTarget(req)
  if (!target) {
    // console.log('[browserver-sw] NOT intercepting', req.url, '— parseCssTarget returned null')
    return
  }
  console.log('[browserver-sw] intercepting', req.url, '→', target.serverName, target.path)

  const headers = {}
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })

  event.respondWith((async () => {
    try {
      const body = await readBodyBuffer(req.clone())
      const client = await resolveClient(event.clientId)
      if (!client) throw new Error('No client available to handle css request')

      const id = randomId()
      const responsePromise = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
      })

      const msg = {
        type: 'PLAT_REQUEST',
        id,
        clientId: event.clientId,
        serverName: target.serverName,
        method: req.method,
        path: target.path,
        headers,
        body,
      }
      client.postMessage(msg, body ? [body] : [])

      const response = await Promise.race([
        responsePromise,
        new Promise((_, reject) => setTimeout(() => {
          pending.delete(id)
          reject(new Error('css request timeout'))
        }, 30000)),
      ])

      const responseHeaders = new Headers(response.headers || {})
      const responseBody = response.body ?? null
      if (responseBody instanceof ArrayBuffer && responseBody.byteLength >= 4) {
        const v = new Uint8Array(responseBody)
        console.log('[browserver-sw] response body first bytes', v[0].toString(16), v[1].toString(16), v[2].toString(16), v[3].toString(16), 'len=', responseBody.byteLength)
      }

      return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      })
    } catch (err) {
      const message = err && err.message ? err.message : String(err)
      return new Response('[browserver-sw] ' + message, {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'content-type': 'text/plain' },
      })
    }
  })())
})
