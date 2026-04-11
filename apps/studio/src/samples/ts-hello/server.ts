import { serveClientSideServer } from '@modularizer/plat-client/client-server'

class HelloApi {
  /** Say hello to someone by name. */
  async greet({ name }: { name: string }) {
    return { message: `Hello, ${name}!` }
  }
}

export default serveClientSideServer('ts-hello', [HelloApi])
