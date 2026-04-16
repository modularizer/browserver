import type { ReactNode } from 'react'

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-6 shadow-lg backdrop-blur">
      {children}
    </div>
  )
}
