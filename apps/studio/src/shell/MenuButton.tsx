import { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  id: string
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  children?: MenuItem[]
  run?: () => void
}

interface MenuButtonProps {
  label: string
  title?: string
  items: MenuItem[]
  variant?: 'default' | 'project'
}

export function MenuButton({ label, title, items, variant = 'default' }: MenuButtonProps) {
  const [open, setOpen] = useState(false)
  const [submenuId, setSubmenuId] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const rect = rootRef.current?.getBoundingClientRect()

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setSubmenuId(null)
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open) {
      setSubmenuId(null)
    }
  }, [open])

  const submenuItem = items.find((item) => item.id === submenuId && item.children?.length)

  return (
    <div ref={rootRef} className="relative flex items-center">
      <button
        onClick={() => {
          setOpen((value) => !value)
          setSubmenuId(null)
        }}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex h-[22px] items-center rounded px-2 leading-none ${
          variant === 'project'
            ? open
              ? 'bg-bs-bg-active text-bs-text shadow-[inset_0_0_0_1px_var(--bs-border-focus)]'
              : 'bg-bs-bg-badge text-bs-text hover:bg-bs-bg-active'
            : ''
        } ${
          open
            ? 'bg-bs-bg-active text-bs-text'
            : 'text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text'
        }`}
      >
        {label}
        {variant === 'project' ? <span className="ml-1 text-[10px] text-bs-text-faint">change</span> : null}
      </button>
      {open && rect ? (
        <>
          <div
            className="fixed z-[1900] min-w-56 overflow-hidden rounded border border-bs-border bg-bs-bg-panel shadow-[0_18px_50px_rgba(0,0,0,0.4)]"
            style={{
              left: rect.left,
              top: rect.bottom + 6,
            }}
          >
            {items.map((item) => {
              const hasChildren = Boolean(item.children?.length)
              const activeSubmenu = submenuId === item.id && hasChildren

              return (
                <button
                  key={item.id}
                  onMouseEnter={() => setSubmenuId(hasChildren ? item.id : null)}
                  onClick={() => {
                    if (item.disabled) return
                    if (hasChildren) {
                      setSubmenuId(item.id)
                      return
                    }
                    setOpen(false)
                    setSubmenuId(null)
                    item.run?.()
                  }}
                  disabled={item.disabled}
                  title={item.hint ? `${item.label} - ${item.hint}` : item.label}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-[11px] ${
                    item.disabled
                      ? 'cursor-not-allowed text-bs-text-faint opacity-60'
                      : item.danger
                        ? 'text-bs-error hover:bg-bs-bg-hover'
                        : activeSubmenu
                          ? 'bg-bs-bg-hover text-bs-text'
                          : 'text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text'
                  }`}
                >
                  <span>{item.label}</span>
                  {hasChildren ? (
                    <span className="ml-auto text-[10px] text-bs-text-faint">›</span>
                  ) : (
                    <span className="ml-auto text-[10px] text-bs-text-faint">{item.hint}</span>
                  )}
                </button>
              )
            })}
          </div>
          {submenuItem && submenuItem.children && submenuItem.children.length > 0 ? (
            <div
              className="fixed z-[1901] min-w-56 overflow-hidden rounded border border-bs-border bg-bs-bg-panel shadow-[0_18px_50px_rgba(0,0,0,0.4)]"
              style={{
                left: rect.left + 232,
                top: rect.bottom + 6,
              }}
            >
              {submenuItem.children.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.disabled) return
                    setOpen(false)
                    setSubmenuId(null)
                    item.run?.()
                  }}
                  disabled={item.disabled}
                  title={item.hint ? `${item.label} - ${item.hint}` : item.label}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-[11px] ${
                    item.disabled
                      ? 'cursor-not-allowed text-bs-text-faint opacity-60'
                      : 'text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text'
                  }`}
                >
                  <span className="truncate">{item.label}</span>
                  <span className="ml-auto text-[10px] text-bs-text-faint">{item.hint}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
