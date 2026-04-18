import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => ({
  base: mode === 'singlefile' ? './' : (process.env.GITHUB_ACTIONS ? '/browserver/' : '/'),
  plugins: [
    react(),
    platClientBundlePlugin(),
    ...(mode === 'singlefile' ? [viteSingleFile(), inlineMonacoWorkerFiles()] : []),
  ],
  resolve: {
    alias: {
      '@modularizer/plat/client-server': '@modularizer/plat-client/client-server',
      '@modularizer/plat/client': '@modularizer/plat-client',
      '@browserver/bundler': path.resolve(__dirname, '../../packages/bundler/src/index.ts'),
      '@browserver/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@browserver/database': path.resolve(__dirname, '../../packages/database/src/index.ts'),
      '@browserver/runtime': path.resolve(__dirname, '../../packages/runtime/src/index.ts'),
      '@browserver/storage': path.resolve(__dirname, '../../packages/storage/src/index.ts'),
    },
    dedupe: ['react', 'react-dom'],
    preserveSymlinks: true,
  },
  optimizeDeps: {
    include: [
      '@modularizer/plat-client',
      '@modularizer/plat-client/client-server',
      '@modularizer/plat-client/static',
    ],
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1000,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      output: {
        manualChunks: mode === 'singlefile'
          ? undefined
          : (id) => {
              if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) {
                return 'react'
              }
              if (id.includes('node_modules/monaco-editor')) {
                return 'monaco'
              }
              if (
                id.includes('node_modules/@modularizer/plat-client') ||
                id.includes('node_modules/mqtt') ||
                id.includes('node_modules/zod')
              ) {
                return 'plat'
              }
            },
      },
    },
  },
  publicDir: 'public',
}))

// Inlines the @modularizer/plat-client dist into the studio as a virtual module
// (`virtual:plat-client-bundle`). The studio feeds these files + an alias map
// into the site-viewer bundler on every build so bare imports of
// `@modularizer/plat-client` resolve to the local checkout instead of esm.sh.
function platClientBundlePlugin() {
  const VIRTUAL_ID = 'virtual:plat-client-bundle'
  const RESOLVED_ID = '\0' + VIRTUAL_ID
  const VFS_ROOT = '/node_modules/@modularizer/plat-client/dist'
  const ALIASES: Record<string, string> = {
    '@modularizer/plat-client': `${VFS_ROOT}/client-entry.js`,
    '@modularizer/plat-client/client-server': `${VFS_ROOT}/client-server-entry.js`,
    '@modularizer/plat-client/python-browser': `${VFS_ROOT}/python-browser-entry.js`,
    '@modularizer/plat-client/static': `${VFS_ROOT}/static/index.js`,
  }
  async function collectFiles(distDir: string): Promise<Array<{ path: string; contents: string }>> {
    const out: Array<{ path: string; contents: string }> = []
    async function walk(dir: string): Promise<void> {
      const items = await fs.readdir(dir, { withFileTypes: true })
      for (const item of items) {
        const full = path.join(dir, item.name)
        if (item.isDirectory()) { await walk(full); continue }
        if (!item.name.endsWith('.js')) continue
        const rel = path.relative(distDir, full).split(path.sep).join('/')
        out.push({ path: `${VFS_ROOT}/${rel}`, contents: await fs.readFile(full, 'utf8') })
      }
    }
    await walk(distDir)
    return out
  }

  let distDir: string | null = null

  return {
    name: 'plat-client-bundle',
    async configResolved() {
      // Resolve the package's main entry (its exports map hides
      // package.json); the dist/ root is the entry's directory.
      // Use import.meta.resolve so the exports map's "import" condition
      // matches (require-only resolution fails here).
      const entryUrl = await (import.meta as any).resolve('@modularizer/plat-client', import.meta.url)
      distDir = path.dirname(fileURLToPath(entryUrl))
    },
    configureServer(server: import('vite').ViteDevServer) {
      if (distDir) server.watcher.add(distDir)
      server.watcher.on('change', (file) => {
        if (distDir && file.startsWith(distDir)) {
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
          if (mod) server.reloadModule(mod)
        }
      })
    },
    resolveId(id: string) {
      if (id === VIRTUAL_ID) return RESOLVED_ID
      return null
    },
    async load(id: string) {
      if (id !== RESOLVED_ID) return null
      if (!distDir) throw new Error('[plat-client-bundle] dist path not resolved')
      const files = await collectFiles(distDir)
      return `export const files = ${JSON.stringify(files)};\n`
        + `export const aliases = ${JSON.stringify(ALIASES)};\n`
    },
  }
}

function inlineMonacoWorkerFiles() {
  return {
    name: 'inline-monaco-worker-files',
    apply: 'build' as const,
    async closeBundle() {
      const distDir = path.resolve(__dirname, 'dist')
      const indexPath = path.join(distDir, 'index.html')
      let html = await fs.readFile(indexPath, 'utf8')
      const filenames = await fs.readdir(distDir)
      const workerFiles = filenames.filter((name) => /\.worker-[A-Za-z0-9_-]+\.js$/.test(name))

      for (const fileName of workerFiles) {
        const workerPath = path.join(distDir, fileName)
        const source = await fs.readFile(workerPath)
        const dataUrl = `data:text/javascript;base64,${source.toString('base64')}`
        html = html.replaceAll(fileName, dataUrl)
        await fs.rm(workerPath)
      }

      await fs.writeFile(indexPath, html)
    },
  }
}
