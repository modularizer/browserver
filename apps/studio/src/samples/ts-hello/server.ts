import { createServer } from '@modularizer/plat'

class HelloApi {
  /** Say hello to someone by name. */
  async greet({ name }: { name: string }) {
    return { message: `Hello, ${name}!` }
  }
}

const server = createServer({ name: 'dmz/ts-hello' }, HelloApi)
await server.listen()

export default server
