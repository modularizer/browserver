import { useCallback, useEffect, useRef, useState } from 'react'
import { generateBridgeScript } from '@modularizer/plat-client/client-server'
import { buildCssTargetUrl, parseCssServerName } from '../runtime/clientTargetUrl'
import { parseSiteViewerUrl } from '../runtime/siteViewerUrl'

export interface BrowserConnection {
  fetch: typeof fetch
  initialPath?: string
  connectionUrl?: string
  close?: () => void | Promise<void>
}

export interface UsePlatBrowserFrameOptions {
  initialUrl: string
  createConnection: (connectionUrl: string) => Promise<BrowserConnection>
}

function parseBrowserTarget(rawInput: string): {
  directUrl: string | null
  connectionUrl: string | null
  requestPath: string
  requestSearch: string
} {
  const trimmed = rawInput.trim()
  const siteViewerTarget = parseSiteViewerUrl(trimmed)
  if (siteViewerTarget) {
    const connectionTarget = buildCssTargetUrl(siteViewerTarget.serverName)
    return {
      directUrl: trimmed,
      connectionUrl: connectionTarget,
      requestPath: siteViewerTarget.previewPath,
      requestSearch: siteViewerTarget.search,
    }
  }

  const withScheme = trimmed.startsWith('css://') ? trimmed : `css://${trimmed.replace(/^\/+/, '')}`
  if (!withScheme.startsWith('css://')) {
    return { directUrl: null, connectionUrl: null, requestPath: '/', requestSearch: '' }
  }

  // A multi-segment server name is serialized as `css:///ns/name` (triple slash)
  // so `parseCssServerName` can recover the full server identity. In that form,
  // anything beyond the server name is the request path.
  const server = parseCssServerName(withScheme)
  if (!server) {
    return { directUrl: null, connectionUrl: null, requestPath: '/', requestSearch: '' }
  }

  let requestSearch = ''
  try {
    requestSearch = new URL(withScheme).search
  } catch {
    const queryIndex = withScheme.indexOf('?')
    requestSearch = queryIndex >= 0 ? withScheme.slice(queryIndex) : ''
  }

  const connectionTarget = buildCssTargetUrl(server)
  return { directUrl: null, connectionUrl: connectionTarget, requestPath: '/', requestSearch }
}

function injectBridgeScript(html: string): string {
  const bridgeScript = `<script>${generateBridgeScript()}</script>`
  if (html.includes('<head>')) return html.replace('<head>', `<head>${bridgeScript}`)
  if (html.includes('</head>')) return html.replace('</head>', `${bridgeScript}</head>`)
  if (html.includes('<html>')) return html.replace('<html>', `<html><head>${bridgeScript}</head>`)
  return bridgeScript + html
}

export function usePlatBrowserFrame(options: UsePlatBrowserFrameOptions) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const connectionUrlRef = useRef<string | null>(null)
  const connectionRef = useRef<BrowserConnection | null>(null)
  const activeBlobUrlRef = useRef<string | null>(null)

  const [browserUrl, setBrowserUrl] = useState(options.initialUrl)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasConnection, setHasConnection] = useState(false)

  const clearActiveBlobUrl = useCallback(() => {
    if (!activeBlobUrlRef.current) return
    URL.revokeObjectURL(activeBlobUrlRef.current)
    activeBlobUrlRef.current = null
  }, [])

  const closeConnection = useCallback(async () => {
    const current = connectionRef.current
    connectionRef.current = null
    connectionUrlRef.current = null
    setHasConnection(false)
    if (current?.close) {
      await current.close()
    }
  }, [])

  const ensureConnection = useCallback(async (connectionUrl: string): Promise<BrowserConnection> => {
    if (connectionRef.current && connectionUrlRef.current === connectionUrl) {
      return connectionRef.current
    }

    await closeConnection()
    const next = await options.createConnection(connectionUrl)
    connectionRef.current = next
    connectionUrlRef.current = connectionUrl
    setHasConnection(true)
    return next
  }, [closeConnection, options.createConnection])

  const navigate = useCallback(async (inputUrl: string) => {
    const target = parseBrowserTarget(inputUrl)
    if (target.directUrl) {
      setLoading(true)
      setError(null)
      clearActiveBlobUrl()
      await closeConnection()
      if (iframeRef.current) {
        iframeRef.current.srcdoc = ''
        iframeRef.current.src = target.directUrl
      }
      setLoading(false)
      return
    }

    if (!target.connectionUrl) {
      setError('Enter a css:// address or a site-viewer URL.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const connection = await ensureConnection(target.connectionUrl)
      const resolvedBasePath = connection.initialPath || '/'
      const requestPath = target.requestPath === '/' ? '' : target.requestPath
      const responseBasePath = resolvedBasePath === '/'
        ? (requestPath || '/')
        : `${resolvedBasePath.replace(/\/+$/, '')}${requestPath}`
      const responsePath = target.requestSearch
        ? `${responseBasePath}${target.requestSearch}`
        : responseBasePath
      const response = await connection.fetch(responsePath)

      if (!response.ok) {
        setError(`${response.status} ${response.statusText}`)
        setLoading(false)
        return
      }

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('text/html')) {
        clearActiveBlobUrl()
        const text = await response.text()
        const blob = new Blob([text], { type: contentType })
        const blobUrl = URL.createObjectURL(blob)
        activeBlobUrlRef.current = blobUrl
        if (iframeRef.current) {
          iframeRef.current.srcdoc = ''
          iframeRef.current.src = blobUrl
        }
        setLoading(false)
        return
      }

      clearActiveBlobUrl()
      const html = injectBridgeScript(await response.text())
      if (iframeRef.current) {
        iframeRef.current.src = 'about:blank'
        iframeRef.current.srcdoc = html
      }
      setLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }, [clearActiveBlobUrl, ensureConnection])

  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const data = event.data
      if (!data || data.type !== 'plat-fetch') return
      if (event.source !== iframeRef.current?.contentWindow) return

      const replyTarget = event.source as Window
      const connection = connectionRef.current

      const encodeJsonBody = (value: unknown): ArrayBuffer => {
        return new TextEncoder().encode(JSON.stringify(value)).buffer
      }

      if (!connection) {
        const body = encodeJsonBody({ error: 'No server connection' })
        replyTarget.postMessage({
          type: 'plat-fetch-response',
          id: data.id,
          ok: false,
          status: 503,
          statusText: 'No server connection',
          contentType: 'application/json',
          body,
          headers: {},
        }, '*', [body])
        return
      }

      try {
        const response = await connection.fetch(data.path, {
          method: data.method,
          headers: data.headers,
          body: data.body,
        })

        const respHeaders: Record<string, string> = {}
        response.headers.forEach((v, k) => { respHeaders[k] = v })
        const body = await response.arrayBuffer()

        replyTarget.postMessage({
          type: 'plat-fetch-response',
          id: data.id,
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type') || 'application/octet-stream',
          body,
          headers: respHeaders,
        }, '*', [body])
      } catch (err) {
        const body = encodeJsonBody({ error: String(err) })
        replyTarget.postMessage({
          type: 'plat-fetch-response',
          id: data.id,
          ok: false,
          status: 500,
          statusText: err instanceof Error ? err.message : 'Unknown error',
          contentType: 'application/json',
          body,
          headers: {},
        }, '*', [body])
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  useEffect(() => {
    return () => {
      clearActiveBlobUrl()
      void closeConnection()
    }
  }, [clearActiveBlobUrl, closeConnection])

  return {
    iframeRef,
    browserUrl,
    setBrowserUrl,
    loading,
    error,
    navigate,
    hasConnection,
    closeConnection,
  }
}
