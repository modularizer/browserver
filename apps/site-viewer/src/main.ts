// --- IndexedDB HTML cache for large payloads ---
const DB_NAME = 'siteViewerCache';
const DB_STORE = 'html';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
function openHtmlDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

async function idbGetHtml(key: string): Promise<string | null> {
  // 1. LocalStorage Fast-Path (~0ms)
  const fastPath = localStorage.getItem(key);
  if (fastPath) return fastPath;

  // 2. IndexedDB Fallback
  return openHtmlDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const store = tx.objectStore(DB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }));
}

async function idbSetHtml(key: string, html: string): Promise<void> {
  // 1. LocalStorage Fast-Path (if small enough)
  if (html.length < 2 * 1024 * 1024) { // 2MB
    try {
      localStorage.setItem(key, html);
    } catch (e) {
      console.warn('[site-viewer] localStorage quota exceeded, using IndexedDB only');
    }
  } else {
    localStorage.removeItem(key);
  }

  // 2. IndexedDB source of truth
  return openHtmlDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    const req = store.put(html, key);
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
  onAuthorityPresence,
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
  console.log(`[site-viewer] setStatus(${isError ? 'ERROR: ' : ''}${text})`);
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
        const isOffline = isOfflineErrorMessage(message)

        // For the bridge (which only handles subresources), we always return JSON
        // to prevent parsing errors in the client.
        const headers: Record<string, string> = {
          'content-type': 'application/json; charset=utf-8'
        }

        const body = new TextEncoder().encode(JSON.stringify({
          error: `[site-viewer bridge] ${message}`,
          message: message,
          source: 'site-viewer-bridge',
          isOffline
        })).buffer

        if (isOffline) {
          headers['x-browserver-offline'] = 'true'
          // Also show the indicator if any subresource fails
          showFailedToLoadIndicator('using cached version');
        }

        return {
          type: 'PLAT_RESPONSE', id: msg.id,
          status: 500, statusText: 'Internal Server Error',
          headers,
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

let hasFailed = false;

// Loading progress bar
function showLoadingProgressBar(durationMs = 10000) {
  const tryInsert = () => {
    if (!document.body) {
      setTimeout(tryInsert, 10);
      return;
    }
    let bar = document.getElementById('site-viewer-progress-bar') as HTMLDivElement | null;
    if (!bar) {
      console.log(`[site-viewer] creating progress bar (duration: ${durationMs}ms)`);
      bar = document.createElement('div');
      bar.id = 'site-viewer-progress-bar';
      bar.style.position = 'fixed';
      bar.style.bottom = '0';
      bar.style.left = '0';
      bar.style.height = '4px';
      bar.style.background = '#0078d4'; // Brighter blue
      bar.style.width = '0%';
      bar.style.zIndex = '2147483647'; // Max z-index
      bar.style.transition = `width ${durationMs}ms cubic-bezier(0.1, 0, 0.4, 1)`;
      bar.style.pointerEvents = 'none';
      bar.style.boxShadow = '0 0 4px rgba(0,120,212,0.4)';
      document.body.appendChild(bar);
      // Trigger animation
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (bar) bar.style.width = '90%';
        });
      });
    }
  };
  tryInsert();
}

function finishLoadingProgress() {
  if (hasFailed) return;
  const bar = document.getElementById('site-viewer-progress-bar');
  if (!bar) {
    console.warn('[site-viewer] finishLoadingProgress: bar not found');
    return;
  }
  if (bar.style.width === '100%') return; 
  
  console.log('[site-viewer] finalizing progress bar (animating to 100%)');
  bar.style.animation = 'none'; // Disable any keyframe animations from inline bootstrap
  bar.style.transition = 'width 0.4s ease-out';
  bar.style.width = '100%';
  
  setTimeout(() => {
    console.log('[site-viewer] progress bar finished, fading out');
    bar.style.transition = 'opacity 0.4s ease-out';
    bar.style.opacity = '0';
    setTimeout(() => {
      console.log('[site-viewer] progress bar removed');
      bar.remove();
    }, 500);
  }, 400); // Wait for the 100% width transition
}

function failLoadingProgress() {
  hasFailed = true;
  const bar = document.getElementById('site-viewer-progress-bar') as HTMLDivElement | null;
  if (bar) {
    bar.style.transition = 'width 0.5s ease-out, background-color 0.3s ease-in';
    bar.style.background = '#e74c3c'; // Red
    setTimeout(() => {
      if (bar) {
        bar.style.opacity = '0';
        setTimeout(() => bar.remove(), 500);
      }
    }, 800);
  }
}

function removeLoadingProgress() {
  document.getElementById('site-viewer-progress-bar')?.remove();
}

function renderOfflineLandingPage(serverName: string) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Site Unavailable - ${serverName}</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: #0f172a;
            color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            text-align: center;
        }
        .container {
            max-width: 480px;
            padding: 40px;
        }
        .icon {
            font-size: 48px;
            margin-bottom: 24px;
            display: inline-block;
            opacity: 0.9;
        }
        h1 {
            font-size: 24px;
            font-weight: 600;
            margin: 0 0 12px 0;
            letter-spacing: -0.02em;
        }
        p {
            font-size: 16px;
            line-height: 1.6;
            color: #94a3b8;
            margin: 0 0 32px 0;
        }
        .server-name {
            background: #1e293b;
            padding: 4px 10px;
            border-radius: 6px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 14px;
            color: #38bdf8;
        }
        .button {
            display: inline-block;
            background: #38bdf8;
            color: #0f172a;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 600;
            text-decoration: none;
            transition: transform 0.2s, background 0.2s;
        }
        .button:hover {
            background: #7dd3fc;
            transform: translateY(-1px);
        }
    </style>
</head>
<body>
    <div id="site-viewer-offline-landing-flag" style="display:none"></div>
    <div class="container">
        <div class="icon">🛰️</div>
        <h1>Site Unavailable</h1>
        <p>The host for <span class="server-name">${serverName}</span> is currently offline, and no cached version is available.</p>
        <a href="javascript:location.reload()" class="button">Try Again</a>
    </div>
</body>
</html>
  `;
}

// Floating failed to load indicator
function showFailedToLoadIndicator(subtext: string) {
  hasFailed = true;
  failLoadingProgress();
  let indicator = document.getElementById('site-viewer-failed-indicator') as HTMLDivElement | null;
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'site-viewer-failed-indicator';
    indicator.style.position = 'fixed';
    indicator.style.bottom = '24px';
    indicator.style.right = '24px';
    indicator.style.zIndex = '9999';
    indicator.style.background = '#e74c3c'; // Red for failure
    indicator.style.color = '#fff';
    indicator.style.padding = '12px 20px';
    indicator.style.borderRadius = '8px';
    indicator.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
    indicator.style.fontFamily = 'inherit';
    indicator.style.fontSize = '14px';
    indicator.style.pointerEvents = 'none';
    indicator.innerHTML = `<div style="font-weight:bold;margin-bottom:2px">Failed To Load</div><div style="font-size:12px;opacity:0.9">${subtext}</div>`;
    document.body.appendChild(indicator);
  }
}

function isOfflineErrorMessage(message: string): boolean {
  return message.toLowerCase().includes('no online host');
}

// Floating update indicator
function showUpdateAvailableIndicator(onClick: () => void) {
  // Remove indicators if they exist
  document.getElementById('site-viewer-failed-indicator')?.remove();
  removeLoadingProgress();

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

async function renderHtmlDocument(html: string, options?: { duration?: number }): Promise<void> {
  // Diagnostic: increment and log render count and stack
  if (typeof window !== 'undefined') {
    (window as any).__siteViewerRenderId = ((window as any).__siteViewerRenderId || 0) + 1;
    const renderId = (window as any).__siteViewerRenderId;
    console.warn(`[site-viewer] renderHtmlDocument: renderId=${renderId} (hasRendered? ${(window as any).__siteViewerHasRendered ? 'yes' : 'no'})`);
    console.warn(new Error(`[site-viewer] renderHtmlDocument stack trace for renderId=${renderId}`));
  }
  
  if (!(window as any).__siteViewerHasRendered) {
    (window as any).__siteViewerHasRendered = true;

    // Inject progress bar into the HTML string before writing it, so it appears instantly
    let finalHtml = html;

    // Sanitize scripts to be non-blocking for the initial cache-render
    // This prevents external scripts (like Tailwind CDN) from stalling document.write
    finalHtml = finalHtml.replace(/<script\b([^>]*\bsrc\s*=[^>]*)/gi, function(match) {
      if (match.toLowerCase().indexOf('tailwindcss') !== -1) return match;
      return match.replace('<script', '<script async');
    });

    if (options?.duration) {
      const barStyle = `
        #site-viewer-progress-bar {
          position: fixed; bottom: 0; left: 0; height: 4px;
          background: #0078d4; z-index: 2147483647;
          width: 0%; pointer-events: none;
          animation: site-viewer-progress ${options.duration}ms linear forwards;
        }
        @keyframes site-viewer-progress {
          0% { width: 0%; }
          100% { width: 90%; }
        }
      `;
      const barHtml = `<div id="site-viewer-progress-bar"></div>`;
      finalHtml = finalHtml
        .replace('</head>', `<style>${barStyle}</style></head>`)
        .replace('<body>', `<body>${barHtml}`);
      
      // If no <head> or <body> tags, just prepend (unlikely for full HTML documents)
      if (finalHtml === html) {
        finalHtml = `<style>${barStyle}</style>${barHtml}${html}`;
      }
    }

    const tOpen = performance.now();
    document.open();
    const tWrite = performance.now();
    document.write(finalHtml);
    const tClose = performance.now();
    document.close();
    const tEnd = performance.now();

    console.log(`[site-viewer-perf] document.open: ${(tWrite - tOpen).toFixed(2)}ms, document.write: ${(tClose - tWrite).toFixed(2)}ms, document.close: ${(tEnd - tClose).toFixed(2)}ms`);

    void ensureDocumentFavicon();
    // Yield to let the document settle
    await new Promise(resolve => setTimeout(resolve, 0));
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

async function main(): Promise<void> {
  const bootStart = performance.now();
  const target = parseTargetFromLocation()
  if (!target) {
    setStatus('No site specified. Visit /<namespace>/<project>/ to view a site.')
    return
  }
  const targetResolved = performance.now();

  const startTime = Date.now();
  const serverKey = `sv:${target.serverName}`;
  const storedDuration = sessionStorage.getItem(`${serverKey}:dur`);
  const duration = storedDuration ? parseInt(storedDuration, 10) : 10000;

  // Hard guard: if already rendered for this navigation, do nothing
  // 0. Start progress bar immediately (even if already rendered, to sync state)
  showLoadingProgressBar(duration);

  // 1. Perform background setup ALWAYS
  setStatus('Initializing transport bridge...')
  installTransportBridge()
  const setupStart = performance.now();
  const swReadyStart = performance.now();
  setStatus('Preparing service worker...')
  await ensureServiceWorkerControlling()
  const swReadyEnd = performance.now();
  setStatus(`Connecting to host: css://${target.serverName}…`)
  const connectionPromise = getConnection(target.serverName)
  const setupEnd = performance.now();
  console.log(`[site-viewer-perf] Target resolution: ${(targetResolved - bootStart).toFixed(2)}ms, Setup (Bridge+SW+Conn): ${(setupEnd - setupStart).toFixed(2)}ms (SW part: ${(swReadyEnd - swReadyStart).toFixed(2)}ms)`);

  if (window.location.pathname === '/' + target.serverName) {
    window.history.replaceState(null, '', '/' + target.serverName + '/' + window.location.search + window.location.hash)
  }

  // 2. CHECK IF ALREADY RENDERED (e.g. by inline bootstrap)
  if ((window as any).__siteViewerHasRendered) {
    console.warn('[site-viewer] main(): already rendered for this navigation, skipping initial fetch/cache logic.');
    // Yield to let the document settle and then start monitoring
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Ensure progress bar finishes for pre-rendered state ONLY after connection is ready
    const finish = async () => {
      try {
        await connectionPromise;
        requestAnimationFrame(() => {
          if (document.readyState === 'complete') {
            finishLoadingProgress();
          } else {
            window.addEventListener('load', () => finishLoadingProgress(), { once: true });
          }
        });
      } catch (e) {
        console.error('[site-viewer] finish: connection failed', e);
        failLoadingProgress();
      }
    };
    void finish();

    backgroundMonitor(target.serverName);
    return;
  }

  // 3. IMMEDIATELY try to render from cache if available (IndexedDB fallback)
  setStatus('Checking local cache...')
  const cacheFetchStart = performance.now();
  const cachedHtml = await idbGetHtml(`${serverKey}:html`);
  const cacheFetchEnd = performance.now();
  
  if (cachedHtml && !(window as any).__siteViewerHasRendered) {
    console.warn('[site-viewer] main: immediate cache render (pre-setup)');
    const renderStart = performance.now();
    // Pass duration to renderHtmlDocument so it can inject the bar
    await renderHtmlDocument(cachedHtml, { duration });
    const renderEnd = performance.now();
    console.log(`[site-viewer-perf] Cache fetch: ${(cacheFetchEnd - cacheFetchStart).toFixed(2)}ms, Render (Total): ${(renderEnd - renderStart).toFixed(2)}ms`);
    
    // Finish progress bar after successful cache render AND connection is ready
    const finish = async () => {
      try {
        await connectionPromise;
        requestAnimationFrame(() => {
          if (document.readyState === 'complete') {
            finishLoadingProgress();
          } else {
            window.addEventListener('load', () => finishLoadingProgress(), { once: true });
          }
        });
      } catch (e) {
        console.error('[site-viewer] finish (cache): connection failed', e);
        failLoadingProgress();
      }
    };
    void finish();
  } else {
    console.log(`[site-viewer-perf] Cache fetch: ${(cacheFetchEnd - cacheFetchStart).toFixed(2)}ms (no cache or already rendered)`);
  }

  if ((window as any).__siteViewerHasRendered) {
    console.warn('[site-viewer] main(): already rendered for this navigation, skipping initial fetch logic.');
  } else {
    // 4. No cache was rendered -> we need to wait for the fresh content
    try {
      setStatus('Fetching fresh site content from host...')
      console.warn('[site-viewer] main: fetching fresh content');
      const networkFetchStart = performance.now();
      const response = await fetch(window.location.pathname + window.location.search, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'default',
      });
      const networkFetchEnd = performance.now();
      console.log(`[site-viewer-perf] Network fetch: ${(networkFetchEnd - networkFetchStart).toFixed(2)}ms`);

      const responseHtml = await response.text();
      const isOffline = response.headers.get('x-browserver-offline') === 'true' || isOfflineErrorMessage(responseHtml);

      if (response.ok && !isOffline) {
        const loadDuration = Date.now() - startTime;
        sessionStorage.setItem(`${serverKey}:dur`, String(loadDuration));

        // Don't finish immediately; wait for connection AND window 'load' event
        const finish = async () => {
          try {
            await connectionPromise;
            requestAnimationFrame(() => {
              console.log('[site-viewer] finishing progress (readyState=' + document.readyState + ')');
              if (document.readyState === 'complete') {
                finishLoadingProgress();
              } else {
                window.addEventListener('load', () => finishLoadingProgress(), { once: true });
              }
            });
          } catch (e) {
            console.error('[site-viewer] finish (network): connection failed', e);
            failLoadingProgress();
          }
        };

        if (document.readyState === 'complete') {
          finish();
        } else {
          window.addEventListener('load', finish, { once: true });
        }

        const responseHash = normalizeHash(response.headers.get('etag') || responseHtml);
        const lastAppliedHash = normalizeHash(sessionStorage.getItem(`${serverKey}:hash`));

        if (lastAppliedHash !== responseHash) {
          // If we haven't rendered yet (no cache), or hash changed, apply it
          if (!(window as any).__siteViewerHasRendered || !lastAppliedHash) {
            await renderHtmlDocument(responseHtml);
          } else {
            // We already rendered cache, and hash changed -> show update available
            showUpdateAvailableIndicator(() => window.location.reload());
          }
        }
        await cacheHtmlSet(`${serverKey}:html`, responseHtml);
        sessionStorage.setItem(`${serverKey}:hash`, responseHash ?? '');
      } else if (isOffline) {
        console.warn('[site-viewer] main: host is offline');
        if ((window as any).__siteViewerHasRendered) {
          showFailedToLoadIndicator('using cached version');
        } else {
          await renderHtmlDocument(renderOfflineLandingPage(target.serverName));
        }
      } else {
        // Some other non-OK response
        if ((window as any).__siteViewerHasRendered) {
          showFailedToLoadIndicator('using cached version');
        } else {
          await renderHtmlDocument(renderOfflineLandingPage(target.serverName));
        }
      }
    } catch (err) {
      console.warn('[site-viewer] main: initial fetch failed', err);
      // We already checked if rendered in the outer block, but let's be safe
      if ((window as any).__siteViewerHasRendered) {
        showFailedToLoadIndicator('using cached version');
      } else {
        setStatus(err instanceof Error ? err.message : String(err), true);
      }
    }
  }

  // 4. In the background, listen for presence and sync content
  backgroundMonitor(target.serverName);
}

async function backgroundMonitor(serverName: string) {
  let lastFetchedHash = normalizeHash(sessionStorage.getItem(`sv:${serverName}:hash`));

  onAuthorityPresence(serverName, async (online) => {
    if (!online) return;

    // We only perform a fetch when the host is confirmed online.
    // If it's already online, this runs once at boot.
    // Otherwise, it runs whenever it transitions from offline to online.
    try {
      const freshResponse = await fetch(window.location.pathname + window.location.search, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'reload',
      });
      const freshHtml = await freshResponse.text();
      const isOffline = freshResponse.headers.get('x-browserver-offline') === 'true' || isOfflineErrorMessage(freshHtml);

      if (!isOffline && freshResponse.ok) {
        document.getElementById('site-viewer-failed-indicator')?.remove();
        const freshHash = normalizeHash(freshResponse.headers.get('etag') || freshHtml);

        if (lastFetchedHash !== freshHash) {
          lastFetchedHash = freshHash;
          const isShowingLandingPage = !!document.getElementById('site-viewer-offline-landing-flag');
          if (!(window as any).__siteViewerHasRendered || isShowingLandingPage) {
            console.log('[site-viewer] backgroundMonitor: auto-rendering live content');
            await renderHtmlDocument(freshHtml);
          } else {
            console.log('[site-viewer] backgroundMonitor: showing update available prompt');
            showUpdateAvailableIndicator(() => window.location.reload());
          }
        }
        
        await cacheHtmlSet(`sv:${serverName}:html`, freshHtml);
        sessionStorage.setItem(`sv:${serverName}:hash`, freshHash ?? '');
      }
    } catch (err) {
      console.warn('[site-viewer] backgroundMonitor error during reactive fetch', err);
    }
  });
}

main().catch((err) => {
  console.error('[site-viewer] bootstrap failed', err)
  setStatus(err instanceof Error ? err.message : String(err), true)
})
