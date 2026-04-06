import { useEffect, useMemo, useRef } from 'react'
import { useCommandPaletteStore } from '../store/commandPalette'

export interface CommandPaletteItem {
  id: string
  title: string
  subtitle?: string
  keywords?: string[]
  run: () => void
}

interface CommandPaletteProps {
  commands: CommandPaletteItem[]
}

export function CommandPalette({ commands }: CommandPaletteProps) {
  const open = useCommandPaletteStore((state) => state.open)
  const query = useCommandPaletteStore((state) => state.query)
  const selectedIndex = useCommandPaletteStore((state) => state.selectedIndex)
  const closePalette = useCommandPaletteStore((state) => state.closePalette)
  const setQuery = useCommandPaletteStore((state) => state.setQuery)
  const setSelectedIndex = useCommandPaletteStore((state) => state.setSelectedIndex)
  const moveSelection = useCommandPaletteStore((state) => state.moveSelection)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return commands

    return commands.filter((command) => {
      const haystack = [command.title, command.subtitle ?? '', ...(command.keywords ?? [])]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [commands, query])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closePalette()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveSelection(1, filtered.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveSelection(-1, filtered.length)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const target = filtered[selectedIndex]
        if (!target) return
        closePalette()
        target.run()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closePalette, filtered, moveSelection, open, selectedIndex])

  if (!open) return null

  return (
    <div className="absolute inset-0 z-[2000] flex items-start justify-center bg-[rgba(15,17,23,0.55)] pt-16">
      <div className="w-[min(720px,92vw)] overflow-hidden rounded border border-bs-border bg-bs-bg-panel shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="border-b border-bs-border px-3 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a command or search for a panel, sample, theme, or layout"
            className="w-full bg-transparent text-sm text-bs-text outline-none placeholder:text-bs-text-faint"
          />
        </div>
        <div className="max-h-[60vh] overflow-auto p-2">
          {filtered.length > 0 ? filtered.map((command, index) => (
            <button
              key={command.id}
              onClick={() => {
                closePalette()
                command.run()
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              className={`block w-full rounded px-3 py-2 text-left ${
                index === selectedIndex
                  ? 'bg-bs-bg-active text-bs-text'
                  : 'text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text'
              }`}
            >
              <div className="text-sm">{command.title}</div>
              {command.subtitle ? (
                <div className="mt-0.5 text-[11px] text-bs-text-faint">{command.subtitle}</div>
              ) : null}
            </button>
          )) : (
            <div className="px-3 py-4 text-sm text-bs-text-faint">No matching commands.</div>
          )}
        </div>
      </div>
    </div>
  )
}
