import { useCallback, useEffect, useMemo } from 'react'
import { buildCssTargetUrl } from './runtime/clientTargetUrl'
import { usePlatBrowserFrame } from './browser/usePlatBrowserFrame'
import { ApiView, type ApiViewMode } from './shell/EditorViewHost'
import { useRuntimeStore } from './store/runtime'

/**
 * SiteViewer: Full-page renderer for a client-side server's static site.
 *
 * Mounted at /site/:serverName — connects to css://serverName via WebRTC,
 * fetches the initial HTML, injects the plat bridge, and renders it in an
 * iframe that fills the entire viewport. Looks and feels like a real website.
 *
 * The bridge transparently routes all fetch/XHR/resource loads (img src,
 * link href, script src, etc.) through the WebRTC channel to the CSS server.
 */
export function SiteViewer({
  serverName,
  initialApiMode,
  previewMode = 'browser',
  targetUrl,
}: {
  serverName: string
  initialApiMode?: ApiViewMode
  previewMode?: 'browser' | 'api'
  targetUrl?: string
}) {
  const setClientTargetUrl = useRuntimeStore((state) => state.setClientTargetUrl)
  const createConnection = useCallback(async (connectionUrl: string) => {
    const {
      createClientSideServerMQTTWebRTCPeerPool,
      createPlatFetch,
      parseClientSideServerAddress,
    } = await import('@modularizer/plat-client/client-server')

    const peerPool = createClientSideServerMQTTWebRTCPeerPool()
    const channel = await peerPool.connect(parseClientSideServerAddress(connectionUrl))

    return {
      fetch: createPlatFetch({ channel }),
      close: async () => {
        if (typeof channel.close === 'function') {
          await channel.close()
        }
        if (typeof peerPool.close === 'function') {
          await peerPool.close(connectionUrl)
        }
      },
    }
  }, [])

  const {
    iframeRef,
    loading,
    error,
    navigate,
    hasConnection,
  } = usePlatBrowserFrame({
    initialUrl: `${buildCssTargetUrl(serverName)}/`,
    createConnection,
  })
  const status = useMemo<'connecting' | 'loading' | 'ready' | 'error'>(() => {
    if (error) return 'error'
    if (loading) return hasConnection ? 'loading' : 'connecting'
    return 'ready'
  }, [error, hasConnection, loading])
  const showApiFallback = Boolean(
    !loading
    && error
    && hasConnection
    && /^404\b/.test(error.trim()),
  )
  const showApiView = previewMode === 'api' || showApiFallback

  useEffect(() => {
    if (previewMode === 'api') return
    const cssUrl = `${buildCssTargetUrl(serverName)}/`
    void navigate(cssUrl)
  }, [navigate, previewMode, serverName])

  useEffect(() => {
    if (!showApiView) return
    setClientTargetUrl(targetUrl ?? buildCssTargetUrl(serverName))
  }, [serverName, setClientTargetUrl, showApiView, targetUrl])

  if (showApiView) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--bs-bg)' }}>
        <ApiView initialMode={initialApiMode ?? 'client'} />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontFamily: 'system-ui', color: '#888', background: '#111',
        flexDirection: 'column', gap: '1rem',
      }}>
        <div style={{ fontSize: '1.2rem', color: '#e55' }}>Failed to connect</div>
        <div style={{ fontSize: '0.9rem' }}>Server: css://{serverName}</div>
        <div style={{ fontSize: '0.8rem', maxWidth: '400px', textAlign: 'center' }}>{error}</div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '0.5rem 1.5rem', border: '1px solid #444', borderRadius: '6px',
            background: '#222', color: '#ccc', cursor: 'pointer', marginTop: '0.5rem',
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <>
      {status !== 'ready' && (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontFamily: 'system-ui', color: '#888',
          background: '#111', zIndex: 9999, flexDirection: 'column', gap: '0.5rem',
        }}>
          <div style={{ fontSize: '0.9rem' }}>
            {status === 'connecting' ? 'Connecting to' : 'Loading from'} css://{serverName}...
          </div>
        </div>
      )}
      <iframe
        ref={iframeRef}
        style={{
          position: 'fixed', inset: 0, width: '100%', height: '100%',
          border: 'none', background: 'white',
        }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        title={serverName}
      />
    </>
  )
}
