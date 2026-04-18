import { OpenAPIClient } from '@modularizer/plat-client/client-server'

const client = new OpenAPIClient(openapi, {
  baseUrl: 'css://dmz/ts-counter',
})

const before = await client.get()
console.log('before:', before.value)

const after = await client.increment()
console.log('after:', after.value)
