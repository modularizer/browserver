import { useEffect } from 'react'

interface ModalProps {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  actions?: React.ReactNode
}

export function Modal({ open, title, onClose, children, actions }: ModalProps) {
  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  return (
    <div className="absolute inset-0 z-[2100] flex items-center justify-center bg-[rgba(15,17,23,0.62)] p-4 sm:p-6">
      <div className="flex w-[min(900px,92vw)] max-h-[90vh] flex-col overflow-hidden rounded border border-bs-border bg-bs-bg-panel shadow-[0_28px_90px_rgba(0,0,0,0.5)]">
        {/* Header — fixed */}
        <div className="flex shrink-0 items-center border-b border-bs-border px-4 py-3">
          <div className="text-sm text-bs-text">{title}</div>
          <div className="flex-1" />
          <button onClick={onClose} className="text-bs-text-faint hover:text-bs-text" aria-label="Close modal">
            ×
          </button>
        </div>
        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4
          [&::-webkit-scrollbar]:w-[5px]
          [&::-webkit-scrollbar-track]:bg-transparent
          [&::-webkit-scrollbar-thumb]:rounded-full
          [&::-webkit-scrollbar-thumb]:bg-bs-border
          hover:[&::-webkit-scrollbar-thumb]:bg-bs-text-faint">
          {children}
        </div>
        {/* Footer — fixed */}
        {actions ? (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-bs-border px-4 py-3">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}
