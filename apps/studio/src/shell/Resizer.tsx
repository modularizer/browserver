import { useCallback, useRef, type MouseEvent as ReactMouseEvent } from 'react'

interface ResizerProps {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
}

export function Resizer({ direction, onResize }: ResizerProps) {
  const startPos = useRef(0)

  const onMouseDown = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY

      const onMouseMove = (ev: MouseEvent) => {
        const current = direction === 'horizontal' ? ev.clientX : ev.clientY
        const delta = current - startPos.current
        startPos.current = current
        onResize(delta)
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [direction, onResize],
  )

  return (
    <div
      onMouseDown={onMouseDown}
      className={`flex-none ${
        direction === 'horizontal'
          ? 'w-[3px] cursor-col-resize hover:bg-bs-accent hover:opacity-80'
          : 'h-[3px] cursor-row-resize hover:bg-bs-accent hover:opacity-80'
      } bg-bs-border transition-colors`}
    />
  )
}
