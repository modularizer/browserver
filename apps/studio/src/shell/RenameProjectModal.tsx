import { useState, useEffect, useRef } from 'react'
import { Modal } from './Modal'

interface RenameProjectModalProps {
  open: boolean
  currentName: string
  currentSlug: string
  onConfirm: (name: string, slug: string) => void
  onClose: () => void
}

export function RenameProjectModal({ open, currentName, currentSlug, onConfirm, onClose }: RenameProjectModalProps) {
  const [name, setName] = useState(currentName)
  const [slug, setSlug] = useState(currentSlug)
  const nameRef = useRef<HTMLInputElement>(null)

  // Reset fields to current values each time the modal opens
  useEffect(() => {
    if (open) {
      setName(currentName)
      setSlug(currentSlug)
      // Defer focus until the modal is mounted
      setTimeout(() => nameRef.current?.select(), 0)
    }
  }, [open, currentName, currentSlug])

  const commit = () => {
    const trimmedName = name.trim()
    const trimmedSlug = slug.trim()
    if (!trimmedName && !trimmedSlug) { onClose(); return }
    onConfirm(trimmedName || currentName, trimmedSlug || currentSlug)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
  }

  return (
    <Modal
      open={open}
      title="Rename project"
      onClose={onClose}
      actions={
        <>
          <button
            onClick={onClose}
            className="rounded px-3 py-1 text-[11px] text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text"
          >
            cancel
          </button>
          <button
            onClick={commit}
            className="rounded bg-bs-accent px-3 py-1 text-[11px] text-bs-accent-text"
          >
            rename
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[12px]">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-[0.12em] text-bs-text-faint">Name</label>
          <input
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Display name"
            className="rounded border border-bs-border bg-bs-bg-editor px-3 py-1.5 text-[12px] text-bs-text outline-none focus:border-bs-border-focus"
          />
          <div className="text-[11px] text-bs-text-faint">Human-readable label shown in the title bar and project switcher.</div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] uppercase tracking-[0.12em] text-bs-text-faint">Slug</label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="url-safe-id"
            spellCheck={false}
            className="rounded border border-bs-border bg-bs-bg-editor px-3 py-1.5 font-mono text-[12px] text-bs-text outline-none focus:border-bs-border-focus"
          />
          <div className="text-[11px] text-bs-text-faint">
            Used as the project ID, storage key, and URL path segment. Changing it migrates all file paths and storage.
          </div>
        </div>
      </div>
    </Modal>
  )
}

