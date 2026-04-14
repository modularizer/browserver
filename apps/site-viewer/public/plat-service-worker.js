/* eslint-disable */
// Site viewer service worker — runs the whole show.
//
// Server names can have ANY number of path segments (the authority owns the
// canonical mapping). The shell window posts every matchedServerName it
// resolves via PLAT_REGISTER_SITE; this SW persists them in the shell cache
// and routes incoming requests by **longest registered prefix**.
//
// Routes:
//   • Top-level navigation to any non-app path → returns the cached shell
//     so the shell can resolve the server name and register it.
//   • Subresource requests whose pathname starts with a registered prefix
//     → forwarded via the bridge (serverName = prefix, path = remainder).
//   • Other subresource requests whose referrer is itself a registered-prefix
//     URL → forwarded with serverName = referrer's prefix and path = the
//     request pathname (lets root-absolute `/style.css` work).
//   • Our own app URLs (/, /src/*, /assets/*, @vite, favicons, this SW) →
//     passed through to the network so dev/prod asset serving keeps working.

const SHELL_CACHE = 'site-viewer-shell-v2'
const SHELL_URL = '/'

const APP_PATH_EXACT = new Set(['/', '/favicon.ico', '/plat-service-worker.js'])
function isAppPath(pathname) {
  if (APP_PATH_EXACT.has(pathname)) return true
  if (pathname.startsWith('/src/')) return true
  if (pathname.startsWith('/@vite/')) return true
  if (pathname.startsWith('/@fs/')) return true
  if (pathname.startsWith('/@id/')) return true
  if (pathname.startsWith('/node_modules/')) return true
  if (pathname.startsWith('/assets/')) return true
  if (pathname.startsWith('/favicon-')) return true
  return false
}

function parseSitePath(pathname) {
  if (isAppPath(pathname)) return null
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null
  let serverName
  try { serverName = segments.slice(0, 2).map(decodeURIComponent).join('/') }
  catch { serverName = segments.slice(0, 2).join('/') }
  const tail = segments.slice(2).join('/')
  return { serverName, tailPath: '/' + tail }
}

const pending = new Map()
function randomId() {
  return 'sw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

const SW_VERSION = 'v2-2026-04-14-evict'
console.log('[site-viewer-sw]', SW_VERSION, 'script loaded at', new Date().toISOString())

self.addEventListener('install', (event) => {
  console.log('[site-viewer-sw] install')
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    try { await cache.add(SHELL_URL) } catch (err) { console.warn('[site-viewer-sw] shell cache failed', err) }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  console.log('[site-viewer-sw] activate')
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => CACHE_ALLOWLIST.has(k) ? null : caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  const msg = event.data
  if (!msg) return
  if (msg.type === 'PLAT_SKIP_WAITING') { self.skipWaiting(); return }
  if (msg.type === 'PLAT_PURGE_CONTENT_CACHE') {
    event.waitUntil(caches.delete(CONTENT_CACHE).then(() => {
      console.log('[site-viewer-sw] content cache purged')
    }))
    return
  }
  if (msg.type === 'PLAT_RESPONSE') {
    const p = pending.get(msg.id)
    if (!p) return
    pending.delete(msg.id)
    p.resolve(msg)
  }
})

async function readBodyBuffer(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const buf = await req.arrayBuffer()
  return buf.byteLength === 0 ? undefined : buf
}

async function resolveTransportHost(preferredClientId) {
  if (preferredClientId) {
    const c = await self.clients.get(preferredClientId)
    if (c) return c
  }
  const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  return all[0] ?? null
}

async function forwardViaBridge(event, target, headerOverrides) {
  try {
    const body = await readBodyBuffer(event.request.clone())
    const client = await resolveTransportHost(event.clientId)
    if (!client) throw new Error('No window available to host the transport')

    const id = randomId()
    const responsePromise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
    })

    const headers = {}
    event.request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
    if (headerOverrides) for (const k in headerOverrides) {
      const v = headerOverrides[k]
      if (v === null || v === undefined || v === '') delete headers[k.toLowerCase()]
      else headers[k.toLowerCase()] = v
    }

    const msg = {
      type: 'PLAT_REQUEST', id,
      clientId: event.clientId,
      serverName: target.serverName,
      method: event.request.method,
      path: target.tailPath + new URL(event.request.url).search,
      headers,
      body,
    }
    client.postMessage(msg, body ? [body] : [])

    console.log('[site-viewer-sw] → PLAT_REQUEST', event.request.method, target.serverName, msg.path,
      'etag-req=', headers['if-none-match'] ?? '-')
    const response = await Promise.race([
      responsePromise,
      new Promise((_, reject) => setTimeout(() => {
        pending.delete(id)
        reject(new Error('transport request timeout'))
      }, 30000)),
    ])
    const bodyLen = response.body instanceof ArrayBuffer ? response.body.byteLength : (response.body ? 'unknown' : 0)
    console.log('[site-viewer-sw] ← PLAT_RESPONSE', msg.path, response.status,
      'bytes=', bodyLen, 'ct=', (response.headers || {})['content-type'],
      'etag=', (response.headers || {}).etag ?? '-')
    if (response.status >= 400 && response.body instanceof ArrayBuffer) {
      try { console.warn('[site-viewer-sw] error body:', new TextDecoder().decode(response.body)) } catch {}
    }
    return new Response(response.body ?? null, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers || {}),
    })
  } catch (err) {
    return new Response('[site-viewer-sw] ' + (err?.message ?? String(err)), {
      status: 502, statusText: 'Bad Gateway',
      headers: { 'content-type': 'text/plain' },
    })
  }
}

// ---------------------------------------------------------------------------
// Content cache: stale-while-revalidate keyed by site URL.
// Stores the response with an `x-cached-at` header so we can compute freshness
// against `cache-control: max-age`. Revalidates with `If-None-Match: <etag>`
// when the server emitted one.
// ---------------------------------------------------------------------------

const CONTENT_CACHE = 'site-viewer-content-v2'
const CACHE_ALLOWLIST = new Set([SHELL_CACHE, CONTENT_CACHE])

function isCacheableMethod(method) {
  return method === 'GET' || method === 'HEAD'
}

function shouldStore(response) {
  if (!response.ok) return false
  const cc = (response.headers.get('cache-control') || '').toLowerCase()
  if (cc.includes('no-store')) return false
  // Cache anything with an etag or an explicit max-age. Without either we
  // have no way to know it's safe to reuse.
  return Boolean(response.headers.get('etag')) || /max-age=\d+/.test(cc)
}

function maxAgeMs(response) {
  const cc = response.headers.get('cache-control') || ''
  const m = /max-age=(\d+)/i.exec(cc)
  return m ? parseInt(m[1], 10) * 1000 : 0
}

function isFresh(response) {
  const age = maxAgeMs(response)
  if (!age) return false
  const cachedAt = parseInt(response.headers.get('x-cached-at') || '0', 10)
  return Date.now() - cachedAt < age
}

async function putInCache(cacheKey, response) {
  const cache = await caches.open(CONTENT_CACHE)
  const headers = new Headers(response.headers)
  headers.set('x-cached-at', String(Date.now()))
  const body = await response.clone().arrayBuffer()
  await cache.put(cacheKey, new Response(body, {
    status: response.status, statusText: response.statusText, headers,
  }))
}

async function refreshCachedTimestamp(cacheKey, cached, freshHeaders) {
  const cache = await caches.open(CONTENT_CACHE)
  const headers = new Headers(cached.headers)
  headers.set('x-cached-at', String(Date.now()))
  const newCC = freshHeaders.get('cache-control')
  if (newCC) headers.set('cache-control', newCC)
  const body = await cached.clone().arrayBuffer()
  const refreshed = new Response(body, {
    status: cached.status, statusText: cached.statusText, headers,
  })
  await cache.put(cacheKey, refreshed)
}

async function revalidateInBackground(event, target, cacheKey, cached) {
  const overrides = {}
  const etag = cached.headers.get('etag')
  if (etag) overrides['if-none-match'] = etag
  try {
    const fresh = await forwardViaBridge(event, target, overrides)
    if (fresh.status === 304) {
      const cachedBody = await cached.clone().arrayBuffer()
      if (cachedBody.byteLength === 0) {
        console.warn('[site-viewer-sw] 304 against empty cached body — refetching full', cacheKey)
        const full = await forwardViaBridge(event, target, { 'if-none-match': '' })
        if (shouldStore(full)) await putInCache(cacheKey, full)
        return
      }
      await refreshCachedTimestamp(cacheKey, cached, fresh.headers)
    } else if (shouldStore(fresh)) {
      await putInCache(cacheKey, fresh)
    }
  } catch (err) {
    console.warn('[site-viewer-sw] revalidation failed', cacheKey, err)
  }
}

async function cachedForwardViaBridge(event, target) {
  if (!isCacheableMethod(event.request.method)) {
    return forwardViaBridge(event, target)
  }
  const cacheKey = event.request.url
  const cache = await caches.open(CONTENT_CACHE)

  // Hard refresh (Ctrl+Shift+R) sets request.cache to 'reload' or 'no-cache'.
  // Bypass our cache entirely and purge the stale entry so the fresh response
  // replaces it. Also accept an explicit `cache-control: no-cache` header.
  const reqCache = event.request.cache
  const reqCC = (event.request.headers.get('cache-control') || '').toLowerCase()
  if (reqCache === 'reload' || reqCache === 'no-cache' || reqCC.includes('no-cache')) {
    console.log('[site-viewer-sw] hard refresh → bypass cache', event.request.url, 'cache=', reqCache)
    await cache.delete(cacheKey)
    const fresh = await forwardViaBridge(event, target, { 'if-none-match': '' })
    if (shouldStore(fresh)) event.waitUntil(putInCache(cacheKey, fresh.clone()))
    return fresh
  }

  let cached = await cache.match(cacheKey)

  if (cached) {
    const probeBuf = await cached.clone().arrayBuffer()
    if (probeBuf.byteLength === 0) {
      console.warn('[site-viewer-sw] evicting zero-byte cached entry', event.request.url)
      await cache.delete(cacheKey)
      cached = undefined
    }
  }

  if (cached) {
    console.log('[site-viewer-sw] cache HIT → serve + revalidate', event.request.url)
    const forRevalidate = cached.clone()
    event.waitUntil(revalidateInBackground(event, target, cacheKey, forRevalidate))
    return cached
  }

  console.log('[site-viewer-sw] cache MISS', event.request.url)
  // Cold cache: must wait for the transport. Strip any client-supplied
  // If-None-Match — we have nothing to back a 304 with, so a conditional
  // response would leave us with an empty body.
  const fresh = await forwardViaBridge(event, target, { 'if-none-match': '' })
  if (shouldStore(fresh)) {
    console.log('[site-viewer-sw] caching', event.request.url, 'etag=', fresh.headers.get('etag'), 'cc=', fresh.headers.get('cache-control'))
    // Persist a clone, hand the original to the page.
    event.waitUntil(putInCache(cacheKey, fresh.clone()))
  } else {
    console.log('[site-viewer-sw] NOT caching', event.request.url, 'status=', fresh.status,
      'etag=', fresh.headers.get('etag'), 'cc=', fresh.headers.get('cache-control'))
  }
  return fresh
}

async function respondWithShell(request) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(SHELL_URL)
  if (cached) return cached
  // First activation racing with navigation — fall back to network and
  // seed the cache for next time.
  const fresh = await fetch(SHELL_URL, { credentials: 'same-origin' })
  if (fresh.ok) { try { await cache.put(SHELL_URL, fresh.clone()) } catch {} }
  return fresh
}

function resolveTargetFromRequest(request) {
  const u = new URL(request.url)
  if (u.origin !== self.location.origin) return null

  const direct = parseSitePath(u.pathname)
  if (direct) return direct

  if (isAppPath(u.pathname)) return null
  if (!request.referrer) return null
  try {
    const ref = new URL(request.referrer)
    if (ref.origin !== self.location.origin) return null
    const refTarget = parseSitePath(ref.pathname)
    if (!refTarget) return null
    return { serverName: refTarget.serverName, tailPath: u.pathname }
  } catch { return null }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  const u = new URL(req.url)

  if (req.mode === 'navigate' && parseSitePath(u.pathname)) {
    console.log('[site-viewer-sw] nav → shell', u.pathname)
    event.respondWith(respondWithShell(req))
    return
  }

  const target = resolveTargetFromRequest(req)
  if (!target) {
    console.log('[site-viewer-sw] passthrough', req.method, u.pathname, 'ref=', req.referrer || '-')
    return
  }
  console.log('[site-viewer-sw] intercept', req.method, u.pathname, '→', target.serverName, target.tailPath)
  event.respondWith(cachedForwardViaBridge(event, target))
})
