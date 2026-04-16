import { useScriptRunnerStore } from '../store/scriptRunner'

export function BuildPanel() {
  const phase = useScriptRunnerStore((s) => s.phase)
  const scriptName = useScriptRunnerStore((s) => s.scriptName)
  const message = useScriptRunnerStore((s) => s.message)
  const errors = useScriptRunnerStore((s) => s.errors)
  const viewerUrl = useScriptRunnerStore((s) => s.viewerUrl)
  const serverName = useScriptRunnerStore((s) => s.serverName)
  const devWatching = useScriptRunnerStore((s) => s.devWatching)
  const durationMs = useScriptRunnerStore((s) => s.durationMs)
  const stop = useScriptRunnerStore((s) => s.stop)

  const running = phase === 'ok' || phase === 'serving'

  return (
    <div className="flex h-full min-h-[280px] flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <PhasePill phase={phase} />
        {scriptName && <span className="text-bs-text">npm run {scriptName}</span>}
        {devWatching && <span className="text-bs-text-faint">• watching</span>}
        {phase === 'ok' && <span className="text-bs-text-faint">• {durationMs}ms</span>}
        {serverName && <span className="text-bs-text-faint">• css://{serverName}</span>}
        <div className="flex-1" />
        {message && phase !== 'error' && <span className="text-bs-text-faint">{message}</span>}
        {viewerUrl && (
          <a
            href={viewerUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-0.5 text-bs-text hover:bg-bs-bg-hover"
            title="Open preview in a new tab"
          >
            Open ↗
          </a>
        )}
        {running && (
          <button
            onClick={() => { void stop() }}
            className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-0.5 text-bs-text hover:bg-bs-bg-hover"
          >
            Stop
          </button>
        )}
      </div>
      {phase === 'error' && (
        <pre className="max-h-32 overflow-auto rounded border border-bs-border bg-bs-bg-sidebar p-2 text-[11px] text-bs-error whitespace-pre-wrap">
          {errors.join('\n')}
        </pre>
      )}
      <div className="relative flex-1 min-h-0 rounded border border-bs-border bg-bs-bg-sidebar overflow-hidden">
        {viewerUrl ? (
          <iframe
            src={viewerUrl}
            title="preview"
            className="h-full w-full border-0 bg-[#0b1020]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-bs-text-faint">
            {phase === 'idle'
              ? 'open package.json and click ▶ to run a script'
              : phase === 'initializing'
                ? 'initializing bundler…'
                : phase === 'building'
                  ? 'building…'
                  : phase === 'serving'
                    ? 'starting server…'
                    : 'no preview'}
          </div>
        )}
        {(phase === 'initializing' || phase === 'building' || phase === 'serving') && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="flex items-center gap-2 rounded border border-bs-border bg-bs-bg-panel px-3 py-2 text-bs-text shadow-lg">
              <Spinner />
              <span>
                {phase === 'initializing' ? 'initializing…' : phase === 'building' ? 'compiling…' : 'starting server…'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PhasePill({ phase }: { phase: string }) {
  const label =
    phase === 'idle' ? 'idle'
    : phase === 'initializing' ? 'init'
    : phase === 'building' ? 'build'
    : phase === 'serving' ? 'serve'
    : phase === 'ok' ? 'ok'
    : 'error'
  const cls =
    phase === 'ok'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      : phase === 'error'
        ? 'bg-red-500/20 text-red-300 border-red-500/40'
        : phase === 'building' || phase === 'initializing' || phase === 'serving'
          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
          : 'border-bs-border text-bs-text-faint'
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}>{label}</span>
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
