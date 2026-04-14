import {
  createRTCDataChannelAdapter,
  DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS,
} from '@modularizer/plat-client/client-server'

export interface AuthorityServableServer {
  serveChannel(channel: { subscribe(listener: (message: any) => void | Promise<void>): () => void }): () => void
}

export interface AuthorityHostRegistrationHandle {
  stop(): Promise<void>
}

function getAuthorityHttpBaseUrl(): string {
  const configured = import.meta.env.VITE_AUTHORITY_URL
  if (typeof configured !== 'string' || !configured.trim()) {
    throw new Error('Authority integration is not configured. Set VITE_AUTHORITY_URL.')
  }
  return configured.replace(/\/+$/, '')
}

function getAuthorityHostWsUrl(): string {
  const base = new URL(getAuthorityHttpBaseUrl())
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/ws/host`
  base.search = ''
  base.hash = ''
  return base.toString()
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

async function waitForSocketOpen(socket: WebSocket, timeoutMs = 10_000): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error('Timed out opening authority host socket'))
    }, timeoutMs)

    const onOpen = () => {
      cleanup()
      resolve()
    }

    const onError = () => {
      cleanup()
      reject(new Error('Authority host socket failed to open'))
    }

    const cleanup = () => {
      window.clearTimeout(timeout)
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('error', onError)
    }

    socket.addEventListener('open', onOpen, { once: true })
    socket.addEventListener('error', onError, { once: true })
  })
}

export async function registerAuthorityHostedServer(options: {
  serverName: string
  server: AuthorityServableServer
  token: string
  authMode?: 'public' | 'private' | 'anonymous'
}): Promise<AuthorityHostRegistrationHandle> {
  const socket = new WebSocket(getAuthorityHostWsUrl())
  const peers = new Set<RTCPeerConnection>()
  const unsubscribers = new Map<RTCPeerConnection, () => void>()
  let stopped = false

  const cleanupPeer = async (peer: RTCPeerConnection) => {
    unsubscribers.get(peer)?.()
    unsubscribers.delete(peer)
    peers.delete(peer)
    peer.close()
  }

  const handleConnectRequest = async (message: {
    connection_id: string
    server_name: string
    offer: RTCSessionDescriptionInit
  }) => {
    const peer = new RTCPeerConnection({
      iceServers: DEFAULT_CLIENT_SIDE_SERVER_ICE_SERVERS,
    })
    peers.add(peer)

    peer.ondatachannel = (event) => {
      const channel = createRTCDataChannelAdapter(event.channel)
      const unsubscribe = options.server.serveChannel(channel as any)
      unsubscribers.set(peer, unsubscribe)
      event.channel.addEventListener('close', () => {
        void cleanupPeer(peer)
      }, { once: true })
    }

    try {
      await peer.setRemoteDescription(message.offer)
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      await waitForIceGatheringComplete(peer)

      socket.send(JSON.stringify({
        type: 'connect_answer',
        connection_id: message.connection_id,
        answer: peer.localDescription ?? answer,
      }))
    } catch (error) {
      await cleanupPeer(peer)
      socket.send(JSON.stringify({
        type: 'connect_reject',
        connection_id: message.connection_id,
        reason: 'rejected',
      }))
      console.error('[authority] failed to answer connect request', error)
    }
  }

  await waitForSocketOpen(socket)

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out registering ${options.serverName} with authority`))
    }, 10_000)

    const onMessage = (event: MessageEvent<string>) => {
      let message: any
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }

      if (message.type === 'register_response') {
        const accepted = Array.isArray(message.accepted) ? message.accepted : []
        const rejected = Array.isArray(message.rejected) ? message.rejected : []
        if (accepted.includes(options.serverName)) {
          window.clearTimeout(timeout)
          resolve()
          return
        }
        const rejection = rejected.find((entry: any) => entry?.server_name === options.serverName)
        window.clearTimeout(timeout)
        reject(new Error(rejection?.message ?? `Authority rejected ${options.serverName}`))
        return
      }

      if (message.type === 'register_error') {
        window.clearTimeout(timeout)
        reject(new Error(message.message ?? `Authority could not register ${options.serverName}`))
        return
      }

      if (message.type === 'connect_request' && message.server_name === options.serverName) {
        void handleConnectRequest(message)
      }
    }

    const onClose = () => {
      window.clearTimeout(timeout)
      if (!stopped) reject(new Error('Authority host socket closed'))
    }

    const cleanup = () => {
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('close', onClose)
    }

    socket.addEventListener('message', onMessage)
    socket.addEventListener('close', onClose, { once: true })
  })

  const helloAcked = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      socket.removeEventListener('message', onHello)
      socket.removeEventListener('close', onHelloClose)
      reject(new Error('Timed out authenticating with authority'))
    }, 10_000)
    const onHello = (event: MessageEvent<string>) => {
      let msg: any
      try { msg = JSON.parse(event.data) } catch { return }
      if (msg?.type !== 'pong') return
      window.clearTimeout(timeout)
      socket.removeEventListener('message', onHello)
      socket.removeEventListener('close', onHelloClose)
      resolve()
    }
    const onHelloClose = () => {
      window.clearTimeout(timeout)
      socket.removeEventListener('message', onHello)
      reject(new Error('Authority host socket closed before authentication'))
    }
    socket.addEventListener('message', onHello)
    socket.addEventListener('close', onHelloClose, { once: true })
  })

  socket.send(JSON.stringify({ type: 'hello', token: options.token }))
  await helloAcked
  socket.send(JSON.stringify({
    type: 'register_online',
    servers: [{
      server_name: options.serverName,
      auth_mode: options.authMode ?? 'public',
    }],
  }))

  await ready

  return {
    async stop() {
      if (stopped) return
      stopped = true
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'register_offline',
            server_names: [options.serverName],
          }))
        }
      } catch {
        // Best effort during shutdown.
      }

      for (const peer of Array.from(peers)) {
        await cleanupPeer(peer)
      }

      socket.close()
    },
  }
}
