// --- IndexedDB HTML cache for large payloads ---
const DB_NAME = 'siteViewerCache';
const DB_STORE = 'html';
const DB_VERSION = 1;

function openHtmlDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetHtml(key: string): Promise<string | null> {
  return openHtmlDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
    req.onerror = () => reject(req.error);
  }));
}

function idbSetHtml(key: string, value: string): Promise<void> {
  return openHtmlDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}

function idbRemoveHtml(key: string): Promise<void> {
  return openHtmlDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  }));
}
// Normalize hash for comparison: strip quotes and trim whitespace
function normalizeHash(hash: string | null | undefined): string | null {
  if (typeof hash !== 'string') return null;
  return hash.replace(/^"|"$/g, '').trim();
}
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
          await applyResponseWithHashCheck(fresh)
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

// Diagnostic: track and log each document rewrite
if (typeof window !== 'undefined') {
  (window as any).__siteViewerRenderId = 0;
}

// Floating update indicator
function showUpdateAvailableIndicator(onClick: () => void) {
  let indicator = document.getElementById('site-viewer-update-indicator') as HTMLDivElement | null;
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'site-viewer-update-indicator';
    indicator.style.position = 'fixed';
    indicator.style.bottom = '24px';
    indicator.style.right = '24px';
    indicator.style.zIndex = '9999';
    indicator.style.background = '#222';
    indicator.style.color = '#fff';
    indicator.style.padding = '10px 18px';
    indicator.style.borderRadius = '8px';
    indicator.style.boxShadow = '0 2px 8px rgba(0,0,0,0.18)';
    indicator.style.cursor = 'pointer';
    indicator.style.fontFamily = 'inherit';
    indicator.style.fontSize = '16px';
    indicator.textContent = 'Update available – click to refresh';
    indicator.onclick = () => {
      indicator?.remove();
      onClick();
    };
    document.body.appendChild(indicator);
  }
}

// Diagnostic: track and log each document rewrite
if (typeof window !== 'undefined') {
  (window as any).__siteViewerRenderId = 0;
}

async function renderHtmlDocument(html: string): Promise<void> {
  // Diagnostic: increment and log render count and stack
  if (typeof window !== 'undefined') {
    (window as any).__siteViewerRenderId = ((window as any).__siteViewerRenderId || 0) + 1;
    const renderId = (window as any).__siteViewerRenderId;
    console.warn(`[site-viewer] renderHtmlDocument: renderId=${renderId} (hasRendered? ${(window as any).__siteViewerHasRendered ? 'yes' : 'no'})`);
    console.warn(new Error(`[site-viewer] renderHtmlDocument stack trace for renderId=${renderId}`));
  }
  if (!(window as any).__siteViewerHasRendered) {
    // First render: use document.write
    (window as any).__siteViewerHasRendered = true;
    document.open();
    document.write(html);
    document.close();
    await ensureDocumentFavicon();
    return;
  } else {
    // Not first render: do nothing (should never happen except via update indicator logic)
    console.warn('[site-viewer] Already rendered once, skipping further render.');
    return;
  }
}

async function renderResponse(response: Response): Promise<void> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  const hashRaw = response.headers.get('etag') || (await response.clone().text())
  const hash = normalizeHash(hashRaw)
  console.warn('[site-viewer] renderResponse: content hash', { hash })
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

// Hash check and apply logic for hot swap only
async function applyResponseWithHashCheck(response: Response) {
  const newHashRaw = response.headers.get('etag') || (await response.clone().text())
  const oldHashRaw = sessionStorage.getItem('siteViewerLastAppliedHash')
  const newHash = normalizeHash(newHashRaw)
  const oldHash = normalizeHash(oldHashRaw)
  console.warn('[site-viewer] applyResponseWithHashCheck: old/new hash', { oldHash, newHash })
  if (oldHash === newHash && oldHash !== null) {
    console.warn('[site-viewer] code unchanged (hash matched), skipping document rewrite', { hash: newHash })
    return
  }
  if (oldHash === null) {
    // Should not happen in hot swap, but log for completeness
    console.warn('[site-viewer] hot swap: no previous hash, applying content', { newHash })
  } else {
    console.warn('[site-viewer] code changed (hash mismatch), rewriting document', { oldHash, newHash })
  }
  sessionStorage.setItem('siteViewerLastAppliedHash', newHash ?? '')
  await renderResponse(response)
}

// Utility: cache HTML in IndexedDB only
async function cacheHtmlSet(key: string, value: string): Promise<boolean> {
  try {
    await idbSetHtml(key, value);
    return true;
  } catch (e) {
    console.warn(`[site-viewer] IndexedDB cache failed for key: ${key}`, e);
    return false;
  }
}

async function cacheHtmlGet(key: string): Promise<string | null> {
  try {
    return await idbGetHtml(key);
  } catch (e) {
    console.warn(`[site-viewer] IndexedDB cache get failed for key: ${key}`, e);
    return null;
  }
}

async function cacheHtmlRemove(key: string): Promise<void> {
  try { await idbRemoveHtml(key); } catch {}
}

async function main(): Promise<void> {
  // Hard guard: if already rendered for this navigation, do nothing
  if ((window as any).__siteViewerHasRendered) {
    console.warn('[site-viewer] main(): already rendered for this navigation, skipping.');
    return;
  }

  const target = parseTargetFromLocation()
  if (!target) {
    setStatus('No site specified. Visit /<namespace>/<project>/ to view a site.')
    return
  }

  setStatus(`Connecting to css://${target.serverName}…`)
  installTransportBridge()
  await ensureServiceWorkerControlling()
  void getConnection(target.serverName)
  if (window.location.pathname === '/' + target.serverName) {
    window.history.replaceState(null, '', '/' + target.serverName + '/' + window.location.search + window.location.hash)
  }


  // 1. Try to get cached (possibly stale) content from IndexedDB only
  let didRender = false;
  let lastHash = normalizeHash(sessionStorage.getItem('siteViewerLastAppliedHash'));
  let cachedHtml = await cacheHtmlGet('siteViewerLastHtml');
  // Use a global flag to ensure only one render per navigation
  if (!(window as any).__siteViewerHasRendered) {
    if (cachedHtml && lastHash) {
      console.warn('[site-viewer] Rendering from cache (no bootstrap check)');
      await renderHtmlDocument(cachedHtml);
      (window as any).__siteViewerHasRendered = true;
      didRender = true;
    } else {
      // Cache miss or missing hash: fetch and render
      try {
        console.warn('[site-viewer] Cache miss or missing hash, fetching from network (no bootstrap check)');
        const response = await fetch(window.location.pathname + window.location.search, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'default',
        });
        const responseHtml = await response.text();
        const responseHash = normalizeHash(response.headers.get('etag') || responseHtml);
        await renderHtmlDocument(responseHtml);
        (window as any).__siteViewerHasRendered = true;
        didRender = true;
        await cacheHtmlSet('siteViewerLastHtml', responseHtml);
        sessionStorage.setItem('siteViewerLastAppliedHash', responseHash ?? '');
      } catch (err) {
        console.warn('[site-viewer] main: initial fetch failed', err);
      }
    }
  } else {
    console.warn('[site-viewer] Not rendering: already rendered for this navigation.');
  }

  // 2. If no cached HTML, fetch and render, and store in IndexedDB only
  if (!didRender) {
    try {
      const response = await fetch(window.location.pathname + window.location.search, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'default',
      });
      const responseHtml = await response.text();
      const responseHash = normalizeHash(response.headers.get('etag') || responseHtml);
      if (document.body && document.body.childNodes.length === 1 && (document.body.firstChild as HTMLElement)?.id === 'bootstrap') {
        await renderHtmlDocument(responseHtml);
        didRender = true;
      }
      await cacheHtmlSet('siteViewerLastHtml', responseHtml);
      sessionStorage.setItem('siteViewerLastAppliedHash', responseHash ?? '');
      // Clear any pending nextHtml/nextHash to prevent update indicator or reload loop
      await cacheHtmlRemove('siteViewerNextHtml');
      sessionStorage.removeItem('siteViewerNextHash');
    } catch (err) {
      console.warn('[site-viewer] main: initial fetch failed', err);
    }
  }

  // 3. In the background, fetch fresh content and only update storage/indicator if hash differs
  try {
    const freshResponse = await fetch(window.location.pathname + window.location.search, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'reload',
    });
    const freshHtml = await freshResponse.text();
    const freshHash = normalizeHash(freshResponse.headers.get('etag') || freshHtml);
    const lastHash2 = normalizeHash(sessionStorage.getItem('siteViewerLastAppliedHash'));
    if (lastHash2 !== freshHash && freshHash) {
      // Always update cache if content changed
      await cacheHtmlSet('siteViewerLastHtml', freshHtml);
      sessionStorage.setItem('siteViewerLastAppliedHash', freshHash);
      showUpdateAvailableIndicator(() => {
        window.location.reload();
      });
    } else {
      // No update, do nothing
    }
  } catch (err) {
    console.warn('[site-viewer] main: background fetch failed', err);
  }
}

main().catch((err) => {
  console.error('[site-viewer] bootstrap failed', err)
  setStatus(err instanceof Error ? err.message : String(err), true)
})
