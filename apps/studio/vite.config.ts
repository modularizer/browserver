import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'singlefile' ? [viteSingleFile()] : [])],
  resolve: {
    alias: {
      '@browserver/core': path.resolve(__dirname, '../../packages/core/src/index.ts'),
      '@browserver/runtime': path.resolve(__dirname, '../../packages/runtime/src/index.ts'),
      '@browserver/storage': path.resolve(__dirname, '../../packages/storage/src/index.ts'),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    chunkSizeWarningLimit: 1000,
    assetsInlineLimit: mode === 'singlefile' ? Number.MAX_SAFE_INTEGER : 4096,
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
                id.includes('node_modules/@modularizer/plat') ||
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
