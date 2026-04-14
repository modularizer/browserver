import { OpenAPIClient } from '@modularizer/plat-client/client-server'

const client = new OpenAPIClient(openapi, {
  baseUrl: 'css://dmz/py-hello',
})

const result = await client.greet({ name: 'world' })
console.log(result.message)
