import { useMemo } from 'react'

export type HtmlMode = 'code' | 'split' | 'preview'

export function HtmlToolbar({
  mode,
  onChangeMode,
}: {
  mode: HtmlMode
  onChangeMode: (mode: HtmlMode) => void
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

export function HtmlPreview({ content }: { content: string }) {
  const srcdoc = useMemo(() => content, [content])

  return (
    <div className="flex h-full flex-col">
      <iframe
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        title="HTML preview"
        className="h-full w-full border-none bg-white"
      />
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
