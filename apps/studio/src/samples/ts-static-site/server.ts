import { serveClientSideServer } from '@modularizer/plat-client/client-server'
import { StaticFolder } from '@modularizer/plat-client/static'

class SiteApi {
  // Serve workspace files (HTML, CSS, images, etc.) from the root URL.
  // __workspaceFiles is injected by browserver with all non-code files.
  root = new StaticFolder(__workspaceFiles, {
    exclude: ['**/*.ts'],
    index: 'index.html',
  })

  async health() {
    return { ok: true, timestamp: Date.now() }
  }
}

export default serveClientSideServer('static-site', [SiteApi])
