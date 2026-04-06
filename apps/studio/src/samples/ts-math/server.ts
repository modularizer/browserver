import { serveClientSideServer } from '@modularizer/plat-client/client-server'

class MathApi {
  /** Add two numbers and return the sum. */
  async add({ a, b }: { a: number; b: number }) {
    return a + b
  }

  /** Multiply two numbers and return the product. */
  async multiply({ a, b }: { a: number; b: number }) {
    return a * b
  }

  /** Compute the factorial of a non-negative integer. */
  async factorial({ n }: { n: number }): Promise<number> {
    if (n < 0) throw new Error('n must be non-negative')
    if (n <= 1) return 1
    let result = 1
    for (let i = 2; i <= n; i++) result *= i
    return result
  }
}

export default serveClientSideServer('math', [MathApi])
