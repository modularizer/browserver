import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useScriptRunnerStore, type ServerLogEntry, type ServerLogLevel } from '../store/scriptRunner'

type BuildTab = 'logs' | 'preview'

export function BuildPanel() {
  const phase = useScriptRunnerStore((s) => s.phase)
  const scriptName = useScriptRunnerStore((s) => s.scriptName)
  const message = useScriptRunnerStore((s) => s.message)
  const errors = useScriptRunnerStore((s) => s.errors)
  const viewerUrl = useScriptRunnerStore((s) => s.viewerUrl)
  const serverName = useScriptRunnerStore((s) => s.serverName)
  const devWatching = useScriptRunnerStore((s) => s.devWatching)
  const durationMs = useScriptRunnerStore((s) => s.durationMs)
  const serverLogs = useScriptRunnerStore((s) => s.serverLogs)
  const clearServerLogs = useScriptRunnerStore((s) => s.clearServerLogs)
  const stop = useScriptRunnerStore((s) => s.stop)

  const running = phase === 'ok' || phase === 'serving'
  const [tab, setTab] = useState<BuildTab>('logs')

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
        <TabButton active={tab === 'logs'} onClick={() => setTab('logs')}>
          Logs {serverLogs.length > 0 && <span className="ml-1 text-bs-text-faint">({serverLogs.length})</span>}
        </TabButton>
        <TabButton active={tab === 'preview'} onClick={() => setTab('preview')} disabled={!viewerUrl}>
          Preview
        </TabButton>
        {tab === 'logs' && serverLogs.length > 0 && (
          <button
            onClick={() => clearServerLogs()}
            className="rounded border border-bs-border bg-bs-bg-sidebar px-2 py-0.5 text-bs-text hover:bg-bs-bg-hover"
          >
            Clear
          </button>
        )}
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
        {tab === 'logs' ? (
          <LogsView entries={serverLogs} phase={phase} />
        ) : viewerUrl ? (
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

function TabButton({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={[
        'rounded border px-2 py-0.5',
        disabled ? 'cursor-not-allowed border-bs-border text-bs-text-faint opacity-50' : '',
        active
          ? 'border-bs-border bg-bs-bg-panel text-bs-text'
          : 'border-bs-border bg-bs-bg-sidebar text-bs-text-faint hover:bg-bs-bg-hover',
      ].filter(Boolean).join(' ')}
    >
      {children}
    </button>
  )
}

function LogsView({ entries, phase }: { entries: ServerLogEntry[]; phase: string }) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [stickToBottom, setStickToBottom] = useState(true)

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    setStickToBottom(atBottom)
  }

  useLayoutEffect(() => {
    if (!stickToBottom) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries.length, stickToBottom])

  useEffect(() => {
    // Re-stick on run restart
    setStickToBottom(true)
  }, [phase])

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-bs-text-faint">
        {phase === 'idle' ? 'no server logs yet' : 'waiting for server output…'}
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="h-full overflow-auto p-2 font-mono text-[11px] leading-relaxed"
    >
      {entries.map((entry, i) => (
        <LogRow key={i} entry={entry} />
      ))}
    </div>
  )
}

const levelClasses: Record<ServerLogLevel, string> = {
  log: 'text-bs-text',
  info: 'text-sky-300',
  debug: 'text-bs-text-faint',
  warn: 'text-amber-300',
  error: 'text-red-300',
}

function LogRow({ entry }: { entry: ServerLogEntry }) {
  const time = new Date(entry.ts).toLocaleTimeString(undefined, { hour12: false })
  return (
    <div className="whitespace-pre-wrap break-all">
      <span className="text-bs-text-faint">{time} </span>
      <span className={`uppercase tracking-wider mr-2 ${levelClasses[entry.level]}`}>{entry.level}</span>
      <span className={levelClasses[entry.level]}>{entry.text}</span>
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
