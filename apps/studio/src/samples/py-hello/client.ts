import { OpenAPIClient } from '@modularizer/plat/client-server'

const client = new OpenAPIClient(openapi, {
  baseUrl: 'css://py-hello',
})

const result = await client.greet({ name: 'world' })
console.log(result.message)
