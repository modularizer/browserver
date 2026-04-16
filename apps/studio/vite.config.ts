import fs from 'node:fs/promises'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => ({
  base: mode === 'singlefile' ? './' : (process.env.GITHUB_ACTIONS ? '/browserver/' : '/'),
  plugins: [
    react(),
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
