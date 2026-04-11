import { useEffect, useRef, useState } from 'react'

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
export function SiteViewer({ serverName }: { serverName: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [status, setStatus] = useState<'connecting' | 'loading' | 'ready' | 'error'>('connecting')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function boot() {
      try {
        setStatus('connecting')

        // Connect to the CSS server via WebRTC
        const { connectClientSideServer } = await import('@modularizer/plat-client/client-server')
        const { createPlatFetch, generateBridgeScript } = await import('@modularizer/plat-client/client-server')

        const cssUrl = `css://${serverName}`
        const { client } = await connectClientSideServer({ baseUrl: cssUrl })

        if (cancelled) return

        // Use the client's transport to create a fetch wrapper
        // The OpenAPIClient's internal transport handles the WebRTC routing
        setStatus('loading')

        // Fetch the initial page through the client
        // We make a raw GET / request through the plat RPC protocol
        const result = await (client as any).get('/', {})

        if (cancelled) return

        // If result is a file response, decode and render
        let html: string
        if (result && typeof result === 'object' && result._type === 'file') {
          html = typeof result.content === 'string'
            ? atob(result.content)
            : new TextDecoder().decode(result.content)
        } else if (typeof result === 'string') {
          html = result
        } else {
          // Might be JSON — wrap in a basic page
          html = `<!DOCTYPE html><html><body><pre>${JSON.stringify(result, null, 2)}</pre></body></html>`
        }

        // Inject the bridge script
        const bridgeScript = `<script>${generateBridgeScript()}</script>`
        if (html.includes('<head>')) {
          html = html.replace('<head>', `<head>${bridgeScript}`)
        } else if (html.includes('<html>')) {
          html = html.replace('<html>', `<html><head>${bridgeScript}</head>`)
        } else {
          html = bridgeScript + html
        }

        if (iframeRef.current) {
          iframeRef.current.srcdoc = html
        }

        setStatus('ready')
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setStatus('error')
        }
      }
    }

    void boot()
    return () => { cancelled = true }
  }, [serverName])

  // Handle postMessage bridge requests from the iframe
  useEffect(() => {
    let platFetchInstance: typeof fetch | null = null

    // Lazy-init the platFetch when first request arrives
    async function getPlatFetch(): Promise<typeof fetch> {
      if (platFetchInstance) return platFetchInstance

      const { connectClientSideServer, createPlatFetch } = await import('@modularizer/plat-client/client-server')
      const cssUrl = `css://${serverName}`

      // Create a new channel for fetch requests
      // connectClientSideServer creates a WebRTC connection
      const { client } = await connectClientSideServer({ baseUrl: cssUrl })

      // We need the raw transport. For now, we'll use a lightweight approach:
      // route through the client's internal transport by calling the client methods.
      // TODO: expose the raw channel from connectClientSideServer for createPlatFetch

      // Workaround: create a minimal channel that wraps the client
      const { createInProcessChannel } = await import('./runtime/inProcessChannel')

      // For now, handle postMessage fetch by calling through the OpenAPIClient
      platFetchInstance = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        const method = init?.method?.toUpperCase() || 'GET'

        try {
          let result: any
          if (method === 'GET') {
            result = await (client as any).get(url, {})
          } else if (method === 'POST') {
            const body = init?.body ? JSON.parse(String(init.body)) : {}
            result = await (client as any).post(url, body)
          } else {
            result = await (client as any).request(method, url, {})
          }

          // Handle file responses
          if (result && typeof result === 'object' && result._type === 'file') {
            const binary = atob(result.content)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
            return new Response(bytes as any, {
              status: 200,
              headers: {
                'content-type': result.contentType || 'application/octet-stream',
                ...(result.headers || {}),
              },
            })
          }

          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message }), {
            status: err.status ?? 500,
            headers: { 'content-type': 'application/json' },
          })
        }
      }

      return platFetchInstance
    }

    const handler = async (event: MessageEvent) => {
      const data = event.data
      if (!data || data.type !== 'plat-fetch') return

      try {
        const pf = await getPlatFetch()
        const response = await pf(data.path, {
          method: data.method,
          headers: data.headers,
          body: data.body,
        })

        const buffer = await response.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let base64 = ''
        for (let i = 0; i < bytes.length; i++) base64 += String.fromCharCode(bytes[i]!)
        base64 = btoa(base64)

        const respHeaders: Record<string, string> = {}
        response.headers.forEach((v, k) => { respHeaders[k] = v })

        iframeRef.current?.contentWindow?.postMessage({
          type: 'plat-fetch-response',
          id: data.id,
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type') || 'application/octet-stream',
          body: base64,
          headers: respHeaders,
        }, '*')
      } catch (err) {
        iframeRef.current?.contentWindow?.postMessage({
          type: 'plat-fetch-response',
          id: data.id,
          ok: false,
          status: 500,
          statusText: 'Bridge error',
          contentType: 'application/json',
          body: btoa(JSON.stringify({ error: String(err) })),
          headers: {},
        }, '*')
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [serverName])

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
