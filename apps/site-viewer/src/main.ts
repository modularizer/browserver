// Site viewer shell — runs inside the SW-served top-level document.
//
// Responsibilities:
//   1. Install the PLAT_REQUEST ↔ PLAT_RESPONSE transport bridge the SW
//      relies on to forward subresource requests.
//   2. Register the service worker (first visit only — subsequent visits
//      are already controlled when this script runs).
//   3. Fetch the current URL, which goes back through the SW → bridge →
//      WebRTC → authority, and render the returned HTML into the document.
//
// TODO: transport code is relative-imported from the studio app; extract
// into a shared package so this app stands fully alone.

import {
  createBrowserverCssFetchConnection,
  type BrowserverCssFetchConnection,
} from '../../studio/src/runtime/cssTransport'

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

const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive',
])

const MIME_BY_EXT: Record<string, string> = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  wasm: 'application/wasm', txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8', map: 'application/json; charset=utf-8',
}

function sniffContentType(path: string, upstream: string | undefined): string | undefined {
  if (upstream && !/^application\/octet-stream\b/i.test(upstream)) return upstream
  const match = /\.([A-Za-z0-9]+)(?:[?#]|$)/.exec(path)
  const ext = match?.[1]?.toLowerCase()
  if (ext && MIME_BY_EXT[ext]) return MIME_BY_EXT[ext]
  return upstream
}

function parseTargetFromLocation(): { serverName: string; requestPath: string } | null {
  const segments = window.location.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const serverName = segments.slice(0, 2).map(decodeURIComponent).join('/')
  const tailSegments = segments.slice(2)
  const tail = tailSegments.length ? '/' + tailSegments.map(decodeURIComponent).join('/') : '/'
  return { serverName, requestPath: tail + window.location.search }
}

function setStatus(text: string, isError = false): void {
  const el = document.getElementById('bootstrap')
  if (!el) return
  el.textContent = text
  el.classList.toggle('error', isError)
}

const FALLBACK_FAVICON_PATH = '/sample-favicon.svg'
const IMPLICIT_FAVICON_CANDIDATES = [
  '/favicon.ico',
  '/favicon.svg',
  '/favicon.png',
]

function ensureHead(): HTMLHeadElement {
  if (document.head) return document.head
  const head = document.createElement('head')
  const html = document.documentElement
  if (html.firstChild) {
    html.insertBefore(head, html.firstChild)
  } else {
    html.appendChild(head)
  }
  return head
}

function upsertFaviconLink(href: string, type?: string): void {
  const head = ensureHead()
  let link = head.querySelector('link[rel~="icon"]') as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    head.appendChild(link)
  }
  if (type) link.type = type
  link.href = href
}

function hasExplicitFavicon(): boolean {
  return !!document.head?.querySelector('link[rel~="icon"]')
}

async function findImplicitFavicon(): Promise<{ href: string; type?: string } | null> {
  for (const href of IMPLICIT_FAVICON_CANDIDATES) {
    try {
      const response = await fetch(href, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'default',
      })
      if (!response.ok) continue
      const contentType = (response.headers.get('content-type') || '').toLowerCase()
      if (contentType.startsWith('image/')) {
        return { href, type: contentType }
      }
    } catch {
      // Ignore and try the next common filename.
    }
  }
  return null
}

async function ensureDocumentFavicon(): Promise<void> {
  if (hasExplicitFavicon()) return
  const implicit = await findImplicitFavicon()
  if (hasExplicitFavicon()) return
  if (implicit) {
    upsertFaviconLink(implicit.href, implicit.type)
    return
  }
  upsertFaviconLink(FALLBACK_FAVICON_PATH, 'image/svg+xml')
}

const connections = new Map<string, Promise<BrowserverCssFetchConnection>>()
function getConnection(serverName: string): Promise<BrowserverCssFetchConnection> {
  let existing = connections.get(serverName)
  if (existing) return existing
  const pending = createBrowserverCssFetchConnection(`css://${serverName}`).then((conn) => {
    connections.set(conn.matchedServerName, Promise.resolve(conn))
    conn.onPeerEvent(async (event) => {
      if (event === 'workspace-files-changed') {
        console.log('[site-viewer] workspace-files-changed → hot swap')
        // Fetch the fresh response behind the scenes (bypassing the SW cache)
        // then swap the document in place — avoids the blank-reload flash.
        try {
          const sw = navigator.serviceWorker.controller
          if (sw) {
            await new Promise<void>((resolve) => {
              const ch = new MessageChannel()
              ch.port1.onmessage = () => resolve()
              try { sw.postMessage({ type: 'PLAT_PURGE_CONTENT_CACHE' }, [ch.port2]) }
              catch { resolve() }
              setTimeout(resolve, 500)
            })
          }
          const fresh = await fetch(window.location.pathname + window.location.search, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'reload',
          })
          await renderResponse(fresh)
        } catch (err) {
          console.warn('[site-viewer] hot swap failed, falling back to reload', err)
          window.location.reload()
        }
      }
    })
    return conn
  })
  connections.set(serverName, pending)
  return pending
}

function installTransportBridge(): void {
  navigator.serviceWorker.addEventListener('message', async (event) => {
    const msg = event.data as PlatRequestMessage | undefined
    if (!msg || msg.type !== 'PLAT_REQUEST') return

    const reply: PlatResponseMessage = await (async () => {
      try {
        const connection = await getConnection(msg.serverName)
        const effectivePath = connection.initialPath && connection.initialPath !== '/'
          ? `${connection.initialPath.replace(/\/+$/, '')}${msg.path}`
          : msg.path
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
        return {
          type: 'PLAT_RESPONSE', id: msg.id,
          status: response.status, statusText: response.statusText,
          headers, body,
        }
      } catch (err) {
        const message = err instanceof Error ? (err.stack ?? err.message) : String(err)
        const body = new TextEncoder().encode(`[site-viewer bridge] ${message}`).buffer
        return {
          type: 'PLAT_RESPONSE', id: msg.id,
          status: 500, statusText: 'Internal Server Error',
          headers: { 'content-type': 'text/plain; charset=utf-8' },
          body,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    })()

    const target = (event.source as ServiceWorker | null) ?? navigator.serviceWorker.controller
    const transfer = reply.body ? [reply.body] : []
    target?.postMessage(reply, transfer)
  })
}

async function ensureServiceWorkerControlling(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are not supported in this browser')
  }
  const registration = await navigator.serviceWorker.register('/plat-service-worker.js', { scope: '/' })
  if (registration.waiting) registration.waiting.postMessage({ type: 'PLAT_SKIP_WAITING' })
  await navigator.serviceWorker.ready
  if (navigator.serviceWorker.controller) return
  // First-ever visit: the registration completed but this page is not
  // controlled. Reload so the SW takes over and can serve the shell for
  // this navigation (and intercept the upcoming fetch).
  window.location.reload()
  // Block forever while the reload kicks in.
  await new Promise(() => {})
}

async function renderHtmlDocument(html: string): Promise<void> {
  // document.open/write/close re-parses the HTML, which re-executes inline
  // and external <script> tags natively. The document URL stays at the
  // navigation URL, so relative and root-absolute subresource requests
  // resolve sensibly and flow back through the SW.

  // Write HTML as before
  document.open()
  document.write(html)
  document.close()

  // After render, ensure favicon is present
  await ensureDocumentFavicon()
}

async function renderResponse(response: Response): Promise<void> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase()

  if (contentType.startsWith('text/html')) {
    await renderHtmlDocument(await response.text())
    return
  }

  // Bare-minimum rendering for non-HTML responses. We can't hand the bytes
  // back to the browser as a "real" response from this URL, so we drop a
  // single appropriate element into an empty document and let UA defaults
  // do the rest — no custom styling.
  const blob = await response.blob()
  const blobUrl = URL.createObjectURL(blob)

  if (contentType.startsWith('image/')) {
    await renderHtmlDocument(`<!doctype html><html><head><style>
html,body{margin:0;height:100%;background:#000;display:flex;align-items:center;justify-content:center}
img{max-width:100vw;max-height:100vh;object-fit:contain}
</style></head><body><img src="${blobUrl}"></body></html>`)
    return
  }
  if (contentType.startsWith('video/')) {
    await renderHtmlDocument(`<!doctype html><html><body><video src="${blobUrl}" controls></video></body></html>`)
    return
  }
  if (contentType.startsWith('audio/')) {
    await renderHtmlDocument(`<!doctype html><html><body><audio src="${blobUrl}" controls></audio></body></html>`)
    return
  }
  if (contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml')) {
    const text = await blob.text()
    const escaped = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
    await renderHtmlDocument(`<!doctype html><html><body><pre>${escaped}</pre></body></html>`)
    return
  }
  await renderHtmlDocument(`<!doctype html><html><body><embed src="${blobUrl}" type="${contentType}"></body></html>`)
}

async function main(): Promise<void> {
  const target = parseTargetFromLocation()
  if (!target) {
    setStatus('No site specified. Visit /<namespace>/<project>/ to view a site.')
    return
  }

  setStatus(`Connecting to css://${target.serverName}…`)
  installTransportBridge()
  await ensureServiceWorkerControlling()

  // Start the WebRTC handshake in the background — DON'T await it. If the SW
  // cache can serve the upcoming fetch we want to skip the handshake entirely.
  // Cache misses will hit the bridge, which awaits this same promise lazily.
  void getConnection(target.serverName)

  // Best-effort trailing-slash fix using the URL's first two segments as the
  // server name. Correct for the common <ns>/<project> case; longer canonical
  // names will still work but won't auto-correct from a slash-less URL.
  if (window.location.pathname === '/' + target.serverName) {
    window.history.replaceState(null, '', '/' + target.serverName + '/' + window.location.search + window.location.hash)
  }

  // Let the SW's stale-while-revalidate serve the cached HTML instantly and
  // refresh it in the background. Hard-refresh (Ctrl+Shift+R) naturally
  // propagates `cache: 'reload'`, which the SW treats as a bypass; a soft F5
  // keeps the SWR behaviour for an instant paint. The workspace-files-changed
  // peer event (see getConnection) triggers an auto-reload once fresh content
  // is available, so stale-first is safe.
  const response = await fetch(window.location.pathname + window.location.search, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'default',
  })
  await renderResponse(response)
}

main().catch((err) => {
  console.error('[site-viewer] bootstrap failed', err)
  setStatus(err instanceof Error ? err.message : String(err), true)
})
