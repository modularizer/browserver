import type { ClientSideServerChannel } from '@modularizer/plat-client/client-server'

export interface DialHandle {
  channel: ClientSideServerChannel
  /** Register a callback fired when this concrete channel terminates unexpectedly. */
  onClosed(cb: () => void): () => void
}

export type ReconnectState = 'open' | 'reconnecting' | 'closed'

export interface ReconnectingChannelOptions {
  dial: () => Promise<DialHandle>
  /** Optional presence signal — resolves when the server is likely available. */
  waitForOnline?: () => Promise<void>
  maxBackoffMs?: number
  onStateChange?: (state: ReconnectState) => void
}

export interface ReconnectingChannel extends ClientSideServerChannel {
  close(): Promise<void>
  isOpen(): boolean
}

type Listener = Parameters<ClientSideServerChannel['subscribe']>[0]

export async function createReconnectingChannel(
  options: ReconnectingChannelOptions,
): Promise<ReconnectingChannel> {
  const listeners = new Set<Listener>()
  let current: DialHandle | null = null
  let closed = false
  let unsubMessages: (() => void) | null = null
  let unsubClosed: (() => void) | null = null
  let waiters: Array<() => void> = []

  const fanout: Listener = (msg) => {
    for (const l of listeners) void l(msg)
  }

  const detach = () => {
    unsubMessages?.()
    unsubClosed?.()
    unsubMessages = null
    unsubClosed = null
    current = null
  }

  const attach = (handle: DialHandle) => {
    current = handle
    unsubMessages = handle.channel.subscribe(fanout)
    unsubClosed = handle.onClosed(() => {
      if (closed) return
      detach()
      options.onStateChange?.('reconnecting')
      void reconnectLoop()
    })
    options.onStateChange?.('open')
    const pending = waiters
    waiters = []
    for (const w of pending) w()
  }

  const reconnectLoop = async () => {
    let delay = 500
    const max = options.maxBackoffMs ?? 15_000
    while (!closed) {
      try {
        if (options.waitForOnline) await options.waitForOnline()
        const next = await options.dial()
        if (closed) {
          await next.channel.close?.()
          return
        }
        attach(next)
        return
      } catch {
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, max)
      }
    }
  }

  const awaitOpen = () =>
    new Promise<void>((resolve, reject) => {
      if (closed) return reject(new Error('channel closed'))
      if (current) return resolve()
      waiters.push(resolve)
    })

  attach(await options.dial())

  return {
    async send(message) {
      if (!current) await awaitOpen()
      if (closed) throw new Error('channel closed')
      return current!.channel.send(message)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async close() {
      if (closed) return
      closed = true
      const handle = current
      detach()
      const pending = waiters
      waiters = []
      for (const w of pending) w()
      await handle?.channel.close?.()
      options.onStateChange?.('closed')
    },
    isOpen() {
      return !closed && current !== null
    },
  }
}

/**
 * Builds an `onClosed` registrar from an RTCPeerConnection, firing when the
 * peer transitions into a terminal state.
 */
export function peerConnectionClosedSignal(peer: RTCPeerConnection): (cb: () => void) => () => void {
  return (cb) => {
    let fired = false
    const fire = () => {
      if (fired) return
      const s = peer.connectionState
      if (s === 'closed' || s === 'failed' || s === 'disconnected') {
        fired = true
        peer.removeEventListener('connectionstatechange', fire)
        cb()
      }
    }
    peer.addEventListener('connectionstatechange', fire)
    return () => peer.removeEventListener('connectionstatechange', fire)
  }
}

/**
 * Builds an `onClosed` registrar from any object exposing `isOpen()`, by
 * polling. Used for plat sessions that don't expose a close event.
 */
export function pollingClosedSignal(
  target: { isOpen(): boolean },
  intervalMs = 1500,
): (cb: () => void) => () => void {
  return (cb) => {
    let fired = false
    const id = setInterval(() => {
      if (fired) return
      if (!target.isOpen()) {
        fired = true
        clearInterval(id)
        cb()
      }
    }, intervalMs)
    return () => clearInterval(id)
  }
}