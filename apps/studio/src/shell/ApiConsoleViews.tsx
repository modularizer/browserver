import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import ts from 'typescript'
import { connectBrowserverClientSideServer } from '../runtime/cssTransport'
import { useRuntimeStore } from '../store/runtime'
import type { RuntimeOperation } from '../runtime/types'

const tsLanguage = (monaco.languages as typeof monaco.languages & {
  typescript: {
    typescriptDefaults: {
      setCompilerOptions: (options: Record<string, unknown>) => void
      addExtraLib: (content: string, filePath?: string) => { dispose: () => void }
      getExtraLibs: () => Record<string, { content: string }>
    }
    ScriptTarget: Record<string, number>
    ModuleKind: Record<string, number>
  }
}).typescript

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Generate TypeScript type declarations from OpenAPI operations. */
function generateClientTypeDefs(operations: RuntimeOperation[], openapi: Record<string, any> | null): string {
  const methodSigs = operations.map((op) => {
    const inputType = schemaToTsType(op.inputSchema)
    const outputType = inferOutputType(openapi, op)
    return `  ${sanitizeIdentifier(op.label)}(input${inputType === '{}' ? '?' : ''}: ${inputType}): Promise<${outputType}>;`
  })

  return [
    '/** Auto-generated client proxy for the connected server. */',
    'declare const client: {',
    ...methodSigs,
    '};',
    '',
    '/** The raw OpenAPI document from the connected server. */',
    'declare const openapi: Record<string, any>;',
    '',
    'declare const console: { log(...args: any[]): void; info(...args: any[]): void; warn(...args: any[]): void; error(...args: any[]): void };',
  ].join('\n')
}

function sanitizeIdentifier(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_$]/g, '_')
  return /^[0-9]/.test(clean) ? `_${clean}` : clean
}

function schemaToTsType(schema: Record<string, unknown> | undefined): string {
  if (!schema) return '{}'
  const props = schema.properties as Record<string, any> | undefined
  if (!props || Object.keys(props).length === 0) return '{}'
  const required = new Set(Array.isArray(schema.required) ? schema.required as string[] : [])
  const fields = Object.entries(props).map(([key, prop]) => {
    const opt = required.has(key) ? '' : '?'
    return `${key}${opt}: ${primitiveType(prop)}`
  })
  return `{ ${fields.join('; ')} }`
}

function primitiveType(prop: any): string {
  if (!prop) return 'any'
  const t = prop.type
  if (t === 'string') return 'string'
  if (t === 'number' || t === 'integer') return 'number'
  if (t === 'boolean') return 'boolean'
  if (t === 'array') return `${primitiveType(prop.items)}[]`
  if (t === 'object') return schemaToTsType(prop)
  return 'any'
}

function inferOutputType(openapi: Record<string, any> | null, op: RuntimeOperation): string {
  if (!openapi?.paths) return 'any'
  const pathItem = openapi.paths[op.path]
  if (!pathItem) return 'any'
  const methodObj = pathItem[op.method.toLowerCase()]
  if (!methodObj?.responses) return 'any'
  const ok = methodObj.responses['200'] ?? methodObj.responses['201'] ?? methodObj.responses.default
  const schema = ok?.content?.['application/json']?.schema
  if (!schema) return 'any'
  return primitiveType(schema)
}

/** Generate Python type stubs from OpenAPI operations. */
function generatePythonStub(operations: RuntimeOperation[]): string {
  const methods = operations.map((op) => {
    const params = buildPythonParams(op.inputSchema)
    return `    def ${sanitizeIdentifier(op.label)}(self${params}) -> Any: ...`
  })

  return [
    '# Auto-generated client proxy for the connected server.',
    'from typing import Any',
    '',
    'class ClientProxy:',
    ...methods.length > 0 ? methods : ['    pass'],
    '',
    'client: ClientProxy',
    'openapi: dict',
    '',
    'def print(*args: Any) -> None: ...',
  ].join('\n')
}

function buildPythonParams(schema: Record<string, unknown> | undefined): string {
  if (!schema) return ''
  const props = schema.properties as Record<string, any> | undefined
  if (!props || Object.keys(props).length === 0) return ''
  const required = new Set(Array.isArray(schema.required) ? schema.required as string[] : [])
  const params = Object.entries(props).map(([key, prop]) => {
    const pyType = pythonType(prop)
    return required.has(key) ? `, ${key}: ${pyType}` : `, ${key}: ${pyType} = None`
  })
  return params.join('')
}

function pythonType(prop: any): string {
  if (!prop) return 'Any'
  const t = prop.type
  if (t === 'string') return 'str'
  if (t === 'number' || t === 'integer') return 'int | float'
  if (t === 'boolean') return 'bool'
  if (t === 'array') return 'list'
  if (t === 'object') return 'dict'
  return 'Any'
}

// ---------------------------------------------------------------------------
// Console output
// ---------------------------------------------------------------------------

function ConsoleOutput({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [lines])

  return (
    <div
      ref={ref}
      className="flex-1 min-h-0 overflow-auto bg-bs-bg-editor p-2 font-mono text-[11px] text-bs-text-muted"
    >
      {lines.length > 0 ? (
        lines.map((line, i) => (
          <div key={i} className={line.startsWith('[error]') ? 'text-bs-error' : ''}>{line}</div>
        ))
      ) : (
        <div className="text-bs-text-faint italic">Output will appear here...</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TS Console
// ---------------------------------------------------------------------------

function generateTsDemo(operations: RuntimeOperation[]): string {
  const header = '// TypeScript Console — `client` and `openapi` are pre-loaded.\n// Hit Cmd+Enter or click Run to execute.\n\n'
  if (operations.length === 0) return header + '// Connect to a server to see a demo here.\n'
  const op = operations[0]
  const args = buildDemoArgs(op.inputSchema)
  return header + `const result = await client.${sanitizeIdentifier(op.label)}(${args});\nconsole.log(result);\n`
}

function buildDemoArgs(schema: Record<string, unknown> | undefined): string {
  if (!schema) return '{}'
  const props = schema.properties as Record<string, any> | undefined
  if (!props || Object.keys(props).length === 0) return '{}'
  const fields = Object.entries(props).map(([key, prop]) => {
    const val = prop.type === 'string' ? '"example"' : prop.type === 'number' || prop.type === 'integer' ? '0' : prop.type === 'boolean' ? 'true' : '""'
    return `${key}: ${val}`
  })
  return `{ ${fields.join(', ')} }`
}

function generatePyDemo(operations: RuntimeOperation[]): string {
  const header = '# Python Console — `client` is auto-connected to the current target.\n# Hit Cmd+Enter or click Run to execute.\n\n'
  if (operations.length === 0) return header + '# Connect to a server to see a demo here.\n'
  const op = operations[0]
  const args = buildPyDemoArgs(op.inputSchema)
  return header + `result = await client.${sanitizeIdentifier(op.label)}(${args})\nresult\n`
}

function buildPyDemoArgs(schema: Record<string, unknown> | undefined): string {
  if (!schema) return ''
  const props = schema.properties as Record<string, any> | undefined
  if (!props || Object.keys(props).length === 0) return ''
  const fields = Object.entries(props).map(([key, prop]) => {
    const val = prop.type === 'string' ? '"example"' : prop.type === 'number' || prop.type === 'integer' ? '0' : prop.type === 'boolean' ? 'True' : '""'
    return `${key}=${val}`
  })
  return fields.join(', ')
}

export function TsConsoleView() {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const operations = useRuntimeStore((state) => state.operations)
  const openapiDocument = useRuntimeStore((state) => state.openapiDocument)
  const clientTargetUrl = useRuntimeStore((state) => state.clientTargetUrl)
  const connectionUrl = useRuntimeStore((state) => state.connectionUrl)
  const [output, setOutput] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const userEdited = useRef(false)
  const sourceRef = useRef(generateTsDemo(operations))

  const typeDefs = useMemo(
    () => generateClientTypeDefs(operations, openapiDocument),
    [operations, openapiDocument],
  )

  // Set up Monaco editor with type hints
  useEffect(() => {
    if (!containerRef.current) return

    // Add the generated type declarations as an extra lib
    const libUri = 'ts:filename/client-proxy.d.ts'
    const existing = tsLanguage.typescriptDefaults.getExtraLibs()
    if (!existing[libUri] || existing[libUri]?.content !== typeDefs) {
      tsLanguage.typescriptDefaults.addExtraLib(typeDefs, libUri)
    }

    if (editorRef.current) return

    tsLanguage.typescriptDefaults.setCompilerOptions({
      target: tsLanguage.ScriptTarget.ES2022,
      module: tsLanguage.ModuleKind.ESNext,
      allowJs: true,
      strict: false,
      noEmit: true,
    })

    const editor = monaco.editor.create(containerRef.current, {
      value: sourceRef.current,
      language: 'typescript',
      theme: 'browserver',
      minimap: { enabled: false },
      lineNumbers: 'on',
      fontSize: 12,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 8 },
    })

    editor.onDidChangeModelContent(() => {
      sourceRef.current = editor.getValue()
      userEdited.current = true
    })

    editorRef.current = editor

    return () => {
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  // Update type defs and demo when operations change
  useEffect(() => {
    const libUri = 'ts:filename/client-proxy.d.ts'
    tsLanguage.typescriptDefaults.addExtraLib(typeDefs, libUri)
  }, [typeDefs])

  useEffect(() => {
    if (userEdited.current || !editorRef.current || operations.length === 0) return
    const demo = generateTsDemo(operations)
    sourceRef.current = demo
    editorRef.current.setValue(demo)
    userEdited.current = false
  }, [operations])

  const handleRun = useCallback(async () => {
    const targetUrl = clientTargetUrl || connectionUrl
    if (!targetUrl) {
      setOutput((prev) => [...prev, '[error] No target URL — connect to a server first.'])
      return
    }
    setRunning(true)
    const logs: string[] = []
    try {
      const source = sourceRef.current

      // Transpile
      const compiled = ts.transpileModule(
        `module.exports.default = async function __tsConsoleMain(client: any, openapi: any) {\n${source}\n}`,
        {
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
          },
        },
      )

      // Connect
      const { client, openapi } = await connectBrowserverClientSideServer(targetUrl)

      const consoleFn = (...args: unknown[]) => {
        const line = args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
        logs.push(line)
      }
      const fakeConsole = { log: consoleFn, info: consoleFn, warn: (...args: unknown[]) => logs.push(`[warn] ${args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`), error: (...args: unknown[]) => logs.push(`[error] ${args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`) }

      const mod = { exports: {} as any }
      const evalFn = new Function('exports', 'module', 'require', 'console', compiled.outputText)
      evalFn(mod.exports, mod, () => ({}), fakeConsole)

      const result = await mod.exports.default(client, openapi)
      if (result !== undefined) {
        logs.push(`=> ${typeof result === 'string' ? result : JSON.stringify(result, null, 2)}`)
      }
      setOutput((prev) => [...prev, ...logs])
    } catch (e) {
      setOutput((prev) => [...prev, ...logs, `[error] ${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setRunning(false)
    }
  }, [clientTargetUrl, connectionUrl])

  // Cmd+Enter to run
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const disposable = editor.addAction({
      id: 'run-ts-console',
      label: 'Run',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => void handleRun(),
    })
    return () => disposable.dispose()
  }, [handleRun])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-bs-border bg-bs-bg-panel px-2 py-1">
        <span className="text-[10px] text-bs-text-faint uppercase tracking-wide">TypeScript Console</span>
        <div className="flex-1" />
        <button
          onClick={() => setOutput([])}
          className="text-[10px] text-bs-text-faint hover:text-bs-text"
        >
          clear
        </button>
        <button
          onClick={() => void handleRun()}
          disabled={running}
          className="rounded bg-bs-good px-3 py-0.5 text-[10px] font-bold text-bs-accent-text hover:opacity-90 disabled:opacity-50"
        >
          {running ? 'Running...' : 'Run'}
        </button>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" />
      <div className="flex-none h-px bg-bs-border" />
      <div className="flex-none h-[160px] flex flex-col">
        <ConsoleOutput lines={output} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Python Console
// ---------------------------------------------------------------------------

export function PythonConsoleView() {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const operations = useRuntimeStore((state) => state.operations)
  const clientTargetUrl = useRuntimeStore((state) => state.clientTargetUrl)
  const connectionUrl = useRuntimeStore((state) => state.connectionUrl)
  const [output, setOutput] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const userEdited = useRef(false)
  const sourceRef = useRef(generatePyDemo(operations))

  useEffect(() => {
    if (!containerRef.current || editorRef.current) return

    const editor = monaco.editor.create(containerRef.current, {
      value: sourceRef.current,
      language: 'python',
      theme: 'browserver',
      minimap: { enabled: false },
      lineNumbers: 'on',
      fontSize: 12,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 8 },
    })

    editor.onDidChangeModelContent(() => {
      sourceRef.current = editor.getValue()
      userEdited.current = true
    })

    editorRef.current = editor

    return () => {
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    if (userEdited.current || !editorRef.current || operations.length === 0) return
    const demo = generatePyDemo(operations)
    sourceRef.current = demo
    editorRef.current.setValue(demo)
    userEdited.current = false
  }, [operations])

  const handleRun = useCallback(async () => {
    const targetUrl = clientTargetUrl || connectionUrl
    if (!targetUrl) {
      setOutput((prev) => [...prev, '[error] No target URL — connect to a server first.'])
      return
    }
    setRunning(true)
    try {
      const source = sourceRef.current
      // Prepend a connection line so the user always gets `client` bound to the current target.
      const preamble = `client = await connect_client_side_server("${targetUrl}")\n`
      const fullSource = preamble + source
      const { runPythonBrowserClientSource } = await import('@modularizer/plat-client/python-browser')
      const result = await runPythonBrowserClientSource(fullSource)
      if (result !== undefined) {
        const line = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        setOutput((prev) => [...prev, line])
      }
    } catch (e) {
      setOutput((prev) => [...prev, `[error] ${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setRunning(false)
    }
  }, [clientTargetUrl, connectionUrl])

  // Cmd+Enter to run
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const disposable = editor.addAction({
      id: 'run-python-console',
      label: 'Run',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => void handleRun(),
    })
    return () => disposable.dispose()
  }, [handleRun])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-bs-border bg-bs-bg-panel px-2 py-1">
        <span className="text-[10px] text-bs-text-faint uppercase tracking-wide">Python Console</span>
        <div className="flex-1" />
        <button
          onClick={() => setOutput([])}
          className="text-[10px] text-bs-text-faint hover:text-bs-text"
        >
          clear
        </button>
        <button
          onClick={() => void handleRun()}
          disabled={running}
          className="rounded bg-bs-good px-3 py-0.5 text-[10px] font-bold text-bs-accent-text hover:opacity-90 disabled:opacity-50"
        >
          {running ? 'Running...' : 'Run'}
        </button>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" />
      <div className="flex-none h-px bg-bs-border" />
      <div className="flex-none h-[160px] flex flex-col">
        <ConsoleOutput lines={output} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// CLI Emulator
// ---------------------------------------------------------------------------

interface CliHistoryEntry {
  id: number
  input: string
  output: string
  ok: boolean
  pending?: boolean
}

function coerceCliValue(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw)
  return raw
}

function tokenizeCliArgs(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const ch of input) {
    if (escaping) {
      current += ch
      escaping = false
      continue
    }

    if (ch === '\\') {
      escaping = true
      continue
    }

    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }

    if (/\s/.test(ch)) {
      if (current !== '') {
        tokens.push(current)
        current = ''
      }
      continue
    }

    current += ch
  }

  if (escaping || quote) {
    throw new Error('Invalid argument syntax: unmatched quote or escape sequence.')
  }

  if (current !== '') tokens.push(current)
  return tokens
}

function parseCliInputObject(input: string): Record<string, unknown> {
  const parts = tokenizeCliArgs(input)
  const inputObj: Record<string, unknown> = {}

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]

    if (part.startsWith('--') || part.startsWith('-')) {
      const stripped = part.replace(/^-+/, '')
      const eqIdx = stripped.indexOf('=')
      let key: string
      let rawVal: unknown

      if (eqIdx > 0) {
        key = stripped.slice(0, eqIdx)
        rawVal = stripped.slice(eqIdx + 1)
      } else {
        key = stripped
        rawVal = parts[++i] ?? true
      }

      inputObj[key] = typeof rawVal === 'string' ? coerceCliValue(rawVal) : rawVal
      continue
    }

    const eq = part.indexOf('=')
    if (eq > 0) {
      const key = part.slice(0, eq)
      const rawVal = part.slice(eq + 1)
      inputObj[key] = coerceCliValue(rawVal)
    }
  }

  return inputObj
}

export function CliEmulatorView() {
  const operations = useRuntimeStore((state) => state.operations)
  const clientTargetUrl = useRuntimeStore((state) => state.clientTargetUrl)
  const connectionUrl = useRuntimeStore((state) => state.connectionUrl)
  const [history, setHistory] = useState<CliHistoryEntry[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [cmdHistory, setCmdHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const nextIdRef = useRef(0)
  const menuRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  // Persistent client connection — reconnects only when target URL changes
  const clientRef = useRef<{ client: any; url: string } | null>(null)
  const targetUrl = clientTargetUrl || connectionUrl

  const getClient = async () => {
    if (!targetUrl) throw new Error('No target URL — connect to a server first.')
    if (clientRef.current && clientRef.current.url === targetUrl) {
      return clientRef.current.client
    }
    const { client } = await connectBrowserverClientSideServer(targetUrl)
    clientRef.current = { client, url: targetUrl }
    return client
  }

  // Clear cached client when URL changes
  useEffect(() => {
    if (clientRef.current && clientRef.current.url !== targetUrl) {
      clientRef.current = null
    }
  }, [targetUrl])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [history])

  const clearTerminal = useCallback(() => {
    setHistory([])
  }, [])

  useEffect(() => {
    if (!contextMenu) return

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      setContextMenu(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }

    const handleWindowBlur = () => setContextMenu(null)

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('blur', handleWindowBlur)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [contextMenu])

  const handleSubmit = async () => {
    const trimmed = input.trim()
    if (!trimmed) return

    setCmdHistory((prev) => [trimmed, ...prev].slice(0, 50))
    setHistoryIndex(-1)
    setInput('')
    setRunning(true)

    const firstSpaceIdx = trimmed.indexOf(' ')
    const commandToken = (firstSpaceIdx === -1 ? trimmed : trimmed.slice(0, firstSpaceIdx)).toLowerCase()

    // Built-in commands
    if (commandToken === 'help') {
      const opNames = operations.map((op) => `  ${op.label}${op.inputSchema?.properties ? ` ${JSON.stringify(Object.keys((op.inputSchema.properties as any) ?? {}))}` : ''}`).join('\n')
      setHistory((prev) => [...prev, {
        id: nextIdRef.current++,
        input: trimmed,
        output: `Available commands:\n  help          — show this help\n  list          — list available operations\n  clear         — clear history\n  <method> [json|key=value|--key=value|--key value|-key value] — invoke a method\n  quoted values are supported, e.g. name="Jane Doe"\n\nOperations:\n${opNames || '  (none — connect to a server first)'}`,
        ok: true,
      }])
      setRunning(false)
      return
    }

    if (commandToken === 'list') {
      const lines = operations.map((op) => `  ${op.method.padEnd(6)} ${op.path.padEnd(20)} ${op.label}`).join('\n')
      setHistory((prev) => [...prev, {
        id: nextIdRef.current++,
        input: trimmed,
        output: lines || '(no operations — connect to a server first)',
        ok: true,
      }])
      setRunning(false)
      return
    }

    if (commandToken === 'clear') {
      clearTerminal()
      setRunning(false)
      return
    }

    // Parse: <operationLabel> [json]
    const spaceIdx = trimmed.indexOf(' ')
    const opName = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)
    const jsonStr = spaceIdx === -1 ? '{}' : trimmed.slice(spaceIdx + 1).trim()

    const operation = operations.find(
      (op) => op.label === opName || op.id === opName || op.label.toLowerCase() === opName.toLowerCase(),
    )

    if (!operation) {
      setHistory((prev) => [...prev, {
        id: nextIdRef.current++,
        input: trimmed,
        output: `Unknown command: ${opName}\nType "help" for available commands.`,
        ok: false,
      }])
      setRunning(false)
      return
    }

    const targetUrl = clientTargetUrl || connectionUrl
    if (!targetUrl) {
      setHistory((prev) => [...prev, {
        id: nextIdRef.current++,
        input: trimmed,
        output: 'No target URL — connect to a server first.',
        ok: false,
      }])
      setRunning(false)
      return
    }

    // Push the entry immediately so it appears while the request is in flight
    const entryId = nextIdRef.current++
    setHistory((prev) => [...prev, { id: entryId, input: trimmed, output: '', ok: true, pending: true }])

    try {
      let inputObj: Record<string, unknown>
      try {
        inputObj = JSON.parse(jsonStr)
      } catch {
        // Fallback parser supports key=value, dashed args, and quoted values.
        inputObj = parseCliInputObject(jsonStr)
      }

      const client = await getClient()
      const m = operation.method.toUpperCase()
      let result: unknown
      if (m === 'GET') result = await (client as any).get(operation.path, inputObj)
      else if (m === 'POST') result = await (client as any).post(operation.path, inputObj)
      else if (m === 'PUT') result = await (client as any).put(operation.path, inputObj)
      else if (m === 'PATCH') result = await (client as any).patch(operation.path, inputObj)
      else if (m === 'DELETE') result = await (client as any).delete(operation.path, inputObj)
      else throw new Error(`Unsupported method: ${m}`)

      setHistory((prev) => prev.map((e) =>
        e.id === entryId
          ? { id: entryId, input: trimmed, output: typeof result === 'string' ? result : JSON.stringify(result, null, 2), ok: true }
          : e,
      ))
    } catch (e) {
      setHistory((prev) => prev.map((entry) =>
        entry.id === entryId
          ? { id: entryId, input: trimmed, output: e instanceof Error ? e.message : String(e), ok: false }
          : entry,
      ))
    } finally {
      setRunning(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !running) {
      void handleSubmit()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(historyIndex + 1, cmdHistory.length - 1)
      setHistoryIndex(next)
      if (cmdHistory[next]) setInput(cmdHistory[next])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = historyIndex - 1
      if (next < 0) {
        setHistoryIndex(-1)
        setInput('')
      } else {
        setHistoryIndex(next)
        setInput(cmdHistory[next])
      }
    }
  }

  const serverName = (clientTargetUrl || connectionUrl || 'server').replace(/^css:\/\//, '')

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-bs-bg-editor font-mono text-[12px]"
      onClick={() => inputRef.current?.focus()}
      onContextMenu={(e) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto p-3">
        <div className="text-bs-text-faint mb-2">
          Connected to {clientTargetUrl || connectionUrl || '(no server)'}. Type "help" for commands.
        </div>
        {history.map((entry) => (
          <div key={entry.id} className="mb-2">
            <div className="text-bs-accent">
              <span className="text-bs-text-faint">{serverName}</span>{' > '}<span className="text-bs-text">{entry.input}</span>
            </div>
            <pre className={`whitespace-pre-wrap mt-0.5 ${entry.ok ? 'text-bs-text-muted' : 'text-bs-error'}`}>
              {entry.pending
                ? <span className="text-bs-text-faint animate-pulse">running...</span>
                : entry.output}
            </pre>
          </div>
        ))}
      </div>
      <div className="flex-none flex items-center gap-1 border-t border-bs-border bg-bs-bg-panel px-3 py-1.5">
        <span className="text-bs-text-faint">{serverName} {'>'}</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          spellCheck={false}
          autoFocus
          className="flex-1 bg-transparent text-bs-text outline-none disabled:opacity-50"
          placeholder={operations.length > 0 ? operations[0].label : 'help'}
        />
      </div>
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[160px] rounded border border-bs-border bg-bs-bg-panel p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            className="w-full rounded px-2 py-1 text-left text-bs-text hover:bg-bs-bg-hover"
            onClick={() => {
              clearTerminal()
              setContextMenu(null)
              inputRef.current?.focus()
            }}
          >
            Clear terminal
          </button>
        </div>
      )}
    </div>
  )
}
