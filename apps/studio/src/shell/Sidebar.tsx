import { useEffect, useMemo, useRef, useState } from 'react'
import { selectActiveFile, useWorkspaceStore, type WorkspaceFile } from '../store/workspace'
import { useLayoutStore } from '../store/layout'

interface FolderNode {
  fullPath: string
  label: string
  folders: FolderNode[]
  files: WorkspaceFile[]
}

type DragEntry =
  | { kind: 'file'; path: string }
  | { kind: 'folder'; path: string }

function hasExternalFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  return (
    dataTransfer.files.length > 0 ||
    Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file') ||
    Array.from(dataTransfer.types ?? []).includes('Files')
  )
}

export function Sidebar({
  onImportExternalFiles,
}: {
  onImportExternalFiles: (files: FileList | File[], pane: 'primary' | 'secondary' | 'tertiary', folderName?: string | null) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null!)
  const files = useWorkspaceStore((state) => state.files)
  const folders = useWorkspaceStore((state) => state.folders)
  const dirtyFilePaths = useWorkspaceStore((state) => state.dirtyFilePaths)
  const activeFile = useWorkspaceStore(selectActiveFile)
  const activeEditorPane = useWorkspaceStore((state) => state.activeEditorPane)
  const renamingPath = useWorkspaceStore((state) => state.renamingPath)
  const renamingFolderPath = useWorkspaceStore((state) => state.renamingFolderPath)
  const setActiveFile = useWorkspaceStore((state) => state.setActiveFile)
  const createFile = useWorkspaceStore((state) => state.createFile)
  const createFolder = useWorkspaceStore((state) => state.createFolder)
  const startRenaming = useWorkspaceStore((state) => state.startRenaming)
  const startRenamingFolder = useWorkspaceStore((state) => state.startRenamingFolder)
  const cancelRenaming = useWorkspaceStore((state) => state.cancelRenaming)
  const renameFile = useWorkspaceStore((state) => state.renameFile)
  const renameFolder = useWorkspaceStore((state) => state.renameFolder)
  const deleteFile = useWorkspaceStore((state) => state.deleteFile)
  const deleteFolder = useWorkspaceStore((state) => state.deleteFolder)
  const moveFileToFolder = useWorkspaceStore((state) => state.moveFileToFolder)
  const moveFolderToFolder = useWorkspaceStore((state) => state.moveFolderToFolder)
  const setActivePanel = useWorkspaceStore((state) => state.setActivePanel)
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar)
  const [draftName, setDraftName] = useState('')
  const [renameError, setRenameError] = useState(false)
  const [draggedEntry, setDraggedEntry] = useState<DragEntry | null>(null)
  const [hoveredDropTarget, setHoveredDropTarget] = useState<string | null>(null)
  const [collapsedFolders, setCollapsedFolders] = useState<string[]>([])
  const [contextMenu, setContextMenu] = useState<{
    kind: 'file' | 'folder'
    path: string
    x: number
    y: number
  } | null>(null)
  const tree = useMemo(() => buildFolderTree(files, folders), [files, folders])

  useEffect(() => {
    if (!renamingPath && !renamingFolderPath) {
      setDraftName('')
      setRenameError(false)
      return
    }

    if (renamingFolderPath) {
      setDraftName(folderBaseLabel(renamingFolderPath))
    } else {
      const file = files.find((entry) => entry.path === renamingPath)
      setDraftName(file?.name ?? '')
    }
    setRenameError(false)
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }, [files, renamingFolderPath, renamingPath])

  useEffect(() => {
    if (!contextMenu) return

    const closeOnMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setContextMenu(null)
      }
    }
    const closeOnBlur = () => {
      setContextMenu(null)
    }
    window.addEventListener('mousedown', closeOnMouseDown)
    window.addEventListener('blur', closeOnBlur)
    return () => {
      window.removeEventListener('mousedown', closeOnMouseDown)
      window.removeEventListener('blur', closeOnBlur)
    }
  }, [contextMenu])

  const workspaceId = useWorkspaceStore((s) => s.sample.id)
  const setActiveBottomPanel = useWorkspaceStore((s) => s.setActiveBottomPanel)
  const [commits, setCommits] = useState<Array<{ oid: string; message: string; author?: { name?: string; email?: string; timestamp?: number } }>>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const mod = await import('../store/git')
        const list = await mod.log(workspaceId, 50)
        if (!cancelled) setCommits(list)
      } catch (err) {
        console.warn('Failed to load commits', err)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [workspaceId])

  return (
    <div
      ref={rootRef}
      className="group relative flex h-full flex-col overflow-hidden bg-bs-bg-sidebar"
      onMouseDown={() => setActivePanel('sidebar')}
    >
      <div
        onClick={toggleSidebar}
        className="flex-none flex cursor-pointer items-center justify-between px-3 pt-2 pb-1 text-left hover:bg-bs-bg-hover"
        aria-label="Collapse left panel"
        title="Collapse left panel"
        role="button"
      >
        <div className="text-[10px] font-semibold uppercase tracking-wider text-bs-text-faint group-hover:text-bs-text">
          Files
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(event) => {
              event.stopPropagation()
              createFile(activeEditorPane)
            }}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-bs-text-faint hover:bg-bs-bg-active hover:text-bs-text"
            aria-label="New file"
            title="New file"
          >
            <NewFileIcon />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation()
              createFolder(activeEditorPane)
            }}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-bs-text-faint hover:bg-bs-bg-active hover:text-bs-text"
            aria-label="New folder"
            title="New folder"
          >
            <NewFolderIcon />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation()
              toggleSidebar()
            }}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-bs-text-faint hover:bg-bs-bg-active hover:text-bs-text"
            aria-label="Collapse left panel"
            title="Collapse left panel"
          >
            ‹
          </button>
        </div>
      </div>
      <div
        onClick={toggleSidebar}
        className="absolute right-0 top-0 h-full w-[25px] border-l border-transparent hover:border-bs-border hover:bg-bs-bg-hover/80"
        aria-label="Collapse left panel"
        title="Collapse left panel"
        role="button"
      />
      <div
        className={`flex-1 overflow-y-auto px-2 pb-2 ${
          hoveredDropTarget === '__root__'
            ? 'bg-bs-bg-hover/50 shadow-[inset_0_0_0_1px_var(--bs-border-focus)]'
            : ''
        }`}
        onDragOver={(event) => {
          const externalFiles = hasExternalFiles(event.dataTransfer)
          if (!draggedEntry && !externalFiles) return
          const target = event.target as HTMLElement | null
          if (target?.closest('[data-folder-drop-target="true"]')) return
          event.preventDefault()
          setHoveredDropTarget('__root__')
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          if (hoveredDropTarget === '__root__') {
            setHoveredDropTarget(null)
          }
        }}
        onDrop={(event) => {
          const target = event.target as HTMLElement | null
          if (target?.closest('[data-folder-drop-target="true"]')) return
          event.preventDefault()
          event.stopPropagation()
          if (event.dataTransfer.files.length > 0) {
            onImportExternalFiles(event.dataTransfer.files, activeEditorPane, null)
            setHoveredDropTarget(null)
            return
          }
          if (!draggedEntry) return
          if (draggedEntry.kind === 'file') {
            moveFileToFolder(draggedEntry.path, null)
          } else {
            moveFolderToFolder(draggedEntry.path, null)
          }
          setDraggedEntry(null)
          setHoveredDropTarget(null)
        }}
      >
        {tree.folders.map((folder) => (
          <FolderEntry
            key={folder.fullPath}
            folder={folder}
            depth={0}
            activeFilePath={activeFile?.path ?? null}
            dirtyFilePaths={dirtyFilePaths}
            renamingPath={renamingPath}
            renamingFolderPath={renamingFolderPath}
            inputRef={inputRef}
            draftName={draftName}
            renameError={renameError}
            draggedEntry={draggedEntry}
            hoveredDropTarget={hoveredDropTarget}
            onDraftNameChange={(value) => {
              setDraftName(value)
              setRenameError(false)
            }}
            onSubmitRename={(path) => {
              if (!renameFile(path, draftName)) {
                setRenameError(true)
              }
            }}
            onSubmitFolderRename={(folderPath) => {
              if (!renameFolder(folderPath, draftName)) {
                setRenameError(true)
              }
            }}
            onCancelRename={cancelRenaming}
            onActivateFile={setActiveFile}
            onStartRename={startRenaming}
            onStartRenameFolder={startRenamingFolder}
            onSetContextMenu={setContextMenu}
            onDragEntryStart={setDraggedEntry}
            onDragEntryEnd={() => {
              setDraggedEntry(null)
              setHoveredDropTarget(null)
            }}
            onHoverDropTarget={setHoveredDropTarget}
            onDropIntoFolder={(entry, folderPath) => {
              if (entry.kind === 'file') {
                moveFileToFolder(entry.path, folderPath)
              } else {
                moveFolderToFolder(entry.path, folderPath)
              }
              setDraggedEntry(null)
              setHoveredDropTarget(null)
            }}
            onDropExternalFiles={(filesToImport, folderPath) => {
              onImportExternalFiles(filesToImport, activeEditorPane, folderPath)
              setHoveredDropTarget(null)
            }}
            collapsedFolders={collapsedFolders}
            onToggleFolder={(folderPath) => {
              setCollapsedFolders((current) =>
                current.includes(folderPath)
                  ? current.filter((entry) => entry !== folderPath)
                  : [...current, folderPath],
              )
            }}
          />
        ))}
        {tree.files.map((file) => (
          <FileEntry
            key={file.path}
            file={file}
            depth={0}
            active={activeFile?.path === file.path}
            dirty={dirtyFilePaths.includes(file.path)}
            renaming={renamingPath === file.path}
            inputRef={inputRef}
            draftName={draftName}
            renameError={renameError}
            onDraftNameChange={(value) => {
              setDraftName(value)
              setRenameError(false)
            }}
            onSubmitRename={() => {
              if (!renameFile(file.path, draftName)) {
                setRenameError(true)
              }
            }}
            onCancelRename={cancelRenaming}
            onActivate={() => setActiveFile(file.path, activeEditorPane)}
            onStartRename={() => {
              setActiveFile(file.path, activeEditorPane)
              startRenaming(file.path)
            }}
            onContextMenu={(x, y) => setContextMenu({ kind: 'file', path: file.path, x, y })}
            onDragStart={() => setDraggedEntry({ kind: 'file', path: file.path })}
            onDragEnd={() => {
              setDraggedEntry(null)
              setHoveredDropTarget(null)
            }}
          />
        ))}
      </div>
      {contextMenu ? (
        <div
          className="fixed z-[2000] min-w-36 overflow-hidden rounded border border-bs-border bg-bs-bg-panel shadow-[0_18px_50px_rgba(0,0,0,0.4)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.kind === 'file' ? (
            <>
              <button
                onClick={() => {
                  setActiveFile(contextMenu.path, activeEditorPane)
                  setContextMenu(null)
                }}
                className="flex w-full items-center px-3 py-2 text-left text-[11px] text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text"
              >
                Open
              </button>
              <button
                onClick={() => {
                  startRenaming(contextMenu.path)
                  setContextMenu(null)
                }}
                className="flex w-full items-center px-3 py-2 text-left text-[11px] text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text"
              >
                Rename
              </button>
              <button
                onClick={() => {
                  deleteFile(contextMenu.path)
                  setContextMenu(null)
                }}
                className="flex w-full items-center px-3 py-2 text-left text-[11px] text-bs-error hover:bg-bs-bg-hover"
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  startRenamingFolder(contextMenu.path)
                  setContextMenu(null)
                }}
                className="flex w-full items-center px-3 py-2 text-left text-[11px] text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text"
              >
                Rename folder
              </button>
              <button
                onClick={() => {
                  deleteFolder(contextMenu.path)
                  setContextMenu(null)
                }}
                className="flex w-full items-center px-3 py-2 text-left text-[11px] text-bs-error hover:bg-bs-bg-hover"
              >
                Delete folder
              </button>
            </>
          )}
        </div>
      ) : null}

      {/* Version history (Git commits) */}
      <div className="flex-none border-t border-bs-border bg-bs-bg-sidebar/60">
        <div className="flex items-center justify-between px-3 py-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-bs-text-faint">History</div>
          <button
            className="inline-flex h-5 items-center justify-center rounded px-1 text-[10px] text-bs-text-faint hover:bg-bs-bg-active hover:text-bs-text"
            title="Open History panel"
            onClick={() => setActiveBottomPanel('history')}
          >
            Open
          </button>
        </div>
        <div className="max-h-48 overflow-auto px-2 pb-2">
          {commits.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-bs-text-faint">- no commits yet -</div>
          ) : (
            commits.map((c) => {
              const firstLine = (c.message || '').split('\n')[0] || '(no message)'
              const short = c.oid.slice(0, 7)
              const author = c.author?.name || 'browserver'
              return (
                <div key={c.oid} className="group/row cursor-pointer rounded px-2 py-1 text-[11px] text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text"
                  onClick={() => setActiveBottomPanel('history')}
                  title={`${c.oid} — ${c.message}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-bs-accent font-mono">{short}</span>
                    <span className="truncate">{firstLine}</span>
                  </div>
                  <div className="ml-6 text-[10px] text-bs-text-faint">{author}</div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

function FolderEntry({
  folder,
  depth,
  activeFilePath,
  dirtyFilePaths,
  renamingPath,
  renamingFolderPath,
  inputRef,
  draftName,
  renameError,
  draggedEntry,
  hoveredDropTarget,
  onDraftNameChange,
  onSubmitRename,
  onSubmitFolderRename,
  onCancelRename,
  onActivateFile,
  onStartRename,
  onStartRenameFolder,
  onSetContextMenu,
  onDragEntryStart,
  onDragEntryEnd,
  onHoverDropTarget,
  onDropIntoFolder,
  onDropExternalFiles,
  collapsedFolders,
  onToggleFolder,
}: {
  folder: FolderNode
  depth: number
  activeFilePath: string | null
  dirtyFilePaths: string[]
  renamingPath: string | null
  renamingFolderPath: string | null
  inputRef: React.RefObject<HTMLInputElement>
  draftName: string
  renameError: boolean
  draggedEntry: DragEntry | null
  hoveredDropTarget: string | null
  onDraftNameChange: (value: string) => void
  onSubmitRename: (path: string) => void
  onSubmitFolderRename: (folderPath: string) => void
  onCancelRename: () => void
  onActivateFile: (path: string) => void
  onStartRename: (path: string) => void
  onStartRenameFolder: (folderPath: string) => void
  onSetContextMenu: (value: { kind: 'file' | 'folder'; path: string; x: number; y: number } | null) => void
  onDragEntryStart: (entry: DragEntry) => void
  onDragEntryEnd: () => void
  onHoverDropTarget: (path: string | null) => void
  onDropIntoFolder: (entry: DragEntry, folderPath: string) => void
  onDropExternalFiles: (files: FileList, folderPath: string) => void
  collapsedFolders: string[]
  onToggleFolder: (folderPath: string) => void
}) {
  const isHovered = hoveredDropTarget === folder.fullPath
  const isRenaming = renamingFolderPath === folder.fullPath
  const isCollapsed = collapsedFolders.includes(folder.fullPath)

  return (
    <div>
      <div
        data-folder-drop-target="true"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', folder.fullPath)
          onDragEntryStart({ kind: 'folder', path: folder.fullPath })
        }}
        onDragEnd={onDragEntryEnd}
        onDragOver={(event) => {
          const externalFiles = hasExternalFiles(event.dataTransfer)
          if (!draggedEntry && !externalFiles) return
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'move'
          onHoverDropTarget(folder.fullPath)
        }}
        onDragEnter={(event) => {
          const externalFiles = hasExternalFiles(event.dataTransfer)
          if (!draggedEntry && !externalFiles) return
          event.preventDefault()
          event.stopPropagation()
          onHoverDropTarget(folder.fullPath)
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          if (isHovered) onHoverDropTarget(null)
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          if (event.dataTransfer.files.length > 0) {
            onDropExternalFiles(event.dataTransfer.files, folder.fullPath)
            return
          }
          if (!draggedEntry) return
          onDropIntoFolder(draggedEntry, folder.fullPath)
        }}
        onClick={() => {
          if (!isRenaming) {
            onToggleFolder(folder.fullPath)
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          onSetContextMenu({ kind: 'folder', path: folder.fullPath, x: event.clientX, y: event.clientY })
        }}
        onDoubleClick={() => onStartRenameFolder(folder.fullPath)}
        className={`flex items-center rounded px-2 py-0.5 text-xs text-bs-text-muted ${
          isHovered ? 'bg-bs-bg-active text-bs-text shadow-[inset_0_0_0_1px_var(--bs-border-focus)]' : 'hover:bg-bs-bg-hover hover:text-bs-text'
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        title={draggedEntry ? `Drop into ${folder.label}` : folder.label}
      >
        <span className="mr-2 text-bs-text-faint">{isCollapsed ? '▸' : '▾'}</span>
        {isRenaming ? (
          <input
            ref={inputRef}
            value={draftName}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onDraftNameChange(event.target.value)}
            onBlur={() => onSubmitFolderRename(folder.fullPath)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onCancelRename()
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                onSubmitFolderRename(folder.fullPath)
              }
            }}
            className={`w-full min-w-0 rounded border bg-bs-bg-editor px-1 py-0 text-xs outline-none ${
              renameError
                ? 'border-bs-error text-bs-error'
                : 'border-bs-border text-bs-text focus:border-bs-border-focus'
            }`}
            aria-label="Rename folder"
          />
        ) : (
          <span className="truncate">{folder.label}</span>
        )}
      </div>
      {!isCollapsed ? (
        <>
          {folder.folders.map((child) => (
            <FolderEntry
              key={child.fullPath}
              folder={child}
              depth={depth + 1}
              activeFilePath={activeFilePath}
              dirtyFilePaths={dirtyFilePaths}
              renamingPath={renamingPath}
              renamingFolderPath={renamingFolderPath}
              inputRef={inputRef}
              draftName={draftName}
              renameError={renameError}
              draggedEntry={draggedEntry}
              hoveredDropTarget={hoveredDropTarget}
              onDraftNameChange={onDraftNameChange}
              onSubmitRename={onSubmitRename}
              onSubmitFolderRename={onSubmitFolderRename}
              onCancelRename={onCancelRename}
              onActivateFile={onActivateFile}
              onStartRename={onStartRename}
              onStartRenameFolder={onStartRenameFolder}
              onSetContextMenu={onSetContextMenu}
              onDragEntryStart={onDragEntryStart}
              onDragEntryEnd={onDragEntryEnd}
              onHoverDropTarget={onHoverDropTarget}
              onDropIntoFolder={onDropIntoFolder}
              onDropExternalFiles={onDropExternalFiles}
              collapsedFolders={collapsedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
          {folder.files.map((file) => (
            <FileEntry
              key={file.path}
              file={file}
              depth={depth + 1}
              active={activeFilePath === file.path}
              dirty={dirtyFilePaths.includes(file.path)}
              renaming={renamingPath === file.path}
              inputRef={inputRef}
              draftName={draftName}
              renameError={renameError}
              onDraftNameChange={onDraftNameChange}
              onSubmitRename={() => onSubmitRename(file.path)}
              onCancelRename={onCancelRename}
              onActivate={() => onActivateFile(file.path)}
              onStartRename={() => {
                onActivateFile(file.path)
                onStartRename(file.path)
              }}
              onContextMenu={(x, y) => onSetContextMenu({ kind: 'file', path: file.path, x, y })}
              onDragStart={() => onDragEntryStart({ kind: 'file', path: file.path })}
              onDragEnd={onDragEntryEnd}
            />
          ))}
        </>
      ) : null}
    </div>
  )
}

function FileEntry({
  file,
  depth,
  active,
  dirty,
  renaming,
  inputRef,
  draftName,
  renameError,
  onDraftNameChange,
  onSubmitRename,
  onCancelRename,
  onActivate,
  onStartRename,
  onContextMenu,
  onDragStart,
  onDragEnd,
}: {
  file: WorkspaceFile
  depth: number
  active: boolean
  dirty: boolean
  renaming: boolean
  inputRef: React.RefObject<HTMLInputElement>
  draftName: string
  renameError: boolean
  onDraftNameChange: (value: string) => void
  onSubmitRename: () => void
  onCancelRename: () => void
  onActivate: () => void
  onStartRename: () => void
  onContextMenu: (x: number, y: number) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  return (
    <div
      draggable={!renaming}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', file.path)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={() => {
        if (renaming) return
        onActivate()
      }}
      onDoubleClick={onStartRename}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(event.clientX, event.clientY)
      }}
      className={`block w-full truncate rounded px-2 py-0.5 text-left text-xs ${
        active
          ? 'bg-bs-bg-active text-bs-text'
          : 'text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text'
      }`}
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      role="button"
      title={renaming ? 'Set a unique file name' : file.name}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        {renaming ? (
          <input
            ref={inputRef}
            value={draftName}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onDraftNameChange(event.target.value)}
            onBlur={onSubmitRename}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onCancelRename()
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                onSubmitRename()
              }
            }}
            className={`w-full min-w-0 rounded border bg-bs-bg-editor px-1 py-0 text-xs outline-none ${
              renameError
                ? 'border-bs-error text-bs-error'
                : 'border-bs-border text-bs-text focus:border-bs-border-focus'
            }`}
            aria-label="Rename file"
          />
        ) : (
          <span className="truncate">{baseLabel(file.name)}</span>
        )}
        {dirty ? <span className="text-bs-accent">●</span> : null}
      </span>
    </div>
  )
}

function buildFolderTree(files: WorkspaceFile[], explicitFolders: string[]): FolderNode {
  const root: FolderNode = {
    fullPath: '',
    label: '',
    folders: [],
    files: [],
  }
  const folderMap = new Map<string, FolderNode>([['', root]])

  for (const file of files) {
    const parts = file.name.split('/')
    const fileLabel = parts[parts.length - 1] ?? file.name
    let currentPath = ''
    let parent = root

    for (let index = 0; index < parts.length - 1; index += 1) {
      currentPath = currentPath ? `${currentPath}/${parts[index]}` : parts[index] ?? ''
      let folder = folderMap.get(currentPath)
      if (!folder) {
        folder = {
          fullPath: currentPath,
          label: `${parts[index] ?? currentPath}/`,
          folders: [],
          files: [],
        }
        folderMap.set(currentPath, folder)
        parent.folders.push(folder)
      }
      parent = folder
    }

    parent.files.push({ ...file, name: file.name })
    if (fileLabel !== file.name) {
      parent.files[parent.files.length - 1] = { ...file, name: file.name }
    }
  }

  for (const folderPath of explicitFolders) {
    const parts = folderPath.split('/').filter(Boolean)
    let currentPath = ''
    let parent = root

    for (let index = 0; index < parts.length; index += 1) {
      currentPath = currentPath ? `${currentPath}/${parts[index]}` : parts[index] ?? ''
      let folder = folderMap.get(currentPath)
      if (!folder) {
        folder = {
          fullPath: currentPath,
          label: `${parts[index] ?? currentPath}/`,
          folders: [],
          files: [],
        }
        folderMap.set(currentPath, folder)
        parent.folders.push(folder)
      }
      parent = folder
    }
  }

  const sortNode = (node: FolderNode) => {
    node.folders.sort((a, b) => a.label.localeCompare(b.label))
    node.files.sort((a, b) => a.name.localeCompare(b.name))
    for (const folder of node.folders) {
      sortNode(folder)
    }
  }
  sortNode(root)
  return root
}

function baseLabel(name: string): string {
  const parts = name.split('/')
  return parts[parts.length - 1] ?? name
}

function folderBaseLabel(path: string): string {
  const trimmed = path.replace(/\/+$/g, '')
  return baseLabel(trimmed)
}

function NewFileIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current" aria-hidden="true">
      <path d="M4 2.5h5l3 3V13.5H4z" strokeWidth="1.2" />
      <path d="M9 2.5v3h3" strokeWidth="1.2" />
      <path d="M8 7.5v4" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6 9.5h4" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function NewFolderIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current" aria-hidden="true">
      <path d="M2.5 5h3l1-1h2.5l1 1H13.5v6.5h-11z" strokeWidth="1.2" />
      <path d="M8 7.25v4" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M6 9.25h4" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
