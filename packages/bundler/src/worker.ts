/// <reference lib="webworker" />
import * as esbuild from 'esbuild-wasm'
// @ts-ignore
import * as ts from 'typescript'
import type {
  BuildRequest,
  BundlerFile,
  WorkerRequest,
  WorkerResponse,
} from './protocol'

let initialized: Promise<void> | null = null

function ensureInit(wasmURL: string): Promise<void> {
  if (!initialized) {
    initialized = esbuild.initialize({ wasmURL, worker: false })
  }
  return initialized
}

const CDN = 'https://esm.sh'

function vfsPlugin(files: BundlerFile[]): esbuild.Plugin {
  const map = new Map(files.map((f) => [normalize(f.path), f]))
  return {
    name: 'browserver-vfs',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        // Special-case: rewrite JSX runtime imports for React 17+
        if (args.path === 'react/jsx-runtime') {
          return { path: 'https://esm.sh/react@18/jsx-runtime', namespace: 'cdn', external: false }
        }
        if (args.path === 'react/jsx-dev-runtime') {
          return { path: 'https://esm.sh/react@18/jsx-dev-runtime', namespace: 'cdn', external: false }
        }
        // Entry / absolute VFS path
        if (args.kind === 'entry-point') {
          return { path: normalize(args.path), namespace: 'vfs' }
        }
        // Special-case: rewrite bare imports for React/ReactDOM to ESM-compatible CDN URLs
        if (args.path === 'react') {
          // Use ESM build from esm.sh
          return { path: 'https://esm.sh/react@18', namespace: 'cdn', external: false }
        }
        if (args.path === 'react-dom') {
          // Use ESM build from esm.sh
          return { path: 'https://esm.sh/react-dom@18', namespace: 'cdn', external: false }
        }
        if (args.path === 'react-dom/client') {
          // Use ESM build from esm.sh for react-dom/client
          return { path: 'https://esm.sh/react-dom@18/client', namespace: 'cdn', external: false }
        }
        // Imports inside a CDN module
        if (args.namespace === 'cdn') {
          // Absolute URL
          if (/^https?:\/\//.test(args.path)) {
            return { path: args.path, namespace: 'cdn', external: false }
          }
          // Root-absolute (e.g. "/react@19/..."), resolve against importer origin
          if (args.path.startsWith('/')) {
            const base = new URL(args.importer)
            return { path: `${base.origin}${args.path}`, namespace: 'cdn', external: false }
          }
          // Relative (./ ../)
          if (args.path.startsWith('.')) {
            const url = new URL(args.path, args.importer).toString()
            return { path: url, namespace: 'cdn', external: false }
          }
          // Bare inside CDN module → hand back to esm.sh as a new bare request
          return { path: `${CDN}/${args.path}`, namespace: 'cdn', external: false }
        }
        // Relative import inside vfs
        if (args.namespace === 'vfs' && (args.path.startsWith('./') || args.path.startsWith('../'))) {
          const resolved = resolveRelative(args.importer, args.path)
          const hit = resolveWithExtensions(map, resolved)
          if (hit) return { path: hit, namespace: 'vfs' }
          return { errors: [{ text: `Cannot resolve ${args.path} from ${args.importer}` }] }
        }
        // Bare import from vfs -> CDN
        if (!/^https?:\/\//.test(args.path)) {
          return { path: `${CDN}/${args.path}`, namespace: 'cdn', external: false }
        }
        return { path: args.path, namespace: 'cdn', external: false }
      })

      build.onLoad({ filter: /.*/, namespace: 'vfs' }, (args) => {
        const file = map.get(args.path)
        if (!file) return { errors: [{ text: `Missing in VFS: ${args.path}` }] }
        // If TypeScript, transpile to JS first to strip type-only syntax
        if (args.path.endsWith('.ts') || args.path.endsWith('.tsx')) {
          const transpiled = ts.transpileModule(file.contents, {
            compilerOptions: {
              module: ts.ModuleKind.ESNext,
              target: ts.ScriptTarget.ES2022,
              jsx: ts.JsxEmit.ReactJSX,
              esModuleInterop: true,
              allowSyntheticDefaultImports: true,
            },
            fileName: args.path,
          })
          return { contents: transpiled.outputText, loader: 'js' }
        }
        return { contents: file.contents, loader: loaderFor(args.path) }
      })

      build.onLoad({ filter: /.*/, namespace: 'cdn' }, async (args) => {
        const res = await fetch(args.path)
        if (!res.ok) return { errors: [{ text: `Fetch ${args.path} -> ${res.status}` }] }
        const contents = await res.text()
        return { contents, loader: loaderFor(args.path) }
      })
    },
  }
}

function loaderFor(path: string): esbuild.Loader {
  if (path.endsWith('.tsx')) return 'tsx'
  if (path.endsWith('.ts')) return 'ts'
  if (path.endsWith('.jsx')) return 'jsx'
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.css')) return 'css'
  return 'js'
}

function normalize(p: string): string {
  if (!p.startsWith('/')) p = '/' + p
  return p.replace(/\/+/g, '/')
}

function resolveRelative(importer: string, rel: string): string {
  const base = importer.split('/').slice(0, -1).join('/')
  const parts = (base + '/' + rel).split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

function resolveWithExtensions(map: Map<string, BundlerFile>, path: string): string | null {
  if (map.has(path)) return path
  for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
    if (map.has(path + ext)) return path + ext
  }
  for (const idx of ['/index.tsx', '/index.ts', '/index.jsx', '/index.js']) {
    if (map.has(path + idx)) return path + idx
  }
  return null
}

async function handleBuild(req: BuildRequest): Promise<WorkerResponse> {
  const t0 = performance.now()
  try {
      console.warn("format", req.format)
    const esbuildOptions: esbuild.BuildOptions = {
      entryPoints: [normalize(req.entry)],
      bundle: true,
      format: req.format ?? 'esm',
      target: 'es2022',
      jsx: 'automatic',
      jsxDev: req.jsxDev ?? false,
      sourcemap: 'inline',
      write: false,
      plugins: [vfsPlugin(req.files)],
      logLevel: 'silent',
      platform: 'browser',
      entryNames: 'main',
      // external: ['react', 'react-dom'], // Do not mark as external, so esm.sh ESM React is bundled
      globalName: (req.format ?? 'esm') === 'iife' ? (req.globalName ?? '__browserverPreview') : undefined,
      banner: {
        js: '',
      },
      footer: {
        js: '',
      },
      define: {},
      // esbuild-wasm does not support globals directly, so we rely on externals and globalName
    }
    if ((req.format ?? 'esm') === 'iife') {
      esbuildOptions.globalName = req.globalName ?? '__browserverPreview'
    }
    const result = await esbuild.build(esbuildOptions)
    // Post-process: remove any top-level export statements from output (workaround for esbuild iife export bug)
    const outputs = (result.outputFiles ?? []).map((f) => {
      let code = f.text
      // Remove all ESM export forms
      code = code.replace(/^export\s+\{[^}]+\};?$/gm, '') // export { foo };
      code = code.replace(/^export\s+default\s+[^;]+;?$/gm, '') // export default ...;
      code = code.replace(/^export\s+\*\s+from\s+['"][^'"]+['"];?$/gm, '') // export * from '...';
      code = code.replace(/^export\s+\w+\s+\w+[^;]*;?$/gm, '') // export interface/type/class/const/let/var/function ...
      code = code.replace(/^export\s+\{[^}]+\}\s+from\s+['"][^'"]+['"];?$/gm, '') // export { foo } from '...';
      // Debug: print first 1000 chars of output
      if (typeof console !== 'undefined' && code) {
        // eslint-disable-next-line no-console
        console.warn('[browserver-bundler] Output preview:', code.slice(0, 1000))
      }
      return { path: f.path, contents: code }
    })
    return {
      id: req.id,
      ok: true,
      durationMs: performance.now() - t0,
      warnings: result.warnings.map((w) => ({ text: w.text, location: w.location })),
      outputs,
    }
  } catch (err: any) {
    const errors = (err.errors as esbuild.Message[] | undefined) ?? [
      { text: String(err?.message ?? err), location: null },
    ]
    return {
      id: req.id,
      ok: false,
      errors: errors.map((e) => ({ text: e.text, location: e.location ?? null })),
      warnings: (err.warnings ?? []).map((w: esbuild.Message) => ({ text: w.text, location: w.location })),
    }
  }
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  const post = (r: WorkerResponse) => (self as DedicatedWorkerGlobalScope).postMessage(r)
  if (msg.type === 'init') {
    try {
      await ensureInit(msg.wasmURL)
      post({ id: msg.id, ok: true, type: 'init' })
    } catch (err: any) {
      initialized = null
      post({
        id: msg.id,
        ok: false,
        errors: [{ text: `esbuild init failed: ${String(err?.message ?? err)}` }],
        warnings: [],
      })
    }
    return
  }
  if (msg.type === 'build') {
    if (!initialized) {
      post({
        id: msg.id,
        ok: false,
        errors: [{ text: 'Bundler not initialized' }],
        warnings: [],
      })
      return
    }
    try {
      await initialized
    } catch (err: any) {
      post({
        id: msg.id,
        ok: false,
        errors: [{ text: `esbuild init failed: ${String(err?.message ?? err)}` }],
        warnings: [],
      })
      return
    }
    post(await handleBuild(msg))
  }
}
