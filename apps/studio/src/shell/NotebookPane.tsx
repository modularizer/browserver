import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { formatPythonBrowserValue } from '@modularizer/plat-client/python-browser'
import * as monaco from 'monaco-editor'

export type NotebookMode = 'code' | 'split' | 'preview'

/* ---- Toolbar (same 3-mode pattern) ---- */

export function NotebookToolbar({
  mode,
  onChangeMode,
}: {
  mode: NotebookMode
  onChangeMode: (mode: NotebookMode) => void
}) {
  return (
    <div className="flex items-center gap-0.5">
      <ModeButton active={mode === 'code'} onClick={() => onChangeMode('code')} title="JSON source">
        <CodeIcon />
      </ModeButton>
      <ModeButton active={mode === 'split'} onClick={() => onChangeMode('split')} title="Split">
        <SplitIcon />
      </ModeButton>
      <ModeButton active={mode === 'preview'} onClick={() => onChangeMode('preview')} title="Notebook">
        <PreviewIcon />
      </ModeButton>
    </div>
  )
}

/* ---- Notebook preview ---- */

interface NotebookCell {
  cell_type: 'code' | 'markdown' | 'raw'
  source: string[] | string
  metadata?: Record<string, unknown>
  outputs?: NotebookOutput[]
  execution_count?: number | null
}

interface NotebookOutput {
  output_type: 'stream' | 'execute_result' | 'display_data' | 'error'
  text?: string[] | string
  data?: Record<string, string[] | string>
  name?: string
  ename?: string
  evalue?: string
  traceback?: string[]
  execution_count?: number | null
}

interface ParsedNotebook {
  cells: NotebookCell[]
  metadata?: Record<string, unknown>
  nbformat?: number
  nbformat_minor?: number
}

function parseNotebook(content: string): ParsedNotebook | null {
  try {
    const nb = JSON.parse(content)
    if (!nb.cells || !Array.isArray(nb.cells)) return null
    return nb as ParsedNotebook
  } catch {
    return null
  }
}

function joinSource(source: string[] | string): string {
  return Array.isArray(source) ? source.join('') : source
}

function joinText(text: string[] | string | undefined): string {
  if (!text) return ''
  return Array.isArray(text) ? text.join('') : text
}

function linesFromText(text: string): string[] {
  if (!text) return []
  return text.split(/(?<=\n)/)
}

function serializeNotebook(notebook: ParsedNotebook): string {
  return `${JSON.stringify(notebook, null, 2)}\n`
}

function updateNotebookCell(
  content: string,
  cellIndex: number,
  patch: Partial<NotebookCell>,
): string | null {
  const notebook = parseNotebook(content)
  if (!notebook) return null

  const currentCell = notebook.cells[cellIndex]
  if (!currentCell) return null

  notebook.cells[cellIndex] = {
    ...currentCell,
    ...patch,
  }

  return serializeNotebook(notebook)
}

/* ---- Pyodide kernel ---- */

interface PyodideHandle {
  runPythonAsync(code: string): Promise<unknown>
  loadPackage(packages: string | string[]): Promise<void>
  globals: { get(name: string): unknown; set(name: string, value: unknown): void }
}

let pyodidePromise: Promise<PyodideHandle> | null = null

async function getPyodide(): Promise<PyodideHandle> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const mod = await import(
        /* @vite-ignore */ 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.mjs'
      )
      const py = await mod.loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.5/full/',
      })
      return py as PyodideHandle
    })()
  }
  return pyodidePromise
}

interface CellRunState {
  status: 'idle' | 'running' | 'done' | 'error'
  outputs: NotebookOutput[]
  executionCount: number | null
}

export function NotebookPreview({
  content,
  onUpdateContent,
}: {
  content: string
  onUpdateContent?: (content: string) => void
}) {
  const nb = useMemo(() => parseNotebook(content), [content])
  const [cellStates, setCellStates] = useState<Map<number, CellRunState>>(new Map())
  const [kernelReady, setKernelReady] = useState(false)
  const [kernelLoading, setKernelLoading] = useState(false)
  const executionCountRef = useRef(0)
  const pyRef = useRef<PyodideHandle | null>(null)
  const [editingSources, setEditingSources] = useState<Map<number, string>>(new Map())

  useEffect(() => {
    setCellStates(new Map())
    setEditingSources(new Map())
    executionCountRef.current = 0
  }, [content])

  const bootKernel = useCallback(async () => {
    if (pyRef.current) return
    setKernelLoading(true)
    try {
      const py = await getPyodide()
      // Set up stdout/stderr capture
      await py.runPythonAsync(`
import sys
from io import StringIO
`)
      pyRef.current = py
      setKernelReady(true)
    } catch (err) {
      console.error('[notebook] failed to boot Pyodide', err)
    } finally {
      setKernelLoading(false)
    }
  }, [])

  useEffect(() => { void bootKernel() }, [bootKernel])

  const persistCell = useCallback((cellIndex: number, patch: Partial<NotebookCell>) => {
    if (!onUpdateContent) return

    const nextContent = updateNotebookCell(content, cellIndex, patch)
    if (nextContent) {
      onUpdateContent(nextContent)
    }
  }, [content, onUpdateContent])

  const setCellSource = useCallback((cellIndex: number, source: string) => {
    setEditingSources((prev) => {
      const next = new Map(prev)
      next.set(cellIndex, source)
      return next
    })

    persistCell(cellIndex, { source: linesFromText(source) })
  }, [persistCell])

  const runCell = useCallback(async (cellIndex: number, source: string) => {
    if (!pyRef.current) return

    const py = pyRef.current
    executionCountRef.current += 1
    const execCount = executionCountRef.current

    setCellStates((prev) => {
      const next = new Map(prev)
      next.set(cellIndex, { status: 'running', outputs: [], executionCount: execCount })
      return next
    })

    try {
      await py.runPythonAsync(`
__nb_stdout = StringIO()
__nb_stderr = StringIO()
sys.stdout = __nb_stdout
sys.stderr = __nb_stderr
`)

      let result: unknown
      try {
        result = await py.runPythonAsync(source)
      } finally {
        await py.runPythonAsync(`
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
`)
      }

      const stdout = String(await py.runPythonAsync('__nb_stdout.getvalue()') ?? '')
      const stderr = String(await py.runPythonAsync('__nb_stderr.getvalue()') ?? '')

      const outputs: NotebookOutput[] = []
      if (stdout) {
        outputs.push({ output_type: 'stream', name: 'stdout', text: stdout })
      }
      if (stderr) {
        outputs.push({ output_type: 'stream', name: 'stderr', text: stderr })
      }
      if (result !== undefined && result !== null) {
        const repr = String(result)
        const text = repr === '[object Object]' ? JSON.stringify(result, null, 2) : repr
        outputs.push({
          output_type: 'execute_result',
          data: { 'text/plain': text },
          execution_count: execCount,
        })
      }

      setCellStates((prev) => {
        const next = new Map(prev)
        next.set(cellIndex, { status: 'done', outputs, executionCount: execCount })
        return next
      })
      persistCell(cellIndex, {
        outputs,
        execution_count: execCount,
      })
    } catch (err: unknown) {
      const message = formatPythonBrowserValue(err)
      const outputs: NotebookOutput[] = [{
        output_type: 'error',
        ename: 'Error',
        evalue: message,
        traceback: [message],
      }]

      try {
        await py.runPythonAsync(`
sys.stdout = sys.__stdout__
sys.stderr = sys.__stderr__
`)
        const stdout = String(await py.runPythonAsync('__nb_stdout.getvalue()') ?? '')
        const stderr = String(await py.runPythonAsync('__nb_stderr.getvalue()') ?? '')
        if (stdout) {
          outputs.unshift({ output_type: 'stream', name: 'stdout', text: stdout })
        }
        if (stderr) {
          outputs.unshift({ output_type: 'stream', name: 'stderr', text: stderr })
        }
      } catch { /* ignore */ }

      setCellStates((prev) => {
        const next = new Map(prev)
        next.set(cellIndex, { status: 'error', outputs, executionCount: execCount })
        return next
      })
      persistCell(cellIndex, {
        outputs,
        execution_count: execCount,
      })
    }
  }, [persistCell])

  const runAll = useCallback(async () => {
    if (!nb) return
    for (let i = 0; i < nb.cells.length; i++) {
      const cell = nb.cells[i]!
      if (cell.cell_type !== 'code') continue
      const source = editingSources.get(i) ?? joinSource(cell.source)
      await runCell(i, source)
    }
  }, [nb, runCell, editingSources])

  const resetKernel = useCallback(async () => {
    pyodidePromise = null
    pyRef.current = null
    setKernelReady(false)
    setCellStates(new Map())
    executionCountRef.current = 0
    void bootKernel()
  }, [bootKernel])

  if (!nb) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-bs-text-faint">
        Not a valid .ipynb notebook
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-bs-bg-editor">
      <div className="flex h-[34px] flex-none items-center gap-2 border-b border-bs-border bg-bs-bg-panel px-3">
        <div className="rounded border border-bs-border bg-bs-bg-badge px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-bs-text-muted">
          Notebook
        </div>
        <div className={`h-2 w-2 rounded-full ${
          kernelLoading ? 'animate-pulse bg-bs-warn'
            : kernelReady ? 'bg-bs-good'
            : 'bg-bs-text-faint'
        }`} title={kernelReady ? 'Kernel ready' : kernelLoading ? 'Loading Pyodide...' : 'Kernel not started'} />
        <span className="text-[10px] text-bs-text-faint">
          {kernelLoading ? 'Booting Pyodide kernel' : kernelReady ? 'Python kernel ready' : 'Kernel idle'}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => void runAll()}
          disabled={!kernelReady}
          className="rounded border border-bs-good/30 bg-bs-good/10 px-2.5 py-1 text-[10px] font-medium text-bs-good transition hover:bg-bs-good/20 disabled:cursor-not-allowed disabled:opacity-40"
          title="Run all cells"
        >
          Run All
        </button>
        <button
          onClick={() => void resetKernel()}
          className="rounded border border-bs-border bg-bs-bg-hover px-2.5 py-1 text-[10px] text-bs-text-muted transition hover:bg-bs-bg-active hover:text-bs-text"
          title="Restart kernel"
        >
          Restart
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex flex-col gap-3 p-3">
          {nb.cells.map((cell, index) => {
            const state = cellStates.get(index)
            const source = editingSources.get(index) ?? joinSource(cell.source)
            const outputs = state?.outputs ?? cell.outputs ?? []
            const execCount = state?.executionCount ?? cell.execution_count

            if (cell.cell_type === 'markdown') {
              return (
                <MarkdownCellView
                  key={index}
                  source={source}
                />
              )
            }

            return (
              <CodeCellView
                key={index}
                source={source}
                outputs={outputs}
                executionCount={execCount ?? null}
                status={state?.status ?? 'idle'}
                kernelReady={kernelReady}
                onRun={() => void runCell(index, source)}
                onChangeSource={(newSource) => setCellSource(index, newSource)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ---- Cell views ---- */

function CodeCellView({
  source,
  outputs,
  executionCount,
  status,
  kernelReady,
  onRun,
  onChangeSource,
}: {
  source: string
  outputs: NotebookOutput[]
  executionCount: number | null
  status: 'idle' | 'running' | 'done' | 'error'
  kernelReady: boolean
  onRun: () => void
  onChangeSource: (source: string) => void
}) {
  return (
    <div className="group relative overflow-hidden rounded-lg border border-bs-border bg-bs-bg-sidebar">
      <div className="flex items-center gap-2 border-b border-bs-border bg-bs-bg-panel px-3 py-2">
        <div className="rounded border border-bs-border bg-bs-bg-badge px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-bs-text-faint">
          Code
        </div>
        <span className={`font-mono text-[10px] ${status === 'running' ? 'text-bs-warn' : 'text-bs-text-faint'}`}>
          In [{executionCount ?? ' '}]
        </span>
        <div className="flex-1" />
        <span className={`text-[10px] ${
          status === 'error' ? 'text-bs-error'
            : status === 'done' ? 'text-bs-good'
            : status === 'running' ? 'text-bs-warn'
            : 'text-bs-text-faint'
        }`}>
          {status === 'idle' ? 'Ready' : status === 'running' ? 'Running...' : status === 'done' ? 'Complete' : 'Failed'}
        </span>
        <button
          onClick={onRun}
          disabled={!kernelReady || status === 'running'}
          className="inline-flex items-center gap-1 rounded border border-bs-good/30 bg-bs-good/10 px-2 py-1 text-[10px] font-medium text-bs-good transition hover:bg-bs-good/20 disabled:cursor-not-allowed disabled:opacity-30"
          title="Run cell (Shift+Enter)"
        >
          {status === 'running' ? (
            <span className="h-2.5 w-2.5 animate-spin rounded-full border border-bs-good border-t-transparent" />
          ) : (
            <RunIcon />
          )}
          Run
        </button>
      </div>
      <div className="flex">
        <div className="flex w-[58px] flex-none flex-col items-center border-r border-bs-border bg-bs-bg-panel px-2 py-3">
          <span className="text-[9px] uppercase tracking-[0.18em] text-bs-text-faint">Cell</span>
          <span className="mt-1 font-mono text-[11px] text-bs-text-muted">
            {executionCount ?? '-'}
          </span>
        </div>
        <div className="min-w-0 flex-1 px-3 py-3">
          <NotebookCodeEditor
            value={source}
            onChange={onChangeSource}
            onRun={onRun}
          />
        </div>
      </div>

      {outputs.length > 0 ? (
        <div className="border-t border-bs-border bg-bs-bg-panel px-3 py-3">
          <div className="mb-2 flex items-center gap-2 pl-[58px]">
            <div className="rounded border border-bs-border bg-bs-bg-badge px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-bs-text-faint">
              Output
            </div>
            <span className="text-[10px] text-bs-text-faint">
              Rendered directly below this cell
            </span>
          </div>
          <div className="space-y-2 pl-[58px]">
            {outputs.map((output, i) => (
              <OutputView key={i} output={output} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function NotebookCodeEditor({
  value,
  onChange,
  onRun,
}: {
  value: string
  onChange: (value: string) => void
  onRun: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const syncingRef = useRef(false)
  const [height, setHeight] = useState(72)

  useEffect(() => {
    const container = containerRef.current
    if (!container || editorRef.current) return

    const model = monaco.editor.createModel(value, 'python')
    modelRef.current = model

    const editor = monaco.editor.create(container, {
      model,
      language: 'python',
      theme: 'browserver',
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: 'off',
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 0,
      overviewRulerLanes: 0,
      scrollbar: {
        vertical: 'hidden',
        horizontal: 'auto',
        alwaysConsumeMouseWheel: false,
      },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      guides: { indentation: false },
      fontSize: 12,
      wordWrap: 'off',
      padding: { top: 10, bottom: 10 },
    })
    editorRef.current = editor

    const updateHeight = () => {
      const contentHeight = Math.max(56, editor.getContentHeight())
      setHeight(contentHeight)
      editor.layout({ width: container.clientWidth, height: contentHeight })
    }

    updateHeight()

    const contentSizeDisposable = editor.onDidContentSizeChange(updateHeight)
    const changeDisposable = editor.onDidChangeModelContent(() => {
      if (syncingRef.current) return
      onChange(editor.getValue())
    })

    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => onRun())
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRun())

    return () => {
      contentSizeDisposable.dispose()
      changeDisposable.dispose()
      editor.dispose()
      model.dispose()
      editorRef.current = null
      modelRef.current = null
    }
  }, [onChange, onRun, value])

  useEffect(() => {
    const editor = editorRef.current
    const model = modelRef.current
    if (!editor || !model) return
    if (model.getValue() === value) return

    syncingRef.current = true
    model.pushEditOperations(
      [],
      [{ range: model.getFullModelRange(), text: value }],
      () => null,
    )
    syncingRef.current = false
  }, [value])

  return (
    <div className="overflow-hidden rounded-md border border-bs-border bg-bs-bg-editor">
      <div ref={containerRef} style={{ height }} />
    </div>
  )
}

function MarkdownCellView({ source }: { source: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-bs-border bg-bs-bg-sidebar">
      <div className="border-b border-bs-border bg-bs-bg-panel px-3 py-2">
        <div className="inline-flex rounded border border-bs-border bg-bs-bg-badge px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.18em] text-bs-text-faint">
          Markdown
        </div>
      </div>
      <div className="px-5 py-4 text-[13px] leading-relaxed text-bs-text">
        <SimpleMarkdown source={source} />
      </div>
    </div>
  )
}

/* ---- Output rendering ---- */

function OutputView({ output }: { output: NotebookOutput }) {
  if (output.output_type === 'stream') {
    const text = joinText(output.text)
    const isErr = output.name === 'stderr'
    return (
      <pre className={`rounded-md border px-3 py-2 whitespace-pre-wrap font-mono text-[11px] ${
        isErr
          ? 'border-bs-error/30 bg-bs-error/10 text-bs-error'
          : 'border-bs-border bg-bs-bg-sidebar text-bs-text-muted'
      }`}>
        {text}
      </pre>
    )
  }

  if (output.output_type === 'error') {
    return (
      <div className="rounded-md border border-bs-error/30 bg-bs-error/10 px-3 py-2 font-mono text-[11px]">
        <div className="font-bold text-bs-error">{output.ename}: {output.evalue}</div>
        {output.traceback?.map((line, i) => (
          <pre key={i} className="whitespace-pre-wrap text-bs-error/80">{stripAnsi(line)}</pre>
        ))}
      </div>
    )
  }

  if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
    const data = output.data ?? {}

    // Image output
    const png = joinText(data['image/png'])
    if (png) {
      return <img src={`data:image/png;base64,${png}`} alt="output" className="max-w-full rounded-md border border-bs-border bg-white p-2" />
    }
    const svg = joinText(data['image/svg+xml'])
    if (svg) {
      return <div dangerouslySetInnerHTML={{ __html: svg }} className="max-w-full rounded-md border border-bs-border bg-white p-2" />
    }

    const html = joinText(data['text/html'])
    if (html) {
      return <div dangerouslySetInnerHTML={{ __html: html }} className="rounded-md border border-bs-border bg-bs-bg-sidebar px-3 py-2 text-[12px] text-bs-text" />
    }

    const plain = joinText(data['text/plain'])
    if (plain) {
      return <pre className="rounded-md border border-bs-border bg-bs-bg-sidebar px-3 py-2 whitespace-pre-wrap font-mono text-[11px] text-bs-text-muted">{plain}</pre>
    }
  }

  return null
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

/* ---- Simple inline markdown for markdown cells ---- */

function SimpleMarkdown({ source }: { source: string }) {
  const lines = source.split('\n')
  const elements: ReactNode[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/)
    if (headingMatch) {
      const level = headingMatch[1]!.length
      const sizes = ['text-xl font-bold', 'text-lg font-bold', 'text-base font-semibold', 'text-sm font-semibold', 'text-sm font-medium', 'text-sm']
      elements.push(
        <div key={i} className={`${sizes[level - 1] ?? sizes[5]} mt-3 mb-1 text-bs-text`}>
          {headingMatch[2]}
        </div>,
      )
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-2" />)
    } else {
      elements.push(<div key={i}>{line}</div>)
    }
  }

  return <>{elements}</>
}

/* ---- Shared icon components ---- */

function ModeButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: ReactNode
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

function RunIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
      <polygon points="1,0 10,5 1,10" />
    </svg>
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
