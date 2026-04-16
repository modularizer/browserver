import { useState } from 'react'
import { Card } from './Card'

export function App() {
  const [n, setN] = useState(0)
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-900 p-8 text-slate-100">
      <h1 className="mb-4 text-3xl font-bold tracking-tight">browserver + React</h1>
      <p className="mb-6 text-slate-300">
        This sample is built entirely in your browser by the browserver bundler
        (esbuild-wasm). Bare imports resolve through esm.sh. Tailwind runs via
        its CDN JIT.
      </p>
      <Card>
        <button
          onClick={() => setN(n + 1)}
          className="rounded-lg bg-indigo-500 px-4 py-2 font-medium shadow hover:bg-indigo-400 active:scale-95 transition"
        >
          clicked {n} times
        </button>
      </Card>
    </div>
  )
}
