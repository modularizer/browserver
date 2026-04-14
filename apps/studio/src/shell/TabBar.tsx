import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { MenuButton } from './MenuButton'
import { evaluateServerAuthorityStatus } from '../runtime/authorityPolicy'
import { preferredServerNameForProject } from '../runtime/serverNames'
import { useIdentityStore } from '../store/identity'
import { useNamespaceStore } from '../store/namespace'
import { selectTabRuntimeSession, useRuntimeStore } from '../store/runtime'
import {
  editorViewDefinitions,
  getEditorItemLabels,
  getEditorViewId,
  selectPaneTabs,
  useWorkspaceStore,
} from '../store/workspace'

export function TabBar({
  onStartTabDrag,
  onEndTabDrag,
  onReorderTab,
  onRequestClosePath,
  onRequestClosePaths,
}: {
  onStartTabDrag: (path: string) => void
  onEndTabDrag: () => void
  onReorderTab: (path: string, beforePath: string) => void
  onRequestClosePath: (path: string) => void
  onRequestClosePaths: (paths: string[]) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const pendingDragRef = useRef<{
    path: string
    startX: number
    startY: number
    dragging: boolean
    splitMode: boolean
  } | null>(null)
  const suppressClickPathRef = useRef<string | null>(null)
  const [reorderTargetPath, setReorderTargetPath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    path: string
    x: number
    y: number
  } | null>(null)
  const files = useWorkspaceStore((state) => state.files)
  const openFilePaths = useWorkspaceStore((state) => state.openFilePaths)
  const dirtyFilePaths = useWorkspaceStore((state) => state.dirtyFilePaths)
  const activeFilePath = useWorkspaceStore((state) => state.activeFilePath)
  const setActiveFile = useWorkspaceStore((state) => state.setActiveFile)
  const openEditorView = useWorkspaceStore((state) => state.openEditorView)
  const createFile = useWorkspaceStore((state) => state.createFile)
  const sampleId = useWorkspaceStore((state) => state.sample.id)
  const activeEditorPane = useWorkspaceStore((state) => state.activeEditorPane)
  const paneTabs = useWorkspaceStore((state) => state.paneTabs)
  const orderedPaths = useWorkspaceStore((state) => selectPaneTabs(state, 'primary'))
  const paneFiles = useWorkspaceStore((state) => state.paneFiles)
  const viewTitles = useWorkspaceStore((state) => state.viewTitles)
  const assignFileToPane = useWorkspaceStore((state) => state.assignFileToPane)
  const splitFileToPane = useWorkspaceStore((state) => state.splitFileToPane)
  const focusEditorPane = useWorkspaceStore((state) => state.focusEditorPane)
  const activePanePath = paneFiles[activeEditorPane]
  const activePaneRuntime = useRuntimeStore(selectTabRuntimeSession(activePanePath))
  const tabSessions = useRuntimeStore((state) => state.tabSessions)
  const runPane = useRuntimeStore((state) => state.runPane)
  const stopPane = useRuntimeStore((state) => state.stopPane)
  const user = useIdentityStore((state) => state.user)
  const namespaces = useNamespaceStore((state) => state.namespaces)
  const itemLabels = useMemo(() => getEditorItemLabels(orderedPaths, files, viewTitles), [files, orderedPaths, viewTitles])
  const openItems = orderedPaths.map((path) => ({
    path,
    label: itemLabels[path] ?? path,
    isView: Boolean(getEditorViewId(path)),
  }))
  const isRunning = activePaneRuntime.mode === 'server' && (activePaneRuntime.status === 'running' || activePaneRuntime.status === 'starting')
  const activeIsView = Boolean(getEditorViewId(activePanePath))
  const activeFile = files.find((file) => file.path === activePanePath) ?? null
  const launchAuthorityStatus = activeFile?.name.split('/').pop()?.startsWith('server')
    ? evaluateServerAuthorityStatus(preferredServerNameForProject(sampleId, activeEditorPane), user, namespaces)
    : null
  const canRunActive = isRunning || !launchAuthorityStatus || launchAuthorityStatus.allowed
  const unopenedFiles = files
    .filter((file) => !openFilePaths.includes(file.path))
    .map((file) => ({
      id: `existing.${file.path}`,
      label: file.name,
      hint: file.language,
      run: () => setActiveFile(file.path, activeEditorPane),
    }))
  const newTabItems = [
    {
      id: 'file.new',
      label: 'New File',
      hint: 'TypeScript',
      run: () => createFile(activeEditorPane),
    },
    {
      id: 'file.existing',
      label: 'Existing File',
      hint: unopenedFiles.length === 0 ? 'All open' : `${unopenedFiles.length} available`,
      disabled: unopenedFiles.length === 0,
      children: unopenedFiles,
    },
    ...editorViewDefinitions.map((view) => ({
      id: `view.${view.id}`,
      label: view.label,
      hint: 'In this pane',
      run: () => openEditorView(view.id, activeEditorPane),
    })),
  ]

  useEffect(() => {
    const onMouseMove = (event: MouseEvent) => {
      const pending = pendingDragRef.current
      if (!pending) return

      const deltaX = Math.abs(event.clientX - pending.startX)
      const deltaY = Math.abs(event.clientY - pending.startY)
      if (!pending.dragging && deltaX + deltaY < 8) return

      if (!pending.dragging) {
        pending.dragging = true
        document.body.style.userSelect = 'none'
      }

      if (!pending.splitMode) {
        const rect = rootRef.current?.getBoundingClientRect()
        if (
          rect
          && (event.clientY < rect.top - 6 || event.clientY > rect.bottom + 6)
        ) {
          pending.splitMode = true
          setReorderTargetPath(null)
          onStartTabDrag(pending.path)
        }
      }
    }

    const onMouseUp = () => {
      const pending = pendingDragRef.current
      if (!pending) return

      pendingDragRef.current = null
      setReorderTargetPath(null)
      document.body.style.userSelect = ''
      if (pending.dragging && pending.splitMode) {
        onEndTabDrag()
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      document.body.style.userSelect = ''
    }
  }, [onEndTabDrag, onStartTabDrag])

  useEffect(() => {
    if (!contextMenu) return

    const close = () => setContextMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [contextMenu])

  const contextActions = useMemo(() => {
    if (!contextMenu) return []

    const actions: Array<{ id: string; label: string; run: () => void }> = []
    const path = contextMenu.path

    if (paneTabs.secondary.tabs.length === 0) {
      actions.push({
        id: 'split.secondary',
        label: 'Split To New Pane',
        run: () => {
          splitFileToPane('secondary', path)
          focusEditorPane('secondary')
          setContextMenu(null)
        },
      })
    } else if (!paneTabs.secondary.tabs.includes(path)) {
      actions.push({
        id: 'move.secondary',
        label: 'Move To Pane 2',
        run: () => {
          assignFileToPane('secondary', path)
          focusEditorPane('secondary')
          setContextMenu(null)
        },
      })
    }

    if (paneTabs.secondary.tabs.length > 0 && paneTabs.tertiary.tabs.length === 0) {
      actions.push({
        id: 'split.tertiary',
        label: 'Split To Third Pane',
        run: () => {
          splitFileToPane('tertiary', path)
          focusEditorPane('tertiary')
          setContextMenu(null)
        },
      })
    } else if (paneTabs.tertiary.tabs.length > 0 && !paneTabs.tertiary.tabs.includes(path)) {
      actions.push({
        id: 'move.tertiary',
        label: 'Move To Pane 3',
        run: () => {
          assignFileToPane('tertiary', path)
          focusEditorPane('tertiary')
          setContextMenu(null)
        },
      })
    }

    if (!paneTabs.primary.tabs.includes(path) || paneFiles.primary !== path) {
      actions.push({
        id: 'move.primary',
        label: 'Move To Pane 1',
        run: () => {
          assignFileToPane('primary', path)
          focusEditorPane('primary')
          setContextMenu(null)
        },
      })
    }

    const index = orderedPaths.indexOf(path)
    if (index !== -1) {
      actions.push({
        id: 'close.current',
        label: 'Close',
        run: () => {
          onRequestClosePath(path)
          setContextMenu(null)
        },
      })
      actions.push({
        id: 'close.all',
        label: 'Close All',
        run: () => {
          onRequestClosePaths(orderedPaths)
          setContextMenu(null)
        },
      })
      actions.push({
        id: 'close.others',
        label: 'Close Others',
        run: () => {
          onRequestClosePaths(orderedPaths.filter((entry) => entry !== path))
          setContextMenu(null)
        },
      })
      actions.push({
        id: 'close.left',
        label: 'Close Tabs To Left',
        run: () => {
          onRequestClosePaths(orderedPaths.slice(0, index))
          setContextMenu(null)
        },
      })
      actions.push({
        id: 'close.right',
        label: 'Close Tabs To Right',
        run: () => {
          onRequestClosePaths(orderedPaths.slice(index + 1))
          setContextMenu(null)
        },
      })
    }

    return actions
  }, [assignFileToPane, contextMenu, focusEditorPane, onRequestClosePath, onRequestClosePaths, orderedPaths, paneFiles.primary, paneTabs.primary.tabs, paneTabs.secondary.tabs, paneTabs.tertiary.tabs, splitFileToPane])

  return (
    <div ref={rootRef} className="flex-none flex h-[30px] overflow-hidden border-b border-bs-border bg-bs-bg-panel">
      <div className="no-scrollbar flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        {openItems.map((item) => (
          <div
            key={item.path}
            onClick={() => {
              if (suppressClickPathRef.current === item.path) {
                suppressClickPathRef.current = null
                return
              }
              setActiveFile(item.path, activeEditorPane)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              setActiveFile(item.path, activeEditorPane)
              setContextMenu({
                path: item.path,
                x: event.clientX,
                y: event.clientY,
              })
            }}
            onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => {
              if (event.button !== 0) return
              pendingDragRef.current = {
                path: item.path,
                startX: event.clientX,
                startY: event.clientY,
                dragging: false,
                splitMode: false,
              }
            }}
            onMouseEnter={() => {
              const pending = pendingDragRef.current
              if (!pending?.dragging || pending.splitMode || pending.path === item.path) return
              setReorderTargetPath(item.path)
            }}
            onMouseLeave={() => {
              if (reorderTargetPath === item.path) {
                setReorderTargetPath(null)
              }
            }}
            onMouseUp={() => {
              const pending = pendingDragRef.current
              if (!pending?.dragging || pending.splitMode || pending.path === item.path) return
              onReorderTab(pending.path, item.path)
              suppressClickPathRef.current = pending.path
              window.setTimeout(() => {
                if (suppressClickPathRef.current === pending.path) {
                  suppressClickPathRef.current = null
                }
              }, 0)
              pendingDragRef.current = null
              setReorderTargetPath(null)
              document.body.style.userSelect = ''
            }}
            className={`flex h-full cursor-pointer select-none items-center border-r border-bs-border px-3 text-xs whitespace-nowrap ${
              item.path === activeFilePath
                ? 'bg-bs-tab-active text-bs-text border-t-2 border-t-bs-accent'
                : 'bg-bs-tab-inactive text-bs-text-muted hover:bg-bs-tab-hover border-t-2 border-t-transparent'
            } ${reorderTargetPath === item.path ? 'shadow-[inset_2px_0_0_0_var(--bs-accent)]' : ''}`}
            title={item.isView ? `${item.label} section` : 'Drag within the row to reorder, or drag out to split'}
          >
            <div className="flex items-center gap-2">
              {!item.isView ? (
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    tabSessions[item.path]?.mode === 'server' && (tabSessions[item.path]?.status === 'running' || tabSessions[item.path]?.status === 'starting')
                      ? 'bg-bs-good'
                      : tabSessions[item.path]?.status === 'error'
                        ? 'bg-bs-error'
                        : 'bg-bs-text-faint'
                  }`}
                />
              ) : null}
              <span>{item.label}</span>
              {!item.isView && dirtyFilePaths.includes(item.path) ? (
                <span className="text-bs-accent">●</span>
              ) : null}
            </div>
            {openItems.length > 1 ? (
              <button
                onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                  event.stopPropagation()
                  onRequestClosePath(item.path)
                }}
                draggable={false}
                className="ml-2 text-bs-text-faint hover:text-bs-text"
                aria-label={`Close ${item.label}`}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
        <div className="flex h-full flex-none items-center overflow-hidden border-r border-bs-border bg-bs-tab-inactive px-1">
          <MenuButton
            label="+"
            title="Open a workbench section in this pane"
            items={newTabItems}
          />
        </div>
      </div>
      <div className="flex h-full flex-none items-center gap-2 border-l border-bs-border bg-bs-tab-inactive px-2">
        {!activeIsView ? (
          <>
            <span className="text-[9px] uppercase leading-none tracking-wide text-bs-text-faint">
              {activePaneRuntime.status}
            </span>
            <button
              onClick={() => void (isRunning ? stopPane(activeEditorPane) : runPane(activeEditorPane))}
              disabled={!canRunActive}
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] leading-none ${
                isRunning ? 'bg-bs-error text-bs-accent-text' : 'bg-bs-good text-bs-accent-text'
              } disabled:cursor-not-allowed disabled:opacity-50`}
              aria-label={isRunning ? 'Stop current pane' : 'Run current pane'}
              title={isRunning ? 'Stop the current pane runtime' : launchAuthorityStatus?.reason ?? 'Run the current pane file'}
            >
              {isRunning ? '■' : '▶'}
            </button>
          </>
        ) : null}
      </div>
      {contextMenu && contextActions.length > 0 ? (
        <div
          className="fixed z-50 min-w-[180px] rounded border border-bs-border bg-bs-bg-panel p-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {contextActions.map((action) => (
            <button
              key={action.id}
              onClick={action.run}
              className="block w-full rounded px-3 py-1.5 text-left text-xs text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
