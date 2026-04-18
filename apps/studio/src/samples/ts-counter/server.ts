import { createServer } from '@modularizer/plat'
import { createClient } from 'redis'

const redis = createClient()
await redis.connect()

class CounterApi {
  /** Increment the shared counter and return the new value. */
  async increment() {
    const value = await redis.incr('count')
    return { value }
  }

  /** Read the current counter value without mutating it. */
  async get() {
    const raw = await redis.get('count')
    return { value: raw ? Number(raw) : 0 }
  }

  /** Reset the counter back to zero. */
  async reset() {
    await redis.set('count', '0')
    return { value: 0 }
  }
}

const server = createServer({ name: 'dmz/ts-counter' }, CounterApi)
await server.listen()

export default server
