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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <text x="16" y="24" font-family="system-ui, sans-serif" font-size="22" font-weight="600" fill="#2563eb" text-anchor="middle">bs</text>
  <circle cx="27" cy="5" r="5" fill="${dotColor}" />
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