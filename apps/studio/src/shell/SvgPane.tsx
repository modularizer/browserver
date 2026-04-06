import { useMemo, useRef, useState } from 'react'

export type SvgMode = 'code' | 'split' | 'preview'

export function SvgToolbar({
  mode,
  onChangeMode,
}: {
  mode: SvgMode
  onChangeMode: (mode: SvgMode) => void
}) {
  return (
    <div className="flex items-center gap-0.5">
      <ModeButton active={mode === 'code'} onClick={() => onChangeMode('code')} title="Source">
        <CodeIcon />
      </ModeButton>
      <ModeButton active={mode === 'split'} onClick={() => onChangeMode('split')} title="Split">
        <SplitIcon />
      </ModeButton>
      <ModeButton active={mode === 'preview'} onClick={() => onChangeMode('preview')} title="Preview">
        <PreviewIcon />
      </ModeButton>
    </div>
  )
}

export function SvgPreview({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)

  // Sanitize: only allow content that looks like an SVG
  const safeSvg = useMemo(() => {
    const trimmed = content.trim()
    if (!trimmed.startsWith('<svg') && !trimmed.startsWith('<?xml')) return null
    return trimmed
  }, [content])

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[26px] flex-none items-center justify-center gap-1 border-b border-bs-border bg-bs-bg-panel px-2">
        <button
          onClick={() => setZoom((z) => Math.max(0.125, z / 2))}
          className="flex h-[18px] w-[18px] items-center justify-center rounded text-[11px] text-bs-text-faint hover:bg-bs-bg-hover hover:text-bs-text-muted"
          title="Zoom out"
        >
          -
        </button>
        <button
          onClick={() => setZoom(1)}
          className="rounded px-1.5 text-[10px] text-bs-text-faint hover:bg-bs-bg-hover hover:text-bs-text-muted"
          title="Reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          onClick={() => setZoom((z) => Math.min(16, z * 2))}
          className="flex h-[18px] w-[18px] items-center justify-center rounded text-[11px] text-bs-text-faint hover:bg-bs-bg-hover hover:text-bs-text-muted"
          title="Zoom in"
        >
          +
        </button>
      </div>
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[linear-gradient(45deg,var(--bs-bg-panel)_25%,transparent_25%,transparent_75%,var(--bs-bg-panel)_75%,var(--bs-bg-panel)),linear-gradient(45deg,var(--bs-bg-panel)_25%,transparent_25%,transparent_75%,var(--bs-bg-panel)_75%,var(--bs-bg-panel))] bg-[length:24px_24px] bg-[position:0_0,12px_12px] p-6"
      >
        {safeSvg ? (
          <div
            style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
            className="bs-svg-preview"
            dangerouslySetInnerHTML={{ __html: safeSvg }}
          />
        ) : (
          <div className="text-sm text-bs-text-faint">
            Not a valid SVG document
          </div>
        )}
      </div>
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-[22px] w-[22px] items-center justify-center rounded text-[11px] ${
        active
          ? 'bg-bs-bg-active text-bs-text'
          : 'text-bs-text-faint hover:bg-bs-bg-hover hover:text-bs-text-muted'
      }`}
    >
      {children}
    </button>
  )
}

function CodeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5,3 1,8 5,13" />
      <polyline points="11,3 15,8 11,13" />
    </svg>
  )
}

function SplitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="14" height="12" rx="1" />
      <line x1="8" y1="2" x2="8" y2="14" />
    </svg>
  )
}

function PreviewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 4 L8 1 L15 4 L8 7 Z" />
      <path d="M1 4 V11 L8 14 L15 11 V4" />
      <line x1="8" y1="7" x2="8" y2="14" />
    </svg>
  )
}
