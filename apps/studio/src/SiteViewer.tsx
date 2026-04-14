import { useEffect } from 'react'
import { buildCssTargetUrl } from './runtime/clientTargetUrl'
import { buildSiteViewerUrl, resolveSiteViewerOrigin } from './runtime/siteViewerUrl'
import { ApiView, type ApiViewMode } from './shell/EditorViewHost'
import { useRuntimeStore } from './store/runtime'

export function SiteViewer({
  serverName,
  previewPath = '/',
  initialApiMode,
  previewMode = 'browser',
  targetUrl,
}: {
  serverName: string
  previewPath?: string
  initialApiMode?: ApiViewMode
  previewMode?: 'browser' | 'api'
  targetUrl?: string
}) {
  const setClientTargetUrl = useRuntimeStore((state) => state.setClientTargetUrl)

  useEffect(() => {
    if (previewMode !== 'api') return
    setClientTargetUrl(targetUrl ?? buildCssTargetUrl(serverName))
  }, [previewMode, serverName, setClientTargetUrl, targetUrl])

  if (previewMode === 'api') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--bs-bg)' }}>
        <ApiView initialMode={initialApiMode ?? 'client'} />
      </div>
    )
  }

  const iframeSrc = buildSiteViewerUrl(serverName, previewPath)
  if (!iframeSrc) {
    const configuredOrigin = resolveSiteViewerOrigin()
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontFamily: 'system-ui', color: '#888', background: '#111',
        flexDirection: 'column', gap: '1rem',
      }}>
        <div style={{ fontSize: '1.2rem', color: '#e55' }}>Could not open css://{serverName}</div>
        <div style={{ fontSize: '0.8rem', maxWidth: '520px', textAlign: 'center' }}>
          {configuredOrigin
            ? `The site viewer URL is invalid: ${configuredOrigin}`
            : 'Set VITE_SITE_VIEWER_ORIGIN to the standalone site-viewer app, or run it locally on port 5174.'}
        </div>
      </div>
    )
  }

  return (
    <iframe
      src={iframeSrc}
      style={{
        position: 'fixed', inset: 0, width: '100%', height: '100%',
        border: 'none', background: 'white',
      }}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      title={serverName}
    />
  )
}
