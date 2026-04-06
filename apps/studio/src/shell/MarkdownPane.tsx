import { useCallback, useEffect, useMemo, useRef } from 'react'
import type * as monaco from 'monaco-editor'

export type MdMode = 'code' | 'split' | 'preview'

export function MarkdownToolbar({
  mode,
  onChangeMode,
}: {
  mode: MdMode
  onChangeMode: (mode: MdMode) => void
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

export function MarkdownPreview({
  content,
  editor,
}: {
  content: string
  editor: monaco.editor.IStandaloneCodeEditor | null
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)
  const { html, headingLines } = useMemo(() => renderMarkdown(content), [content])

  // Monaco scroll → preview scroll (by heading section)
  useEffect(() => {
    if (!editor) return

    const disposable = editor.onDidScrollChange(() => {
      if (syncingRef.current) return
      const scrollEl = scrollRef.current
      if (!scrollEl || headingLines.length === 0) return

      // Find which source line is at the top of the Monaco viewport
      const topLine = editor.getVisibleRanges()[0]?.startLineNumber ?? 1

      // Find the heading section we're in: last heading whose line <= topLine
      let headingIdx = -1
      for (let h = headingLines.length - 1; h >= 0; h--) {
        if (headingLines[h]! <= topLine) {
          headingIdx = h
          break
        }
      }

      // Compute fractional progress between this heading and the next
      const sectionStart = headingIdx >= 0 ? headingLines[headingIdx]! : 1
      const sectionEnd = headingIdx + 1 < headingLines.length
        ? headingLines[headingIdx + 1]!
        : editor.getModel()?.getLineCount() ?? sectionStart
      const sectionSpan = Math.max(1, sectionEnd - sectionStart)
      const fraction = Math.min(1, Math.max(0, (topLine - sectionStart) / sectionSpan))

      // Find corresponding heading elements in the preview
      const headingEls = scrollEl.querySelectorAll<HTMLElement>('[data-source-line]')
      const elIdx = Math.max(0, headingIdx)
      const currentEl = headingEls[elIdx]
      const nextEl = headingEls[elIdx + 1]

      if (!currentEl) return

      const currentTop = currentEl.offsetTop
      const nextTop = nextEl ? nextEl.offsetTop : scrollEl.scrollHeight
      const targetScroll = currentTop + (nextTop - currentTop) * fraction

      syncingRef.current = true
      scrollEl.scrollTop = targetScroll
      requestAnimationFrame(() => { syncingRef.current = false })
    })

    return () => disposable.dispose()
  }, [editor, headingLines])

  // Preview scroll → Monaco scroll (by heading section)
  const onPreviewScroll = useCallback(() => {
    if (syncingRef.current || !editor) return
    const scrollEl = scrollRef.current
    if (!scrollEl || headingLines.length === 0) return

    const scrollTop = scrollEl.scrollTop
    const headingEls = scrollEl.querySelectorAll<HTMLElement>('[data-source-line]')
    if (headingEls.length === 0) return

    // Find which heading element we're past
    let elIdx = -1
    for (let h = headingEls.length - 1; h >= 0; h--) {
      if (headingEls[h]!.offsetTop <= scrollTop + 4) {
        elIdx = h
        break
      }
    }

    const currentEl = headingEls[Math.max(0, elIdx)]
    const nextEl = headingEls[Math.max(0, elIdx) + 1]
    if (!currentEl) return

    const currentTop = currentEl.offsetTop
    const nextTop = nextEl ? nextEl.offsetTop : scrollEl.scrollHeight
    const elSpan = Math.max(1, nextTop - currentTop)
    const fraction = Math.min(1, Math.max(0, (scrollTop - currentTop) / elSpan))

    const headingLineIdx = Math.max(0, elIdx)
    const sectionStart = headingLines[headingLineIdx] ?? 1
    const sectionEnd = headingLineIdx + 1 < headingLines.length
      ? headingLines[headingLineIdx + 1]!
      : editor.getModel()?.getLineCount() ?? sectionStart
    const sectionSpan = Math.max(1, sectionEnd - sectionStart)
    const targetLine = sectionStart + sectionSpan * fraction

    syncingRef.current = true
    editor.setScrollTop(editor.getTopForLineNumber(Math.round(targetLine)))
    requestAnimationFrame(() => { syncingRef.current = false })
  }, [editor, headingLines])

  return (
    <div ref={scrollRef} className="h-full overflow-auto" onScroll={onPreviewScroll}>
      <div
        className="bs-markdown p-4 text-[13px] leading-relaxed text-bs-text"
        dangerouslySetInnerHTML={{ __html: html }}
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

/* ---- Minimal markdown to HTML ---- */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderInline(text: string): string {
  let out = escapeHtml(text)
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" class="max-w-full" />')
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-bs-accent hover:underline">$1</a>')
  out = out.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/\*(.+?)\*/g, '<em>$1</em>')
  out = out.replace(/`([^`]+)`/g, '<code class="rounded bg-bs-bg-input px-1 py-0.5 text-[12px]">$1</code>')
  return out
}

function renderMarkdown(source: string): { html: string; headingLines: number[] } {
  const lines = source.split('\n')
  const html: string[] = []
  const headingLines: number[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    const sourceLine = i + 1 // 1-based to match Monaco

    // fenced code block
    const fenceMatch = line.match(/^```(\w*)/)
    if (fenceMatch) {
      const lang = fenceMatch[1] || ''
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        codeLines.push(lines[i]!)
        i++
      }
      i++ // skip closing ```
      html.push(
        `<pre class="my-2 overflow-auto rounded border border-bs-border bg-bs-bg-sidebar p-3 text-[12px] leading-snug"><code${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`,
      )
      continue
    }

    // blank line
    if (line.trim() === '') {
      i++
      continue
    }

    // headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/)
    if (headingMatch) {
      const level = headingMatch[1]!.length
      const sizes = ['text-2xl font-bold', 'text-xl font-bold', 'text-lg font-semibold', 'text-base font-semibold', 'text-sm font-semibold', 'text-sm font-medium']
      const cls = sizes[level - 1] ?? sizes[5]
      const spacing = level <= 2 ? 'mt-6 mb-2' : 'mt-4 mb-1'
      headingLines.push(sourceLine)
      html.push(`<div data-source-line="${sourceLine}" class="${spacing} ${cls} text-bs-text">${renderInline(headingMatch[2]!)}</div>`)
      i++
      continue
    }

    // horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      html.push('<hr class="my-4 border-bs-border" />')
      i++
      continue
    }

    // blockquote
    if (line.startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i]!.startsWith('>')) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ''))
        i++
      }
      html.push(
        `<blockquote class="my-2 border-l-2 border-bs-accent pl-3 text-bs-text-muted">${quoteLines.map(renderInline).join('<br/>')}</blockquote>`,
      )
      continue
    }

    // unordered list
    if (/^[\-*+]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[\-*+]\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^[\-*+]\s/, ''))
        i++
      }
      html.push(
        `<ul class="my-2 ml-4 list-disc space-y-0.5">${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`,
      )
      continue
    }

    // ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\d+\.\s/, ''))
        i++
      }
      html.push(
        `<ol class="my-2 ml-4 list-decimal space-y-0.5">${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ol>`,
      )
      continue
    }

    // paragraph
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.match(/^#{1,6}\s/) &&
      !lines[i]!.match(/^```/) &&
      !lines[i]!.match(/^[-*_]{3,}\s*$/) &&
      !lines[i]!.startsWith('>') &&
      !/^[\-*+]\s/.test(lines[i]!) &&
      !/^\d+\.\s/.test(lines[i]!)
    ) {
      paraLines.push(lines[i]!)
      i++
    }
    if (paraLines.length > 0) {
      html.push(`<p class="my-2">${paraLines.map(renderInline).join(' ')}</p>`)
    }
  }

  return { html: html.join('\n'), headingLines }
}
