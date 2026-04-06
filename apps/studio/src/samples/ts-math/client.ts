import { OpenAPIClient } from '@modularizer/plat-client/client-server'

const client = new OpenAPIClient(openapi, {
  baseUrl: 'css://math',
})

const sum = await client.add({ a: 20, b: 22 })
console.log('sum:', sum)

const product = await client.multiply({ a: 6, b: 7 })
console.log('product:', product)

const fact = await client.factorial({ n: 10 })
console.log('10!:', fact)
