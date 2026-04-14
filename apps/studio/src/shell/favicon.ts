import { useEffect } from 'react'
import { useRuntimeStore } from '../store/runtime'

const STATUS_COLORS: Record<string, string> = {
  idle: '#94a3b8',     // slate-400
  starting: '#facc15', // yellow-400
  running: '#22c55e',  // green-500
  error: '#ef4444',    // red-500
}

function buildFaviconSvg(status: string): string {
  const dotColor = STATUS_COLORS[status] ?? STATUS_COLORS.idle
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <defs>
    <linearGradient id="bs-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#161822" />
      <stop offset="100%" stop-color="#1f2335" />
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="112" height="112" rx="24" fill="url(#bs-bg)" stroke="#2a2e42" stroke-width="4" />
  <text x="60" y="76" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="54" font-weight="700" fill="#7c8cf0" text-anchor="middle">bs</text>
  <circle cx="93" cy="27" r="15" fill="#0f1117" />
  <circle cx="93" cy="27" r="11" fill="${dotColor}" />
</svg>`
}

let linkEl: HTMLLinkElement | null = null

function setFavicon(svg: string) {
  if (!linkEl) {
    linkEl = document.querySelector('link[rel="icon"]')
    if (!linkEl) {
      linkEl = document.createElement('link')
      linkEl.rel = 'icon'
      linkEl.type = 'image/svg+xml'
      document.head.appendChild(linkEl)
    }
  }
  linkEl.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// Also check tab sessions so the favicon reflects any running server,
// not just the currently focused pane/tab.
function aggregateStatus(state: { status: string; tabSessions: Record<string, { status: string }> }): string {
  if (state.status === 'running') return 'running'
  for (const ps of Object.values(state.tabSessions)) {
    if (ps.status === 'running') return 'running'
    if (ps.status === 'starting') return 'starting'
    if (ps.status === 'error') return 'error'
  }
  return state.status
}

/** Hook: call once at the app root to keep the favicon in sync with runtime status. */
export function useFavicon() {
  const status = useRuntimeStore(aggregateStatus)

  useEffect(() => {
    setFavicon(buildFaviconSvg(status))
  }, [status])
}

// Set initial favicon immediately
setFavicon(buildFaviconSvg('idle'))