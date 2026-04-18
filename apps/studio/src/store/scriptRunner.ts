import { create } from 'zustand'
import { Bundler, type BundlerFile } from '@browserver/bundler'
import BundlerWorker from '../../../../packages/bundler/src/worker.ts?worker'
import {
  files as platClientFiles,
  aliases as platClientAliases,
} from 'virtual:plat-client-bundle'
import { useWorkspaceStore } from './workspace'
import { useIdentityStore } from './identity'
import { useNamespaceStore } from './namespace'
import { startLocalTsRuntime } from '../runtime/localTsRuntime'
import { buildSiteViewerUrl } from '../runtime/siteViewerUrl'
import type { LocalRuntimeHandle } from '../runtime/types'

// Must match the esbuild-wasm version in packages/bundler/package.json exactly
import esbuildPkg from 'esbuild-wasm/package.json'
const ESBUILD_VERSION = (esbuildPkg as { version: string }).version
const WASM_URL = `https://unpkg.com/esbuild-wasm@${ESBUILD_VERSION}/esbuild.wasm`

export type RunnerPhase = 'idle' | 'initializing' | 'building' | 'serving' | 'ok' | 'error'

export type ScriptKind = 'build' | 'dev' | 'start' | 'unknown'

export type ServerLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'
export interface ServerLogEntry {
  ts: number
  level: ServerLogLevel
  text: string
}

const MAX_SERVER_LOGS = 500

export interface ScriptRunnerState {
  phase: RunnerPhase
  scriptName: string | null
  /**
   * Workspace path (typically a package.json) that owns the current run.
   * Used by the runtime store to mirror phase → tab-session status so the
   * favicon, runtime pill, and .browserver.yaml autorestart stay in sync.
   */
  ownerPath: string | null
  message: string
  errors: string[]
  serverName: string | null
  viewerUrl: string | null
  connectionUrl: string | null
  devWatching: boolean
  lastBuiltAt: number | null
  durationMs: number
  serverLogs: ServerLogEntry[]
  appendServerLog: (level: ServerLogLevel, text: string) => void
  clearServerLogs: () => void
  runScript: (script: { name: string; command: string; kind: ScriptKind }, files: BundlerFile[], entry: string | null, ownerPath?: string) => Promise<void>
  stop: () => Promise<void>
}

let bundler: Bundler | null = null
function getBundler(): Bundler {
  if (!bundler) {
    bundler = new Bundler({ wasmURL: WASM_URL, worker: new BundlerWorker() })
  }
  return bundler
}

let buildSeq = 0
let runtimeHandle: LocalRuntimeHandle | null = null
let watchUnsub: (() => void) | null = null
let watchDebounce: ReturnType<typeof setTimeout> | null = null

function buildHtml(js: string, serverName: string, siteViewerUrl: string): string {
  return `<!doctype html>
<html class="dark" style="background:#0b1020;color:#e2e8f0">
<head>
  <meta charset="utf-8" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>html,body{margin:0;min-height:100%;background:#0b1020;color:#e2e8f0;font-family:ui-sans-serif,system-ui}</style>
</head>
<body>
  <div id="root"></div>
  <script>
  window.__SERVER_NAME__ = ${JSON.stringify(serverName)}
  window.__SITE_VIEWER_URL__ = ${JSON.stringify(siteViewerUrl)}
  window.baseUrl = ${JSON.stringify(siteViewerUrl + '/' + serverName )}
    
    
  <\/script>
  <script>${js}<\/script>
</body>
</html>`
}

// Inline plat server source: serves a single in-memory index.html via StaticFolder.
// We embed the HTML directly so it isn't wiped by the runtime's workspace-file sync.
function buildServerSource(html: string, serverName: string): string {
  return `import { serveClientSideServer } from '@modularizer/plat-client/client-server'
import { StaticFolder } from '@modularizer/plat-client/static'

const files = { 'index.html': ${JSON.stringify(html)} }

class SiteApi {
  root = new StaticFolder(files, { index: 'index.html' })
}

export default serveClientSideServer(${JSON.stringify(serverName)}, [SiteApi])
`
}

function deriveServerName(_command: string): string {
  // Always namespace/<sample-slug>. Namespace = user's first approved namespace
  // if signed in, else 'dmz'. The --name flag is intentionally not honored —
  // the preview server name is a function of the active project.
  const sampleId = useWorkspaceStore.getState().sample?.id ?? 'preview'
  // sampleId arrives as "<ns>/<slug>" — take only the slug portion so we can
  // re-prefix with the current user's namespace.
  const slug = (sampleId.includes('/') ? sampleId.slice(sampleId.lastIndexOf('/') + 1) : sampleId)
    .replace(/[^a-zA-Z0-9_-]/g, '-')
  return `${defaultNamespace()}/${slug}`
}

function defaultNamespace(): string {
  const user = useIdentityStore.getState().user
  if (!user) return 'dmz'
  const approved = useNamespaceStore.getState().namespaces
  const first = approved[0]?.namespace?.trim()
  return first && first.length > 0 ? first : 'dmz'
}

async function stopRuntime(): Promise<void> {
  if (!runtimeHandle) return
  const h = runtimeHandle
  runtimeHandle = null
  try { await h.stop() } catch (err) { console.warn('[scriptRunner] stop failed', err) }
}

function stopWatching(): void {
  if (watchUnsub) { watchUnsub(); watchUnsub = null }
  if (watchDebounce) { clearTimeout(watchDebounce); watchDebounce = null }
}

function filesFromWorkspace(): BundlerFile[] {
  return useWorkspaceStore.getState().files
    .filter((f) => typeof f.content === 'string')
    .map((f) => ({
      path: f.path.startsWith('/') ? f.path : '/' + f.path,
      contents: f.content as string,
    }))
}

/**
 * Strip the `/<sampleId>/` (possibly multi-segment) prefix from a workspace
 * path so it becomes project-relative (e.g. `server.ts`, `words.ts`).
 */
function toProjectRelative(workspacePath: string, projectId: string | undefined): string {
  const trimmed = workspacePath.replace(/^\/+/, '')
  if (projectId) {
    const normalized = projectId.replace(/^\/+|\/+$/g, '')
    if (normalized && (trimmed === normalized || trimmed.startsWith(`${normalized}/`))) {
      return trimmed.slice(normalized.length).replace(/^\/+/, '')
    }
  }
  const slash = trimmed.indexOf('/')
  return slash < 0 ? trimmed : trimmed.slice(slash + 1)
}

/**
 * Collect workspace server source: if a `server.ts` exists, build a Record
 * of server-side TS files keyed by project-relative path with server.ts
 * remapped to `index.ts` (the entry). Client-side .tsx files are skipped —
 * they've already been bundled into the built JS. Returns null if there's
 * no server.ts (caller falls back to the inline static-only shim).
 */
function collectServerSource(projectId: string | undefined): Record<string, string> | null {
  const files = useWorkspaceStore.getState().files
  const serverFile = files.find((f) => {
    const rel = toProjectRelative(f.path, projectId)
    return rel === 'server.ts'
  })
  if (!serverFile || typeof serverFile.content !== 'string') return null

  const out: Record<string, string> = {}
  for (const f of files) {
    if (typeof f.content !== 'string') continue
    const rel = toProjectRelative(f.path, projectId)
    if (!rel.endsWith('.ts') || rel.endsWith('.d.ts')) continue
    if (rel.endsWith('.tsx')) continue
    const key = rel === 'server.ts' ? 'index.ts' : rel
    out[key] = f.content
  }
  return out
}

function filesInOwnerPackage(files: BundlerFile[], ownerPath: string): BundlerFile[] {
  const packageDir = ownerPath.replace(/\/package\.json$/i, '')
  const packageJson = files.find((file) => file.path === ownerPath)
  const explicitEntry = packageJson ? getBrowserverEntryFromPackageJson(packageJson.contents, packageDir) : null
  if (explicitEntry) {
    const matching = files.find((file) => file.path === explicitEntry)
    if (matching) return [matching, ...files.filter((file) => file.path !== explicitEntry)]
  }

  if (!packageDir) return files
  const prefix = `${packageDir}/`
  return files
    .filter((file) => file.path.startsWith(prefix))
    .map((file) => ({ ...file, path: file.path.slice(packageDir.length) || '/' }))
}

function inferEntryFromCandidates(files: BundlerFile[]): string | null {
  const candidates = ['/index.tsx', '/index.ts', '/index.jsx', '/index.js', '/src/main.tsx', '/src/index.tsx', '/main.tsx']
  for (const c of candidates) if (files.some((f) => f.path === c)) return c
  return files.find((f) => f.path.endsWith('.tsx'))?.path ?? null
}

function getBrowserverEntryFromPackageJson(contents: string, packageDir: string): string | null {
  try {
    const parsed = JSON.parse(contents) as { browserver?: { entry?: unknown } }
    const entry = parsed?.browserver?.entry
    if (typeof entry !== 'string' || !entry.trim()) return null
    const normalized = entry.trim().replace(/^\.?\//, '')
    return `${packageDir}/${normalized.startsWith('/') ? normalized.slice(1) : normalized}`
  } catch {
    return null
  }
}

export function inferEntry(files: BundlerFile[], ownerPath?: string): string | null {
  const scopedFiles = ownerPath ? filesInOwnerPackage(files, ownerPath) : files
  const preferred = inferEntryFromCandidates(scopedFiles)
  if (preferred) return preferred

  if (scopedFiles !== files) {
    const fallback = inferEntryFromCandidates(files)
    if (fallback) return fallback
  }

  return null
}

export function classifyScript(command: string): ScriptKind {
  const c = command.trim()
  if (/\bvite\s+build\b/.test(c) || /\btsc\b/.test(c) || /\besbuild\b.*--bundle/.test(c)) return 'build'
  if (/^vite(\s|$)/.test(c) || /\bnext\s+dev\b/.test(c) || /\bvite\s+dev\b/.test(c) || /bundler\s+dev/.test(c)) return 'dev'
  if (/\bvite\s+preview\b/.test(c) || /\bnext\s+start\b/.test(c) || /\bserve\b/.test(c) || /bundler\s+start/.test(c)) return 'start'
  return 'unknown'
}

export function inferScriptKindByName(name: string): ScriptKind {
  if (name === 'build') return 'build'
  if (name === 'dev' || name === 'watch') return 'dev'
  if (name === 'start' || name === 'preview' || name === 'serve') return 'start'
  return 'unknown'
}

export const useScriptRunnerStore = create<ScriptRunnerState>((set, get) => ({
  phase: 'idle',
  scriptName: null,
  ownerPath: null,
  message: '',
  errors: [],
  serverName: null,
  viewerUrl: null,
  connectionUrl: null,
  devWatching: false,
  lastBuiltAt: null,
  durationMs: 0,
  serverLogs: [],

  appendServerLog: (level, text) => {
    set((state) => {
      const next = state.serverLogs.length >= MAX_SERVER_LOGS
        ? state.serverLogs.slice(state.serverLogs.length - MAX_SERVER_LOGS + 1)
        : state.serverLogs.slice()
      next.push({ ts: Date.now(), level, text })
      return { serverLogs: next }
    })
  },
  clearServerLogs: () => set({ serverLogs: [] }),

  stop: async () => {
    buildSeq++
    stopWatching()
    await stopRuntime()
    set({
      phase: 'idle',
      message: 'stopped',
      scriptName: null,
      ownerPath: null,
      serverName: null,
      viewerUrl: null,
      connectionUrl: null,
      devWatching: false,
    })
  },

  runScript: async (script, files, entry, ownerPath) => {
    const ownerPatch = ownerPath !== undefined ? { ownerPath } : {}
    console.debug('[scriptRunner] runScript called', { script, entry, ownerPath, phase: get().phase })
    if (script.kind === 'start') {
      if (runtimeHandle) {
        set({ ...ownerPatch, phase: 'ok', scriptName: script.name, message: 'serving last build', errors: [] })
      } else {
        set({ ...ownerPatch, phase: 'error', scriptName: script.name, errors: ['no prior build — run `dev` or `build` first'], message: '' })
      }
      return
    }
    if (script.kind === 'unknown') {
      set({
        ...ownerPatch,
        phase: 'error',
        scriptName: script.name,
        errors: [`"${script.command}" is not supported yet. Known: vite build/dev, vite preview, tsc, esbuild --bundle.`],
        message: '',
      })
      return
    }
    if (!entry) {
      set({ ...ownerPatch, phase: 'error', scriptName: script.name, errors: ['No entry file found (looked for /index.tsx, /src/main.tsx, etc.)'], message: '' })
      return
    }
    stopWatching()
    const seq = ++buildSeq
    const isFirst = !bundler
    set({
      ...ownerPatch,
      phase: isFirst ? 'initializing' : 'building',
      scriptName: script.name,
      message: isFirst ? 'downloading esbuild.wasm…' : 'compiling…',
      errors: [],
      devWatching: script.kind === 'dev',
    })
    const b = getBundler()
    if (isFirst) {
      queueMicrotask(() => {
        if (buildSeq === seq) set({ phase: 'building', message: 'compiling…' })
      })
    }
    const res = await b.build({
      files: [...platClientFiles, ...files],
      entry,
      format: 'iife',
      globalName: '__browserverPreview',
      importAliases: platClientAliases,
    })
    if (seq !== buildSeq) return
    if (!res.ok) {
      await stopRuntime()
      set({
        phase: 'error',
        scriptName: script.name,
        errors: res.errors.map((e) => e.text),
        message: '',
        serverName: null,
        viewerUrl: null,
        connectionUrl: null,
      })
      return
    }
    const js = res.outputs[0]?.contents ?? ''
    const serverNameForRun = runtimeHandle?.serverName ?? deriveServerName(script.command)
    const html = buildHtml(js, serverNameForRun, import.meta.env.VITE_SITE_VIEWER_ORIGIN ?? '')

    set({ phase: 'serving', message: runtimeHandle ? 'restarting preview server…' : 'starting preview server…' })
    const projectId = useWorkspaceStore.getState().sample?.id ?? 'preview'
    await stopRuntime()
    try {
      const serverSource = collectServerSource(projectId)
      console.debug('[scriptRunner] starting local runtime', { serverNameForRun, projectId, phase: get().phase })
      const handle = await startLocalTsRuntime({
        source: serverSource ?? buildServerSource(html, serverNameForRun),
        sourceEntryPoint: serverSource ? 'index.ts' : undefined,
        extraStaticFiles: serverSource ? { 'index.html': html } : undefined,
        serverName: serverNameForRun,
        projectId,
      })
      if (seq !== buildSeq) {
        await handle.stop()
        return
      }
      runtimeHandle = handle
      const viewerUrl = buildSiteViewerUrl(handle.serverName)
      set({
        ...ownerPatch,
        phase: 'ok',
        scriptName: script.name,
        serverName: handle.serverName,
        viewerUrl,
        connectionUrl: handle.connectionUrl,
        durationMs: Math.round(res.durationMs),
        lastBuiltAt: Date.now(),
        errors: [],
        message: `built in ${Math.round(res.durationMs)}ms`,
      })
      console.debug('[scriptRunner] runtime started', { serverName: handle.serverName, connectionUrl: handle.connectionUrl, phase: get().phase })

      if (script.kind === 'dev') {
        let lastFilesRef = useWorkspaceStore.getState().files
        watchUnsub = useWorkspaceStore.subscribe((state) => {
          if (state.files === lastFilesRef) return
          lastFilesRef = state.files
          if (watchDebounce) clearTimeout(watchDebounce)
          watchDebounce = setTimeout(() => {
            watchDebounce = null
            const nextFiles = filesFromWorkspace()
            const nextOwnerPath = get().ownerPath ?? ownerPath
            const nextEntry = inferEntry(nextFiles, nextOwnerPath ?? undefined)
            console.debug('[scriptRunner] dev watcher restart', { nextOwnerPath, nextEntry })
            void get().runScript(script, nextFiles, nextEntry, nextOwnerPath ?? undefined)
          }, 150)
        })
      }
    } catch (err: any) {
      if (seq !== buildSeq) return
      console.error(err)
      set({
        phase: 'error',
        scriptName: script.name,
        errors: [`preview server failed: ${String(err?.message ?? err)}`],
        message: '',
        serverName: null,
        viewerUrl: null,
        connectionUrl: null,
      })
    }
  },
}))
