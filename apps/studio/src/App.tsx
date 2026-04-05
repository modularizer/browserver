import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor'
import { samples } from './samples'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'typescript':
      case 'javascript':
        return new Worker(
          new URL('monaco-editor/esm/vs/language/typescript/ts.worker.js', import.meta.url),
          { type: 'module' },
        )
      case 'json':
        return new Worker(
          new URL('monaco-editor/esm/vs/language/json/json.worker.js', import.meta.url),
          { type: 'module' },
        )
      case 'css':
      case 'scss':
      case 'less':
        return new Worker(
          new URL('monaco-editor/esm/vs/language/css/css.worker.js', import.meta.url),
          { type: 'module' },
        )
      case 'html':
      case 'handlebars':
      case 'razor':
        return new Worker(
          new URL('monaco-editor/esm/vs/language/html/html.worker.js', import.meta.url),
          { type: 'module' },
        )
      default:
        return new Worker(
          new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url),
          { type: 'module' },
        )
    }
  },
}

export function App() {
  const editorRef = useRef<HTMLDivElement>(null)
  const editorInstance = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [sampleIdx, setSampleIdx] = useState(0)
  const [fileIdx, setFileIdx] = useState(0)

  const sample = samples[sampleIdx]
  const file = sample.files[fileIdx]

  useEffect(() => {
    if (!editorRef.current) return

    if (editorInstance.current) {
      editorInstance.current.dispose()
    }

    editorInstance.current = monaco.editor.create(editorRef.current, {
      value: file.content,
      language: file.language,
      theme: 'vs-dark',
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
    })

    return () => {
      editorInstance.current?.dispose()
      editorInstance.current = null
    }
  }, [file])

  return (
    <div className="h-full flex flex-col bg-neutral-900 text-neutral-100">
      {/* Top bar */}
      <div className="flex-none h-8 flex items-center gap-4 px-3 text-xs border-b border-neutral-800">
        <span className="text-neutral-500 font-medium">browserver</span>
        <div className="flex gap-1">
          {samples.map((s, i) => (
            <button
              key={s.id}
              onClick={() => { setSampleIdx(i); setFileIdx(0) }}
              className={`px-2 py-0.5 rounded ${i === sampleIdx ? 'bg-neutral-700 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {/* File tabs */}
      <div className="flex-none h-7 flex items-center gap-1 px-3 text-xs border-b border-neutral-800 bg-neutral-900/50">
        {sample.files.map((f, i) => (
          <button
            key={f.name}
            onClick={() => setFileIdx(i)}
            className={`px-2 py-0.5 rounded ${i === fileIdx ? 'bg-neutral-800 text-neutral-200' : 'text-neutral-500 hover:text-neutral-300'}`}
          >
            {f.name}
          </button>
        ))}
        <span className="ml-auto text-neutral-600">{sample.description}</span>
      </div>

      {/* Editor */}
      <div ref={editorRef} className="flex-1" />
    </div>
  )
}
