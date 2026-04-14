import {
  connectClientSideServer,
  createClientSideServerMQTTWebRTCPeerPool,
  createClientSideServerTransportPlugin,
  createPlatFetch,
  createRTCDataChannelAdapter,
  DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS,
  fetchClientSideServerOpenAPI,
  OpenAPIClient,
  parseClientSideServerAddress,
  type ClientSideServerChannel,
} from '@modularizer/plat-client/client-server'
import { buildCssTargetUrl, parseCssServerName } from './clientTargetUrl'
import {
  createReconnectingChannel,
  peerConnectionClosedSignal,
  pollingClosedSignal,
  type DialHandle,
  type ReconnectingChannel,
} from './reconnectingChannel'

function getAuthorityHttpBaseUrl(): string {
  const configured = import.meta.env.VITE_AUTHORITY_URL
  if (typeof configured !== 'string' || !configured.trim()) {
    throw new Error('Authority integration is not configured. Set VITE_AUTHORITY_URL.')
  }
  return configured.replace(/\/+$/, '')
}

async function waitForIceGatheringComplete(peer: RTCPeerConnection, timeoutMs = 5_000): Promise<void> {
  if (peer.iceGatheringState === 'complete') return
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      peer.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }, timeoutMs)
    const onChange = () => {
      if (peer.iceGatheringState === 'complete') {
        window.clearTimeout(timeout)
        peer.removeEventListener('icegatheringstatechange', onChange)
        resolve()
      }
    }
    peer.addEventListener('icegatheringstatechange', onChange)
  })
}

async function waitForDataChannelOpen(channel: RTCDataChannel, timeoutMs = 15_000): Promise<void> {
  if (channel.readyState === 'open') return

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Timed out opening authority data channel'))
    }, timeoutMs)

    const onOpen = () => {
      cleanup()
      resolve()
    }

    const onError = () => {
      cleanup()
      reject(new Error('Authority data channel failed'))
    }

    const onClose = () => {
      cleanup()
      reject(new Error('Authority data channel closed before becoming ready'))
    }

    const cleanup = () => {
      window.clearTimeout(timeout)
      channel.removeEventListener('open', onOpen)
      channel.removeEventListener('error', onError)
      channel.removeEventListener('close', onClose)
    }

    channel.addEventListener('open', onOpen, { once: true })
    channel.addEventListener('error', onError, { once: true })
    channel.addEventListener('close', onClose, { once: true })
  })
}

function resolveCssServerName(baseUrl: string): string {
  const serverName = parseCssServerName(baseUrl)
  if (!serverName) {
    throw new Error(`Invalid css:// target: ${baseUrl}`)
  }
  return serverName
}

interface AuthorityConnectResult {
  channel: ClientSideServerChannel
  /** Canonical server name matched by the authority (may be a prefix of requestedName). */
  matchedServerName: string
  /** Leftover path after prefix match; '' on exact match, or '/...'. */
  initialPath: string
}

interface AuthorityDialHandle extends DialHandle {
  matchedServerName: string
  initialPath: string
}

async function dialAuthorityChannel(requestedName: string): Promise<AuthorityDialHandle> {
  const peer = new RTCPeerConnection({
    iceServers: DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS,
  })
  const dataChannel = peer.createDataChannel(`plat-authority:${crypto.randomUUID()}`)

  const offer = await peer.createOffer()
  await peer.setLocalDescription(offer)
  await waitForIceGatheringComplete(peer)

  const response = await fetch(`${getAuthorityHttpBaseUrl()}/connect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      server_name: requestedName,
      offer: peer.localDescription ?? offer,
      auth: { mode: 'public', credentials: null },
      client: {
        request_id: crypto.randomUUID(),
        user_agent: navigator.userAgent,
      },
    }),
  })

  const payload = await response.json().catch(() => null) as {
    ok?: boolean
    answer?: RTCSessionDescriptionInit
    server_name?: string
    path?: string
    error?: string
    message?: string
  } | null

  if (!response.ok || !payload?.ok || !payload.answer) {
    peer.close()
    throw new Error(payload?.message || payload?.error || `Authority connect failed for ${requestedName}`)
  }

  await peer.setRemoteDescription(payload.answer)
  await waitForDataChannelOpen(dataChannel)

  const rawChannel = createRTCDataChannelAdapter(dataChannel)
  const originalClose = rawChannel.close?.bind(rawChannel)
  const channel: ClientSideServerChannel = {
    ...rawChannel,
    async close() {
      await originalClose?.()
      peer.close()
    },
  }
  return {
    channel,
    onClosed: peerConnectionClosedSignal(peer),
    matchedServerName: payload.server_name ?? requestedName,
    initialPath: payload.path ?? '',
  }
}

/**
 * Opens a WebSocket to the authority's `/ws/presence` endpoint and resolves
 * when the named server becomes online. If the socket can't be opened or is
 * lost before an online event arrives, resolves after a short delay so the
 * outer reconnect backoff loop can retry `dial` directly.
 *
 * Protocol (see plat/authority/src/models/authority-types.ts):
 *   → { type: 'subscribe', server_names: [name] }
 *   ← { type: 'presence_snapshot', servers: [{ server_name, online }] }
 *   ← { type: 'presence_update', server_name, online }
 */
function watchAuthorityPresence(serverName: string): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    let socket: WebSocket | null = null
    const done = () => {
      if (settled) return
      settled = true
      try { socket?.close() } catch { /* ignore */ }
      resolve()
    }

    try {
      const http = getAuthorityHttpBaseUrl()
      const wsBase = http.replace(/^http/, 'ws')
      socket = new WebSocket(`${wsBase}/ws/presence`)
    } catch {
      setTimeout(done, 2_000)
      return
    }

    const fallbackTimeout = window.setTimeout(done, 120_000)
    const clearFallback = () => window.clearTimeout(fallbackTimeout)

    socket.addEventListener('open', () => {
      socket?.send(JSON.stringify({ type: 'subscribe', server_names: [serverName] }))
    })

    socket.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
        if (msg?.type === 'presence_snapshot' && Array.isArray(msg.servers)) {
          const hit = msg.servers.find((s: any) => s?.server_name === serverName)
          if (hit?.online) { clearFallback(); done() }
        } else if (msg?.type === 'presence_update' && msg.server_name === serverName && msg.online) {
          clearFallback()
          done()
        }
      } catch { /* ignore */ }
    })
    socket.addEventListener('error', () => { clearFallback(); done() })
    socket.addEventListener('close', () => { clearFallback(); done() })
  })
}

async function connectAuthorityChannel(requestedName: string): Promise<AuthorityConnectResult> {
  let matchedServerName = requestedName
  let initialPath = ''
  const channel = await createReconnectingChannel({
    async dial() {
      const handle = await dialAuthorityChannel(requestedName)
      matchedServerName = handle.matchedServerName
      initialPath = handle.initialPath
      return handle
    },
    waitForOnline: () => watchAuthorityPresence(requestedName),
  })
  return { channel, matchedServerName, initialPath }
}

async function connectDmzChannel(serverName: string): Promise<ReconnectingChannel> {
  const pool = createClientSideServerMQTTWebRTCPeerPool()
  const canonical = buildCssTargetUrl(serverName)
  const address = parseClientSideServerAddress(canonical)
  return await createReconnectingChannel({
    async dial() {
      const session = await pool.connect(address)
      return {
        channel: session,
        onClosed: pollingClosedSignal(session),
      }
    },
  })
}

function createBrowserverCssTransportPlugin() {
  const channels = new Map<string, Promise<ClientSideServerChannel>>()

  const getChannel = (serverName: string) => {
    let existing = channels.get(serverName)
    if (existing) return existing
    const promise = (async () => {
      if (serverName.startsWith('dmz/')) return await connectDmzChannel(serverName)
      const { channel } = await connectAuthorityChannel(serverName)
      return channel
    })()
    channels.set(serverName, promise)
    return promise
  }

  return createClientSideServerTransportPlugin({
    async connect({ request }) {
      const serverName = resolveCssServerName(request.baseUrl)
      return await getChannel(serverName)
    },
  })
}

export async function connectBrowserverClientSideServer(baseUrl: string): Promise<{
  client: OpenAPIClient
  openapi: Record<string, any>
}> {
  const trimmed = baseUrl.trim()
  if (!trimmed.startsWith('css://')) {
    return await connectClientSideServer({ baseUrl: trimmed })
  }

  const transportPlugin = createBrowserverCssTransportPlugin()
  const openapi = await fetchClientSideServerOpenAPI(trimmed, transportPlugin)
  const client = new OpenAPIClient(openapi as any, {
    baseUrl: trimmed,
    transportPlugins: [transportPlugin],
  })
  return { client, openapi }
}

export interface BrowserverCssFetchConnection {
  fetch: typeof fetch
  /** Canonical server name the authority matched (may be a prefix of the requested name). */
  matchedServerName: string
  /** Leftover path segment after prefix match ('' if exact, else '/...'). */
  initialPath: string
  /** Subscribe to server-pushed peer events. Returns an unsubscribe fn. */
  onPeerEvent: (handler: (event: string, data?: unknown) => void) => () => void
  close?: () => void | Promise<void>
}

function attachPeerEventBus(channel: ClientSideServerChannel) {
  const handlers = new Set<(event: string, data?: unknown) => void>()
  channel.subscribe((message) => {
    const m = message as any
    if (m && m.platcss === 'peer' && typeof m.event === 'string') {
      console.log('[plat] peer event received:', m.event, 'handlers=', handlers.size)
      for (const h of handlers) { try { h(m.event, m.data) } catch (err) { console.warn('[plat peer handler]', err) } }
    }
  })
  return (handler: (event: string, data?: unknown) => void) => {
    handlers.add(handler)
    return () => handlers.delete(handler)
  }
}

export async function createBrowserverCssFetchConnection(baseUrl: string): Promise<BrowserverCssFetchConnection> {
  const requestedName = resolveCssServerName(baseUrl)

  if (requestedName.startsWith('dmz/')) {
    const channel = await connectDmzChannel(requestedName)
    return {
      fetch: createPlatFetch({ channel }),
      matchedServerName: requestedName,
      initialPath: '',
      onPeerEvent: attachPeerEventBus(channel),
      close: async () => { await channel.close() },
    }
  }

  const { channel, matchedServerName, initialPath } = await connectAuthorityChannel(requestedName)
  return {
    fetch: createPlatFetch({ channel }),
    matchedServerName,
    initialPath,
    onPeerEvent: attachPeerEventBus(channel),
    close: async () => { await channel.close?.() },
  }
}
