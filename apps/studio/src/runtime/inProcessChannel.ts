import type { ClientSideServerChannel } from '@modularizer/plat-client/client-server'

/**
 * Creates an in-process ClientSideServerChannel that directly calls
 * the server's handleMessage method. No WebRTC/MQTT overhead.
 *
 * The server object is typed as `unknown` because browserver doesn't
 * directly depend on PLATClientSideServer — it receives it from the runtime.
 */
export function createInProcessChannel(server: unknown): ClientSideServerChannel {
  const listeners = new Set<(message: any) => void | Promise<void>>()

  const channel: ClientSideServerChannel = {
    send(message: any) {
      // This is a request from the client side — route to server
      const srv = server as { handleMessage(message: any, channel: ClientSideServerChannel): Promise<void> }
      void srv.handleMessage(message, responseChannel)
    },
    subscribe(listener: (message: any) => void | Promise<void>) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    close() {
      listeners.clear()
    },
  }

  // Response channel: when the server sends a response, it goes to our listeners
  const responseChannel: ClientSideServerChannel = {
    send(message: any) {
      for (const listener of listeners) {
        void listener(message)
      }
    },
    subscribe() { return () => {} },
  }

  return channel
}
