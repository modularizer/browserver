import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import JSZip from 'jszip'
import { gunzipSync, strFromU8 } from 'fflate'
import type { DatabaseSnapshot } from '@browserver/database'
import { listWorkspaceSnapshots, type WorkspaceSnapshot } from '@browserver/storage'
import { parseProjectBundle, serializeProjectBundle, type ProjectBundle } from './config/projectBundle'
import { deleteAllBrowserData, deleteProjectData } from './store/clearData'
import { BottomPanel } from './shell/BottomPanel'
import { CommandPalette, type CommandPaletteItem } from './shell/CommandPalette'
import { Editor } from './shell/Editor'
import { MenuButton } from './shell/MenuButton'
import { Modal } from './shell/Modal'
import { WelcomeModal } from './shell/WelcomeModal'
import { Resizer } from './shell/Resizer'
import { RightPanel } from './shell/RightPanel'
import { Sidebar } from './shell/Sidebar'
import { StatusBar } from './shell/StatusBar'
import { useFavicon } from './shell/favicon'
import { TabBar } from './shell/TabBar'
import { samples } from './samples'
import { useCommandPaletteStore } from './store/commandPalette'
import { useCheckpointStore } from './store/checkpoints'
import { useHistoryStore } from './store/history'
import { useDatabaseStore } from './store/database'
import { layoutPresets, useLayoutStore } from './store/layout'
import { useRuntimeStore } from './store/runtime'
import { useTrustStore } from './store/trust'
import { themes, useThemeStore, applyCssVariables, applyMonacoTheme } from './theme'
import { editorViewDefinitions, getEditorItemLabel, getEditorViewId, parseBrowserYaml, useWorkspaceStore, type EditorPaneId, type EditorViewId } from './store/workspace'

interface PendingExternalImport {
  files: File[]
  pane: EditorPaneId
  folderName: string | null
  names: string[]
  conflictIndex: number
  draftName: string
  error: string | null
}

interface PendingArchiveImport {
  files: File[]
  pane: EditorPaneId
  folderName: string | null
}

interface PendingRunningTabClose {
  path: string
  remainingPaths: string[]
}

function baseName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

function findFirstImportConflict(names: string[], existingNames: string[]): number {
  const seen = new Set(existingNames)
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]
    if (!name) continue
    if (seen.has(name)) return index
    seen.add(name)
  }
  return -1
}

function hasExternalFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  return (
    dataTransfer.files.length > 0 ||
    Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file') ||
    Array.from(dataTransfer.types ?? []).includes('Files')
  )
}

function isArchiveFileName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')
}

function stripArchiveExtension(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.tar.gz')) return name.slice(0, -7)
  if (lower.endsWith('.tgz')) return name.slice(0, -4)
  if (lower.endsWith('.zip')) return name.slice(0, -4)
  return name
}

function normalizeArchiveEntryName(name: string): string {
  return name.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^\.\//, '')
}

function parseTarEntries(bytes: Uint8Array): Array<{ name: string; bytes: Uint8Array }> {
  const entries: Array<{ name: string; bytes: Uint8Array }> = []
  let offset = 0

  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512)
    const name = strFromU8(header.subarray(0, 100)).replace(/\0.*$/, '').trim()
    if (!name) break

    const sizeField = strFromU8(header.subarray(124, 136)).replace(/\0.*$/, '').trim()
    const size = Number.parseInt(sizeField || '0', 8) || 0
    const typeFlag = header[156]
    const dataStart = offset + 512
    const dataEnd = dataStart + size

    if (typeFlag !== 53 && dataEnd <= bytes.length) {
      entries.push({
        name: normalizeArchiveEntryName(name),
        bytes: bytes.slice(dataStart, dataEnd),
      })
    }

    offset = dataStart + Math.ceil(size / 512) * 512
  }

  return entries
}

async function extractArchiveFiles(file: File): Promise<File[]> {
  const lower = file.name.toLowerCase()
  const rootName = stripArchiveExtension(file.name)

  if (lower.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const extracted: File[] = []
    await Promise.all(
      Object.values(zip.files).map(async (entry) => {
        if (entry.dir) return
        const normalizedName = normalizeArchiveEntryName(entry.name)
        if (!normalizedName) return
        const bytes = await entry.async('uint8array')
        extracted.push(new File([new Uint8Array(bytes)], `${rootName}/${normalizedName}`))
      }),
    )
    return extracted
  }

  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    const gzBytes = new Uint8Array(await file.arrayBuffer())
    const tarBytes = gunzipSync(gzBytes)
    return parseTarEntries(tarBytes)
      .filter((entry) => entry.name)
      .map((entry) => new File([new Uint8Array(entry.bytes)], `${rootName}/${entry.name}`))
  }

  return [file]
}

interface TitleBarProps {
  sidebarWidth: number
  projectItems: Array<{
    id: string
    label: string
    hint: string
    run: () => void
  }>
  commandQuery: string
  onApplyTheme: (themeId: string) => void
  onCreateCheckpoint: () => void
  onOpenExportModal: () => void
  onOpenImportPicker: () => void
  onOpenCommandPalette: () => void
  onSetCommandQuery: (query: string) => void
  onApplyLayoutPreset: (presetId: keyof typeof layoutPresets) => void
  onOpenSettings: () => void
  onDeleteCurrentProject: () => void
  onDeleteAllData: () => void
  onOpenWelcome: () => void
}

function TitleBar({
  sidebarWidth,
  projectItems,
  commandQuery,
  onApplyTheme,
  onCreateCheckpoint,
  onOpenExportModal,
  onOpenImportPicker,
  onOpenCommandPalette,
  onSetCommandQuery,
  onApplyLayoutPreset,
  onOpenSettings,
  onDeleteCurrentProject,
  onDeleteAllData,
  onOpenWelcome,
}: TitleBarProps) {
  const sample = useWorkspaceStore((state) => state.sample)
  const setActiveBottomPanel = useWorkspaceStore((state) => state.setActiveBottomPanel)
  const setActiveRightPanelTab = useWorkspaceStore((state) => state.setActiveRightPanelTab)

  const projectMenu = [
    { id: 'project.checkpoint', label: 'Save checkpoint', hint: 'Local history', run: onCreateCheckpoint },
    { id: 'project.export', label: 'Export project', hint: 'Confirm first', run: onOpenExportModal },
    { id: 'project.import', label: 'Import project', hint: 'JSON bundle', run: onOpenImportPicker },
    { id: 'project.settings', label: 'Open settings', hint: 'Theme + layout', run: onOpenSettings },
  ]

  const viewMenu = [
    { id: 'view.client', label: 'Show client panel', hint: 'Right side', run: () => setActiveRightPanelTab('client') },
    { id: 'view.inspect', label: 'Show inspector', hint: 'Right side', run: () => setActiveRightPanelTab('inspector') },
    { id: 'view.trust', label: 'Show trust panel', hint: 'Right side', run: () => setActiveRightPanelTab('trust') },
    { id: 'view.data', label: 'Open data panel', hint: 'Bottom', run: () => setActiveBottomPanel('data') },
    { id: 'view.history', label: 'Open history panel', hint: 'Bottom', run: () => setActiveBottomPanel('history') },
  ]

  const dataMenu = [
    { id: 'data.delete-project', label: 'Delete current project data', hint: 'Workspace + DB + trust', run: onDeleteCurrentProject },
    { id: 'data.delete-all', label: 'Delete ALL data', hint: 'Clears everything + reloads', run: onDeleteAllData },
  ]

  const layoutMenu = (Object.entries(layoutPresets) as Array<[keyof typeof layoutPresets, (typeof layoutPresets)[keyof typeof layoutPresets]]>).map(([presetId, preset]) => ({
    id: `layout.${presetId}`,
    label: preset.label,
    hint: `${preset.rightPanelTab} / ${preset.bottomPanel}`,
    run: () => onApplyLayoutPreset(presetId),
  }))

  const themeMenu = themes.map((theme) => ({
    id: `theme.${theme.id}`,
    label: theme.name,
    hint: 'workspace theme',
    run: () => onApplyTheme(theme.id),
  }))

  return (
    <div className="relative flex h-8 flex-none items-center gap-3 border-b border-bs-border bg-bs-bg-panel px-3 text-[11px]">
      <div className="flex-none" style={{ width: Math.max(160, sidebarWidth - 12) }}>
        <MenuButton
          label={sample.name}
          title="Switch projects and samples"
          items={projectItems}
          variant="project"
        />
      </div>
      <div className="-ml-[10px] flex items-center gap-1">
        <MenuButton
          label="File"
          title="File actions: import, export, checkpoints, and settings"
          items={projectMenu}
        />
        <MenuButton
          label="Theme"
          title="Switch the workspace color theme"
          items={themeMenu}
        />
        <MenuButton
          label="Layout"
          title="Switch workbench layout presets"
          items={layoutMenu}
        />
        <MenuButton
          label="Panels"
          title="Open and focus major workbench panels"
          items={viewMenu}
        />
        <MenuButton
          label="Data"
          title="Manage or delete stored project data"
          items={dataMenu}
        />
      </div>
      {/* Search — absolutely centered in the full bar */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="pointer-events-auto relative w-[min(460px,42vw)]">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-bs-text-faint">
            <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 fill-none stroke-current">
              <circle cx="7" cy="7" r="4.25" strokeWidth="1.5" />
              <path d="M10.5 10.5 13.5 13.5" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <input
            value={commandQuery}
            onFocus={onOpenCommandPalette}
            onChange={(event) => {
              onSetCommandQuery(event.target.value)
              onOpenCommandPalette()
            }}
            placeholder="Search commands, files, themes, and panels"
            title="Search commands, files, themes, panels, and layout actions"
            className="w-full rounded border border-bs-border bg-bs-bg-sidebar py-1 pl-8 pr-3 text-[11px] text-bs-text outline-none placeholder:text-bs-text-faint focus:border-bs-border-focus"
          />
        </div>
      </div>
      {/* Right: push ℹ️ to far right above the absolute search */}
      <div className="flex flex-1 justify-end">
        <button
          onClick={onOpenWelcome}
          title="About browserver"
          className="flex h-5 w-5 flex-none items-center justify-center rounded-full border border-bs-border text-[10px] font-bold text-bs-text-faint hover:border-bs-accent hover:text-bs-accent"
          aria-label="About browserver"
        >
          i
        </button>
      </div>
    </div>
  )
}

export function App() {
  useFavicon()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const externalDragDepthRef = useRef(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [deleteAllConfirmOpen, setDeleteAllConfirmOpen] = useState(false)
  const [welcomeForceOpen, setWelcomeForceOpen] = useState(false)
  const [projectList, setProjectList] = useState<WorkspaceSnapshot[]>([])
  const [draggedEditorItem, setDraggedEditorItem] = useState<
    | { kind: 'path'; path: string }
    | { kind: 'view'; viewId: EditorViewId }
    | null
  >(null)
  const [hoveredDropPane, setHoveredDropPane] = useState<EditorPaneId | null>(null)
  const [dragCursor, setDragCursor] = useState({ x: 0, y: 0 })
  const [pendingExternalImport, setPendingExternalImport] = useState<PendingExternalImport | null>(null)
  const [pendingArchiveImport, setPendingArchiveImport] = useState<PendingArchiveImport | null>(null)
  const [pendingRunningTabClose, setPendingRunningTabClose] = useState<PendingRunningTabClose | null>(null)
  const [externalFileDragActive, setExternalFileDragActive] = useState(false)
  const sidebarWidth = useLayoutStore((state) => state.sidebarWidth)
  const bottomHeight = useLayoutStore((state) => state.bottomHeight)
  const rightWidth = useLayoutStore((state) => state.rightWidth)
  const showSidebar = useLayoutStore((state) => state.showSidebar)
  const showBottom = useLayoutStore((state) => state.showBottom)
  const showRight = useLayoutStore((state) => state.showRight)
  const resizeSidebarBy = useLayoutStore((state) => state.resizeSidebarBy)
  const resizeBottomBy = useLayoutStore((state) => state.resizeBottomBy)
  const resizeRightBy = useLayoutStore((state) => state.resizeRightBy)
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar)
  const toggleBottom = useLayoutStore((state) => state.toggleBottom)
  const toggleRight = useLayoutStore((state) => state.toggleRight)
  const setSample = useWorkspaceStore((state) => state.setSample)
  const assignFileToPane = useWorkspaceStore((state) => state.assignFileToPane)
  const splitFileToPane = useWorkspaceStore((state) => state.splitFileToPane)
  const openEditorView = useWorkspaceStore((state) => state.openEditorView)
  const reorderOpenFile = useWorkspaceStore((state) => state.reorderOpenFile)
  const setActiveFile = useWorkspaceStore((state) => state.setActiveFile)
  const closeFile = useWorkspaceStore((state) => state.closeFile)
  const closePaths = useWorkspaceStore((state) => state.closePaths)
  const hydrate = useWorkspaceStore((state) => state.hydrate)
  const hydrated = useWorkspaceStore((state) => state.hydrated)
  const sample = useWorkspaceStore((state) => state.sample)
  const files = useWorkspaceStore((state) => state.files)
  const paneFiles = useWorkspaceStore((state) => state.paneFiles)
  const paneTabs = useWorkspaceStore((state) => state.paneTabs)
  const isSplitEditor = paneTabs.secondary.tabs.length > 0 || paneTabs.tertiary.tabs.length > 0
  const activeFilePath = useWorkspaceStore((state) => state.activeFilePath)
  const setActiveBottomPanel = useWorkspaceStore((state) => state.setActiveBottomPanel)
  const importWorkspace = useWorkspaceStore((state) => state.importSnapshot)
  const importExternalFiles = useWorkspaceStore((state) => state.importExternalFiles)
  const hydrateDatabase = useDatabaseStore((state) => state.hydrate)
  const tables = useDatabaseStore((state) => state.tables)
  const importDatabase = useDatabaseStore((state) => state.importSnapshot)
  const hydrateTrust = useTrustStore((state) => state.hydrate)
  const exportTrust = useTrustStore((state) => state.exportSnapshot)
  const importTrust = useTrustStore((state) => state.importSnapshot)
  const hydrateCheckpoints = useCheckpointStore((state) => state.hydrate)
  const createCheckpoint = useCheckpointStore((state) => state.createCheckpoint)
  const hydrateHistory = useHistoryStore((state) => state.hydrate)
  const undo = useHistoryStore((state) => state.undo)
  const redo = useHistoryStore((state) => state.redo)
  const startCurrentServer = useRuntimeStore((state) => state.startCurrentServer)
  const restartCurrentServer = useRuntimeStore((state) => state.restartCurrentServer)
  const stopServer = useRuntimeStore((state) => state.stopServer)
  const runClientFile = useRuntimeStore((state) => state.runClientFile)
  const runPane = useRuntimeStore((state) => state.runPane)
  const stopTabByPath = useRuntimeStore((state) => state.stopTabByPath)
  const isTabRunning = useRuntimeStore((state) => state.isTabRunning)
  const runtimeStatus = useRuntimeStore((state) => state.status)
  const themeId = useThemeStore((state) => state.themeId)
  const applyThemeId = useThemeStore((state) => state.applyThemeId)
  const currentTheme = useThemeStore((state) => state.theme())
  const applyLayout = useLayoutStore((state) => state.applySnapshot)
  const applyRawPreset = useLayoutStore((state) => state.applyPreset)
  const openCommandPalette = useCommandPaletteStore((state) => state.openPalette)
  const commandQuery = useCommandPaletteStore((state) => state.query)
  const setCommandQuery = useCommandPaletteStore((state) => state.setQuery)
  const layoutPresetId = useLayoutStore((state) => state.presetId)
  const layoutState = {
    sidebarWidth,
    bottomHeight,
    rightWidth,
    showSidebar,
    showBottom,
    showRight,
  }
  const syncBrowserYaml = useWorkspaceStore((state) => state.syncBrowserYaml)

  const buildCurrentBundle = (): ProjectBundle => {
    const workspace: WorkspaceSnapshot = {
      id: sample.id,
      name: sample.name,
      serverLanguage: sample.serverLanguage,
      files: files.map(({ path, language, content, updatedAt }) => ({
        path,
        language,
        content,
        updatedAt,
      })),
      updatedAt: Date.now(),
    }
    const database: DatabaseSnapshot = {
      workspaceId: sample.id,
      tables,
      updatedAt: Date.now(),
    }

    return {
      version: 1,
      exportedAt: Date.now(),
      workspace,
      database,
      trust: exportTrust() ?? undefined,
      ui: {
        themeId,
        presetId: layoutPresetId,
        layout: layoutState,
      },
    }
  }

  const exportBundle = () => {
    const bundle = serializeProjectBundle(buildCurrentBundle())

    const blob = new Blob([bundle], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${sample.id}.browserver.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const openImportPicker = () => fileInputRef.current?.click()

  const continueExternalImport = useCallback((incomingFiles: FileList | File[], pane: EditorPaneId, folderName: string | null = null) => {
    const droppedFiles = Array.from(incomingFiles)
    if (droppedFiles.length === 0) return

    const initialNames = droppedFiles.map((file) => (folderName ? `${folderName}/${file.name}` : file.name).replace(/^\/+/, ''))
    const conflictIndex = findFirstImportConflict(initialNames, files.map((file) => file.name))

    if (conflictIndex === -1) {
      void importExternalFiles(
        droppedFiles.map((file, index) => ({ file, name: initialNames[index] ?? file.name })),
        pane,
        null,
      )
      return
    }

    setPendingExternalImport({
      files: droppedFiles,
      pane,
      folderName,
      names: initialNames,
      conflictIndex,
      draftName: baseName(initialNames[conflictIndex] ?? droppedFiles[conflictIndex]?.name ?? ''),
      error: null,
    })
  }, [files, importExternalFiles])

  const requestExternalImport = useCallback((incomingFiles: FileList | File[], pane: EditorPaneId, folderName: string | null = null) => {
    const droppedFiles = Array.from(incomingFiles)
    if (droppedFiles.some((file) => isArchiveFileName(file.name))) {
      setPendingArchiveImport({ files: droppedFiles, pane, folderName })
      return
    }
    continueExternalImport(droppedFiles, pane, folderName)
  }, [continueExternalImport])

  const keepArchiveImport = () => {
    if (!pendingArchiveImport) return
    continueExternalImport(pendingArchiveImport.files, pendingArchiveImport.pane, pendingArchiveImport.folderName)
    setPendingArchiveImport(null)
  }

  const extractArchiveImport = async () => {
    if (!pendingArchiveImport) return
    try {
      const extractedGroups = await Promise.all(pendingArchiveImport.files.map(async (file) => {
        if (!isArchiveFileName(file.name)) return [file]
        return await extractArchiveFiles(file)
      }))
      const extractedFiles = extractedGroups.flat()
      continueExternalImport(extractedFiles, pendingArchiveImport.pane, pendingArchiveImport.folderName)
      setPendingArchiveImport(null)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not extract archive')
    }
  }

  const confirmExternalImportRename = () => {
    if (!pendingExternalImport) return
    const trimmed = pendingExternalImport.draftName.trim().replace(/^\/+/, '')
    if (!trimmed) {
      setPendingExternalImport({ ...pendingExternalImport, error: 'Name is required' })
      return
    }
    if (trimmed.includes('/')) {
      setPendingExternalImport({ ...pendingExternalImport, error: 'Use a file name, not a path' })
      return
    }

    const nextNames = [...pendingExternalImport.names]
    nextNames[pendingExternalImport.conflictIndex] = pendingExternalImport.folderName
      ? `${pendingExternalImport.folderName}/${trimmed}`
      : trimmed

    const nextConflictIndex = findFirstImportConflict(nextNames, files.map((file) => file.name))
    if (nextConflictIndex !== -1) {
      setPendingExternalImport({
        ...pendingExternalImport,
        names: nextNames,
        conflictIndex: nextConflictIndex,
        draftName: baseName(nextNames[nextConflictIndex] ?? ''),
        error: nextConflictIndex === pendingExternalImport.conflictIndex ? 'Name must be unique' : null,
      })
      return
    }

    void importExternalFiles(
      pendingExternalImport.files.map((file, index) => ({
        file,
        name: nextNames[index] ?? file.name,
      })),
      pendingExternalImport.pane,
      null,
    )
    setPendingExternalImport(null)
  }

  const requestClosePaths = useCallback((paths: string[]) => {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)))
    if (uniquePaths.length === 0) return
    const runningPath = uniquePaths.find((path) => isTabRunning(path))
    if (runningPath) {
      setPendingRunningTabClose({
        path: runningPath,
        remainingPaths: uniquePaths.filter((path) => path !== runningPath),
      })
      return
    }

    if (uniquePaths.length === 1) {
      closeFile(uniquePaths[0])
      return
    }
    closePaths(uniquePaths)
  }, [closeFile, closePaths, isTabRunning])

  const requestClosePath = useCallback((path: string) => {
    requestClosePaths([path])
  }, [requestClosePaths])

  const closeRunningTabAndContinue = useCallback(async () => {
    if (!pendingRunningTabClose) return
    await stopTabByPath(pendingRunningTabClose.path)
    closeFile(pendingRunningTabClose.path)
    const remaining = pendingRunningTabClose.remainingPaths
    setPendingRunningTabClose(null)
    if (remaining.length > 0) {
      requestClosePaths(remaining)
    }
  }, [closeFile, pendingRunningTabClose, requestClosePaths, stopTabByPath])

  const leaveRunningTabOpenAndContinue = useCallback(() => {
    if (!pendingRunningTabClose) return
    const remaining = pendingRunningTabClose.remainingPaths
    setPendingRunningTabClose(null)
    if (remaining.length > 0) {
      requestClosePaths(remaining)
    }
  }, [pendingRunningTabClose, requestClosePaths])

  const saveCheckpoint = async (name: string, note?: string) => {
    await createCheckpoint({
      workspaceId: sample.id,
      name,
      note,
      bundle: buildCurrentBundle(),
    })
    setActiveBottomPanel('history')
  }

  const activatePreset = (presetId: keyof typeof layoutPresets) => {
    applyRawPreset(presetId)
    setActiveBottomPanel(layoutPresets[presetId].bottomPanel)
    useWorkspaceStore.getState().setActiveRightPanelTab(layoutPresets[presetId].rightPanelTab)
  }

  const handleDeleteCurrentProject = async () => {
    await deleteProjectData(sample.id)
    // Switch to default sample to reset in-memory state
    const defaultSampleId = samples[0].id
    if (defaultSampleId) {
      await setSample(defaultSampleId)
    }
    void refreshProjects()
  }

  const handleDeleteAllData = async () => {
    // deleteAllBrowserData clears storage and reloads the page
    await deleteAllBrowserData()
  }

  const refreshProjects = async () => {
    const snapshots = await listWorkspaceSnapshots()
    setProjectList(snapshots)
  }

  const createNewProject = async () => {
    const usedIds = new Set([
      ...projectList.map((project) => project.id),
      ...samples.map((entry) => entry.id),
    ])
    let index = 1
    let id = `project-${index}`
    while (usedIds.has(id)) {
      index += 1
      id = `project-${index}`
    }

    const name = `Project ${index}`
    await importWorkspace({
      id,
      name,
      serverLanguage: 'typescript',
      updatedAt: Date.now(),
      files: [
        {
          path: `/${id}/server.ts`,
          language: 'typescript',
          content: [
            "import { serveClientSideServer } from '@modularizer/plat-client/client-server'",
            '',
            'class Api {',
            '  async hello() {',
            '    return { message: "Hello, World!" }',
            '  }',
            '}',
            '',
            "export default serveClientSideServer('api', [Api])",
            '',
          ].join('\n'),
          updatedAt: Date.now(),
        },
      ],
    })
    void refreshProjects()
  }

  const importBundle = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const source = await file.text()
      const bundle = parseProjectBundle(source)
      await importWorkspace(bundle.workspace)
      await importDatabase(bundle.database)
      if (bundle.trust) {
        await importTrust(bundle.trust)
      }
      applyThemeId(bundle.ui.themeId)
      if (bundle.ui.presetId && bundle.ui.presetId !== 'custom' && bundle.ui.presetId in layoutPresets) {
        activatePreset(bundle.ui.presetId)
      } else {
        applyLayout(bundle.ui.layout, bundle.ui.presetId ?? 'custom')
      }
      setActiveBottomPanel('data')
      void refreshProjects()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Could not import project bundle')
    } finally {
      event.target.value = ''
    }
  }

  const commands = useMemo<CommandPaletteItem[]>(() => {
    const base: CommandPaletteItem[] = [
      {
        id: 'runtime.launch',
        title: `Launch ${sample.serverLanguage} runtime`,
        subtitle: sample.name,
        keywords: ['run start server runtime'],
        run: () => void startCurrentServer(),
      },
      {
        id: 'runtime.restart',
        title: 'Restart runtime',
        subtitle: 'Reload the current server source',
        keywords: ['reload'],
        run: () => void restartCurrentServer(),
      },
      {
        id: 'runtime.stop',
        title: 'Stop runtime',
        subtitle: 'Shut down the active browser server',
        keywords: ['halt'],
        run: () => void stopServer(),
      },
      {
        id: 'client.run',
        title: 'Run active client',
        subtitle: activeFilePath || 'Run the selected client.ts against the launched runtime',
        keywords: ['playground invoke test'],
        run: () => void runClientFile(activeFilePath),
      },
      {
        id: 'project.checkpoint',
        title: 'Save checkpoint',
        subtitle: 'Capture the current workspace, data, trust, and layout state',
        keywords: ['snapshot version checkpoint history'],
        run: () => void saveCheckpoint(`Checkpoint ${new Date().toLocaleTimeString()}`),
      },
      {
        id: 'project.export',
        title: 'Export project bundle',
        subtitle: 'Download workspace, data, theme, and layout as JSON',
        keywords: ['download save json'],
        run: exportBundle,
      },
      {
        id: 'project.import',
        title: 'Import project bundle',
        subtitle: 'Load a previously exported browserver JSON bundle',
        keywords: ['upload load json'],
        run: openImportPicker,
      },
      {
        id: 'panel.history',
        title: 'Show history panel',
        subtitle: 'Focus local checkpoints and restore points',
        run: () => setActiveBottomPanel('history'),
      },
      {
        id: 'panel.logs',
        title: 'Show logs panel',
        subtitle: 'Focus the bottom logs view',
        run: () => setActiveBottomPanel('logs'),
      },
      {
        id: 'panel.calls',
        title: 'Show calls panel',
        subtitle: 'Focus the runtime calls list',
        run: () => setActiveBottomPanel('calls'),
      },
      {
        id: 'panel.client',
        title: 'Show client panel',
        subtitle: 'Focus the client playground tab',
        run: () => setActiveBottomPanel('client'),
      },
      {
        id: 'panel.trust',
        title: 'Show trust panel',
        subtitle: 'Focus host identity, known hosts, and authority records',
        run: () => setActiveBottomPanel('trust'),
      },
      {
        id: 'panel.data',
        title: 'Show data panel',
        subtitle: 'Focus the local database explorer',
        run: () => setActiveBottomPanel('data'),
      },
      {
        id: 'panel.build',
        title: 'Show build panel',
        subtitle: 'Focus compiled output and build status',
        run: () => setActiveBottomPanel('build'),
      },
      {
        id: 'panel.problems',
        title: 'Show problems panel',
        subtitle: 'Focus diagnostics and compile issues',
        run: () => setActiveBottomPanel('problems'),
      },
    ]

    const sampleCommands = samples.map<CommandPaletteItem>((entry) => ({
      id: `sample.${entry.id}`,
      title: `Open sample: ${entry.name}`,
      subtitle: entry.description,
      keywords: ['workspace project template'],
      run: () => void setSample(entry.id),
    }))

    const themeCommands = themes.map<CommandPaletteItem>((entry) => ({
      id: `theme.${entry.id}`,
      title: `Switch theme: ${entry.name}`,
      subtitle: entry.id,
      keywords: ['color appearance'],
      run: () => applyThemeId(entry.id),
    }))

    const layoutCommands = (Object.entries(layoutPresets) as Array<[keyof typeof layoutPresets, (typeof layoutPresets)[keyof typeof layoutPresets]]>)
      .map<CommandPaletteItem>(([presetId, preset]) => ({
        id: `layout.${presetId}`,
        title: `Apply layout: ${preset.label}`,
        subtitle: `${preset.rightPanelTab} / ${preset.bottomPanel} / ${preset.snapshot.showBottom ? 'bottom on' : 'bottom off'}`,
        keywords: ['preset workbench'],
        run: () => activatePreset(presetId),
      }))

    return [...base, ...sampleCommands, ...themeCommands, ...layoutCommands]
  }, [
    activeFilePath,
    activatePreset,
    applyThemeId,
    exportBundle,
    layoutPresetId,
    openImportPicker,
    restartCurrentServer,
    runClientFile,
    saveCheckpoint,
    sample,
    setActiveBottomPanel,
    setSample,
    startCurrentServer,
    stopServer,
  ])

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // Restart servers that were running before page refresh
  const hasRestoredServers = useRef(false)
  useEffect(() => {
    if (!hydrated || hasRestoredServers.current) return
    hasRestoredServers.current = true

    let restoredAnyServer = false

    const yamlFile = files.find((f) => f.name === '.browserver.yaml')
    if (yamlFile) {
      try {
        const config = parseBrowserYaml(yamlFile.content)
        const servers = config.runtime?.servers as Record<string, string> | undefined

        if (servers) {
          for (const [pane, filePath] of Object.entries(servers)) {
            if (filePath && (pane === 'primary' || pane === 'secondary' || pane === 'tertiary')) {
              // Ensure the pane has the server file active before running.
              const ws = useWorkspaceStore.getState()
              const fileExists = ws.files.some((f) => f.path === filePath)
              if (fileExists) {
                restoredAnyServer = true
                setActiveFile(filePath, pane as EditorPaneId)
                void runPane(pane as EditorPaneId)
              }
            }
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    // Default sample startup behavior: if no runtime was restored, auto-run primary server tab.
    const isBuiltInSample = samples.some((entry) => entry.id === sample.id)
    if (!restoredAnyServer && isBuiltInSample) {
      void runPane('primary')
    }
  }, [hydrated, files, runPane, sample.id, setActiveFile])

  useEffect(() => {
    void refreshProjects()
  }, [])

  useEffect(() => {
    void hydrateDatabase(sample)
  }, [hydrateDatabase, sample])

  useEffect(() => {
    void hydrateTrust(sample)
  }, [hydrateTrust, sample])

  useEffect(() => {
    void hydrateCheckpoints(sample.id)
  }, [hydrateCheckpoints, sample.id])

  useEffect(() => {
    void hydrateHistory(sample.id).catch((error) => {
      console.error('[history] hydrate failed', error)
    })
  }, [hydrateHistory, sample.id])

  // Keep .browserver.yaml in sync with theme and layout changes
  useEffect(() => {
    if (!hydrated) return
    syncBrowserYaml()
  }, [hydrated, syncBrowserYaml, themeId, sidebarWidth, bottomHeight, rightWidth, showSidebar, showBottom, showRight, runtimeStatus])

  useEffect(() => {
    void refreshProjects()
  }, [sample.id])

  const projectItems = useMemo(() => {
    const seen = new Set<string>()
    const items: Array<{
      id: string
      label: string
      hint: string
      run: () => void
    }> = []

    items.push({
      id: 'project.new',
      label: 'New Project',
      hint: 'Create a blank local project',
      run: () => void createNewProject(),
    })
    items.push({
      id: 'project.import',
      label: 'Import Project',
      hint: 'Load a browserver JSON bundle',
      run: openImportPicker,
    })

    for (const snapshot of projectList) {
      seen.add(snapshot.id)
      items.push({
        id: `project.${snapshot.id}`,
        label: snapshot.name,
        hint: snapshot.id === sample.id ? 'current project' : 'saved project',
        run: () => void setSample(snapshot.id),
      })
    }

    for (const entry of samples) {
      if (seen.has(entry.id)) continue
      items.push({
        id: `sample.${entry.id}`,
        label: entry.name,
        hint: 'built-in sample',
        run: () => void setSample(entry.id),
      })
    }

    return items
  }, [createNewProject, openImportPicker, projectList, sample.id, setSample])

  useEffect(() => {
    applyCssVariables(currentTheme.tokens)
    applyMonacoTheme(currentTheme)
  }, [currentTheme])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isPaletteShortcut = event.key === 'P' && (event.metaKey || event.ctrlKey) && event.shiftKey
      if (!isPaletteShortcut && event.key !== 'F1') return
      event.preventDefault()
      openCommandPalette()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openCommandPalette])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const isMac = /mac/i.test(navigator.platform)
      const saveCombo = key === 's' && (isMac ? event.metaKey : event.ctrlKey) && !event.shiftKey && !event.altKey
      if (!saveCombo || event.repeat) return

      event.preventDefault()
      const ws = useWorkspaceStore.getState()
      const paneActivePath = ws.paneTabs[ws.activeEditorPane].activePath
      const targetPath = paneActivePath ?? ws.activeFilePath
      console.log('[save] ctrl/cmd+s', {
        source: 'window-keydown',
        activeEditorPane: ws.activeEditorPane,
        activeFilePath: ws.activeFilePath,
        paneActivePath,
        targetPath,
      })
      if (!targetPath || getEditorViewId(targetPath)) return
      void ws.saveFile(targetPath)
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      const isMac = /mac/i.test(navigator.platform)
      // Undo
      if (key === 'z' && (isMac ? event.metaKey : event.ctrlKey) && !event.altKey && !event.repeat) {
        event.preventDefault()
        void undo()
        return
      }
      // Redo: Ctrl+Y (Win/Linux) or Shift+Cmd+Z (macOS); also Ctrl+Shift+Z common
      const redoCombo =
        (isMac && key === 'z' && event.metaKey && event.shiftKey) ||
        (!isMac && ((key === 'y' && event.ctrlKey) || (key === 'z' && event.ctrlKey && event.shiftKey)))
      if (redoCombo && !event.altKey && !event.repeat) {
        event.preventDefault()
        void redo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [redo, undo])

  useEffect(() => {
    if (!draggedEditorItem) return

    const clearDrag = () => {
      if (draggedEditorItem && hoveredDropPane) {
        if (draggedEditorItem.kind === 'path') {
          splitFileToPane(hoveredDropPane, draggedEditorItem.path)
        } else {
          openEditorView(draggedEditorItem.viewId, hoveredDropPane)
        }
      }
      setDraggedEditorItem(null)
      setHoveredDropPane(null)
    }
    window.addEventListener('mouseup', clearDrag)
    return () => window.removeEventListener('mouseup', clearDrag)
  }, [draggedEditorItem, hoveredDropPane, openEditorView, splitFileToPane])

  useEffect(() => {
    if (!draggedEditorItem) return

    const updateCursor = (event: MouseEvent) => {
      setDragCursor({ x: event.clientX, y: event.clientY })
    }

    window.addEventListener('mousemove', updateCursor)
    return () => window.removeEventListener('mousemove', updateCursor)
  }, [draggedEditorItem])

  useEffect(() => {
    const onNativeDragEnter: EventListener = (rawEvent) => {
      const event = rawEvent as DragEvent
      if (!hasExternalFiles(event.dataTransfer)) return
      externalDragDepthRef.current += 1
      console.log('[browserver] native external file dragenter', {
        types: Array.from(event.dataTransfer?.types ?? []),
        fileCount: event.dataTransfer?.files.length ?? 0,
      })
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
      setExternalFileDragActive(true)
    }

    const onNativeDragOver: EventListener = (rawEvent) => {
      const event = rawEvent as DragEvent
      if (!hasExternalFiles(event.dataTransfer)) return
      event.preventDefault()
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy'
      }
      if (!externalFileDragActive) {
        console.log('[browserver] native external file dragover', {
          types: Array.from(event.dataTransfer?.types ?? []),
          fileCount: event.dataTransfer?.files.length ?? 0,
        })
      }
      setExternalFileDragActive(true)
    }

    const clearNativeExternalDrag = () => {
      externalDragDepthRef.current = 0
      setExternalFileDragActive(false)
    }

    const onNativeDragLeave: EventListener = (rawEvent) => {
      const event = rawEvent as DragEvent
      if (!hasExternalFiles(event.dataTransfer)) return
      externalDragDepthRef.current = Math.max(0, externalDragDepthRef.current - 1)
      console.log('[browserver] native external file dragleave', {
        depth: externalDragDepthRef.current,
      })
      if (externalDragDepthRef.current === 0) {
        clearNativeExternalDrag()
      }
      event.preventDefault()
    }

    const onNativeDrop: EventListener = (rawEvent) => {
      const event = rawEvent as DragEvent
      if (!hasExternalFiles(event.dataTransfer)) return
      console.log('[browserver] native external file drop', {
        types: Array.from(event.dataTransfer?.types ?? []),
        fileCount: event.dataTransfer?.files.length ?? 0,
      })
      event.preventDefault()
      clearNativeExternalDrag()
    }

    window.addEventListener('dragenter', onNativeDragEnter, { capture: true, passive: false })
    window.addEventListener('dragover', onNativeDragOver, { capture: true, passive: false })
    window.addEventListener('dragleave', onNativeDragLeave, { capture: true, passive: false })
    window.addEventListener('drop', onNativeDrop, { capture: true, passive: false })

    return () => {
      window.removeEventListener('dragenter', onNativeDragEnter, true)
      window.removeEventListener('dragover', onNativeDragOver, true)
      window.removeEventListener('dragleave', onNativeDragLeave, true)
      window.removeEventListener('drop', onNativeDrop, true)
    }
  }, [externalFileDragActive])

  const draggedItemLabel = useMemo(() => {
    if (!draggedEditorItem) return null
    if (draggedEditorItem.kind === 'path') {
      return getEditorItemLabel(draggedEditorItem.path, files, useWorkspaceStore.getState().viewTitles)
    }
    return editorViewDefinitions.find((view) => view.id === draggedEditorItem.viewId)?.label ?? draggedEditorItem.viewId
  }, [draggedEditorItem, files])

  return (
    <div
      className={`flex h-full flex-col bg-bs-bg text-bs-text ${
        externalFileDragActive ? 'shadow-[inset_0_0_0_2px_var(--bs-border-focus)]' : ''
      }`}
    >
      <TitleBar
        sidebarWidth={sidebarWidth}
        projectItems={projectItems}
        commandQuery={commandQuery}
        onApplyTheme={applyThemeId}
        onCreateCheckpoint={() => void saveCheckpoint(`Checkpoint ${new Date().toLocaleTimeString()}`)}
        onOpenExportModal={() => setExportModalOpen(true)}
        onOpenImportPicker={openImportPicker}
        onOpenCommandPalette={openCommandPalette}
        onSetCommandQuery={setCommandQuery}
        onApplyLayoutPreset={activatePreset}
        onOpenSettings={() => setSettingsOpen(true)}
        onDeleteCurrentProject={() => void handleDeleteCurrentProject()}
        onDeleteAllData={() => setDeleteAllConfirmOpen(true)}
        onOpenWelcome={() => setWelcomeForceOpen(true)}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(event) => void importBundle(event)}
      />
      <div className="flex min-h-0 flex-1">
        <>
          {showSidebar ? (
            <>
              <div className="min-w-0 flex-none border-r border-bs-border" style={{ width: sidebarWidth }}>
                <Sidebar onImportExternalFiles={requestExternalImport} />
              </div>
              <Resizer
                direction="horizontal"
                onResize={resizeSidebarBy}
              />
            </>
          ) : (
            <div className="flex w-6 flex-none border-r border-bs-border bg-bs-bg-panel">
              <button
                onClick={toggleSidebar}
                className="flex h-full w-full items-start justify-center pt-2 hover:bg-bs-bg-hover"
                aria-label="Restore left panel"
                title="Restore left panel"
              >
                <span className="rounded px-1 py-0.5 text-[11px] text-bs-text-faint hover:text-bs-text">›</span>
              </button>
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="relative flex min-h-0 flex-1 flex-col">
                  {!isSplitEditor ? (
                    <TabBar
                      onStartTabDrag={(path) => {
                        setDraggedEditorItem({ kind: 'path', path })
                        setHoveredDropPane(null)
                      }}
                      onReorderTab={(path, beforePath) => {
                        reorderOpenFile(path, beforePath)
                      }}
                      onEndTabDrag={() => {
                        setDraggedEditorItem(null)
                        setHoveredDropPane(null)
                      }}
                      onRequestClosePath={requestClosePath}
                      onRequestClosePaths={requestClosePaths}
                    />
                  ) : null}
                  <div className="min-h-0 flex-1 bg-bs-bg-editor">
                    <Editor
                      onImportExternalFiles={requestExternalImport}
                      onStartTabDrag={(path) => {
                        setDraggedEditorItem({ kind: 'path', path })
                        setHoveredDropPane(null)
                      }}
                      onReorderTab={(path, beforePath) => {
                        reorderOpenFile(path, beforePath)
                      }}
                      onEndTabDrag={() => {
                        setDraggedEditorItem(null)
                        setHoveredDropPane(null)
                      }}
                      dragPreviewPaneCount={
                        draggedEditorItem
                          ? Math.min(
                              3,
                              2 + Number(paneTabs.secondary.tabs.length > 0) + Number(paneTabs.tertiary.tabs.length > 0),
                            )
                          : 0
                      }
                      hoveredDropPane={hoveredDropPane}
                      onHoverDropPane={setHoveredDropPane}
                      onLeaveDropPane={() => setHoveredDropPane(null)}
                      onDropToPane={(pane) => {
                        if (!draggedEditorItem) return
                        if (draggedEditorItem.kind === 'path') {
                          splitFileToPane(pane, draggedEditorItem.path)
                        } else {
                          openEditorView(draggedEditorItem.viewId, pane)
                        }
                        setDraggedEditorItem(null)
                        setHoveredDropPane(null)
                      }}
                      onRequestClosePath={requestClosePath}
                      onRequestClosePaths={requestClosePaths}
                    />
                  </div>
                </div>

                {showBottom ? (
                  <>
                    <Resizer
                      direction="vertical"
                      onResize={(delta) => resizeBottomBy(-delta)}
                    />
                    <div
                      className="flex-none border-t border-bs-border"
                      style={{ height: bottomHeight }}
                    >
                      <BottomPanel
                        onCreateCheckpoint={saveCheckpoint}
                        onStartTabDrag={(viewId) => {
                          setDraggedEditorItem({ kind: 'view', viewId })
                          setHoveredDropPane(null)
                        }}
                        onEndTabDrag={() => {
                          setDraggedEditorItem(null)
                          setHoveredDropPane(null)
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="h-[26px] flex-none border-t border-bs-border">
                    <BottomPanel
                      onCreateCheckpoint={saveCheckpoint}
                      collapsed
                      onRestore={toggleBottom}
                      onStartTabDrag={(viewId) => {
                        setDraggedEditorItem({ kind: 'view', viewId })
                        setHoveredDropPane(null)
                      }}
                      onEndTabDrag={() => {
                        setDraggedEditorItem(null)
                        setHoveredDropPane(null)
                      }}
                    />
                  </div>
                )}
              </div>

              {showRight ? (
                <>
                  <Resizer
                    direction="horizontal"
                    onResize={(delta) => resizeRightBy(-delta)}
                  />
                  <div className="min-w-0 flex-none border-l border-bs-border" style={{ width: rightWidth }}>
                    <RightPanel
                      onStartTabDrag={(viewId) => {
                        setDraggedEditorItem({ kind: 'view', viewId })
                        setHoveredDropPane(null)
                      }}
                      onEndTabDrag={() => {
                        setDraggedEditorItem(null)
                        setHoveredDropPane(null)
                      }}
                    />
                  </div>
                </>
              ) : (
                <div className="flex w-6 flex-none border-l border-bs-border bg-bs-bg-panel">
                  <button
                    onClick={toggleRight}
                    className="flex h-full w-full items-start justify-center pt-2 hover:bg-bs-bg-hover"
                    aria-label="Restore right panel"
                    title="Restore right panel"
                  >
                    <span className="rounded px-1 py-0.5 text-[11px] text-bs-text-faint hover:text-bs-text">‹</span>
                  </button>
                </div>
              )}
            </div>
            <StatusBar />
          </div>
        </>
      </div>
      <CommandPalette commands={commands} />
      <WelcomeModal forceOpen={welcomeForceOpen} onForceClose={() => setWelcomeForceOpen(false)} />
      <Modal
        open={pendingRunningTabClose !== null}
        title="Close Running Tab"
        onClose={() => setPendingRunningTabClose(null)}
        actions={(
          <>
            <button
              onClick={leaveRunningTabOpenAndContinue}
              className="rounded border border-bs-border bg-bs-bg-panel px-3 py-1 text-bs-text-muted hover:text-bs-text"
            >
              Leave Open and Running
            </button>
            <button
              onClick={() => void closeRunningTabAndContinue()}
              className="rounded bg-bs-accent px-3 py-1 text-bs-accent-text"
            >
              Stop and Close
            </button>
          </>
        )}
      >
        {pendingRunningTabClose ? (
          <div className="space-y-2 text-[12px] text-bs-text-muted">
            <div>
              <span className="text-bs-text">{getEditorItemLabel(pendingRunningTabClose.path, files, useWorkspaceStore.getState().viewTitles)}</span> is currently running.
            </div>
            <div>Choose whether to stop its runtime before closing this tab.</div>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={exportModalOpen}
        title="Export Project"
        onClose={() => setExportModalOpen(false)}
        actions={(
          <>
            <button
              onClick={() => setExportModalOpen(false)}
              className="rounded border border-bs-border bg-bs-bg-panel px-3 py-1 text-bs-text-muted hover:text-bs-text"
            >
              cancel
            </button>
            <button
              onClick={() => {
                setExportModalOpen(false)
                exportBundle()
              }}
              className="rounded bg-bs-accent px-3 py-1 text-bs-accent-text"
            >
              export json
            </button>
          </>
        )}
      >
        <div className="text-sm text-bs-text">Export the current project bundle?</div>
        <div className="mt-2 text-[11px] text-bs-text-muted">
          This will download workspace files, local data, trust state, theme, and layout as one browser-owned JSON bundle.
        </div>
      </Modal>
      <Modal
        open={settingsOpen}
        title="Workbench Settings"
        onClose={() => setSettingsOpen(false)}
        actions={(
          <button
            onClick={() => setSettingsOpen(false)}
            className="rounded bg-bs-accent px-3 py-1 text-bs-accent-text"
          >
            done
          </button>
        )}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-bs-text-faint">Theme</div>
            <div className="flex flex-wrap gap-1">
              {themes.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => applyThemeId(entry.id)}
                  className={`rounded px-2 py-1 text-[11px] ${
                    themeId === entry.id
                      ? 'bg-bs-accent text-bs-accent-text'
                      : 'bg-bs-bg-hover text-bs-text-muted hover:text-bs-text'
                  }`}
                >
                  {entry.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-bs-text-faint">Layout Presets</div>
            <div className="flex flex-wrap gap-1">
              {(Object.entries(layoutPresets) as Array<[keyof typeof layoutPresets, (typeof layoutPresets)[keyof typeof layoutPresets]]>).map(([presetId, preset]) => (
                <button
                  key={presetId}
                  onClick={() => activatePreset(presetId)}
                  className={`rounded px-2 py-1 text-[11px] ${
                    layoutPresetId === presetId
                      ? 'bg-bs-accent text-bs-accent-text'
                      : 'bg-bs-bg-hover text-bs-text-muted hover:text-bs-text'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-bs-text-faint">Panels</div>
            <div className="flex flex-wrap gap-1">
              <button onClick={toggleSidebar} className="rounded bg-bs-bg-hover px-2 py-1 text-[11px] text-bs-text-muted hover:text-bs-text">
                {showSidebar ? 'hide sidebar' : 'show sidebar'}
              </button>
              <button onClick={toggleBottom} className="rounded bg-bs-bg-hover px-2 py-1 text-[11px] text-bs-text-muted hover:text-bs-text">
                {showBottom ? 'hide bottom' : 'show bottom'}
              </button>
              <button onClick={toggleRight} className="rounded bg-bs-bg-hover px-2 py-1 text-[11px] text-bs-text-muted hover:text-bs-text">
                {showRight ? 'hide right' : 'show right'}
              </button>
            </div>
          </div>
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-[0.16em] text-bs-text-faint">Notes</div>
            <div className="text-[11px] text-bs-text-muted">
              Project import/export and checkpoint restore still keep their own explicit actions so they are harder to trigger accidentally.
            </div>
          </div>
        </div>
      </Modal>
      <Modal
        open={pendingArchiveImport !== null}
        title="Archive Import"
        onClose={() => setPendingArchiveImport(null)}
        actions={(
          <>
            <button
              onClick={() => setPendingArchiveImport(null)}
              className="rounded bg-bs-bg-hover px-3 py-1 text-bs-text-muted hover:text-bs-text"
            >
              cancel
            </button>
            <button
              onClick={keepArchiveImport}
              className="rounded bg-bs-bg-hover px-3 py-1 text-bs-text hover:bg-bs-bg-active"
            >
              keep zipped
            </button>
            <button
              onClick={() => void extractArchiveImport()}
              className="rounded bg-bs-accent px-3 py-1 text-bs-accent-text"
            >
              extract
            </button>
          </>
        )}
      >
        {pendingArchiveImport ? (
          <div className="space-y-3">
            <div className="text-[11px] text-bs-text-muted">
              Archive files were dropped. Do you want to keep them as archive files or extract their contents into the workspace?
            </div>
            <div className="rounded border border-bs-border bg-bs-bg-sidebar px-3 py-2 text-[11px] text-bs-text-faint">
              {pendingArchiveImport.files.map((file) => file.name).join(', ')}
            </div>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={pendingExternalImport !== null}
        title="Rename Dropped File"
        onClose={() => setPendingExternalImport(null)}
        actions={(
          <>
            <button
              onClick={() => setPendingExternalImport(null)}
              className="rounded bg-bs-bg-hover px-3 py-1 text-bs-text-muted hover:text-bs-text"
            >
              cancel
            </button>
            <button
              onClick={confirmExternalImportRename}
              className="rounded bg-bs-accent px-3 py-1 text-bs-accent-text"
            >
              import
            </button>
          </>
        )}
      >
        {pendingExternalImport ? (
          <div className="space-y-3">
            <div className="text-[11px] text-bs-text-muted">
              A file named <span className="text-bs-text">{pendingExternalImport.names[pendingExternalImport.conflictIndex]}</span> already exists. Choose a unique name to continue.
            </div>
            <input
              autoFocus
              value={pendingExternalImport.draftName}
              onChange={(event) => setPendingExternalImport({
                ...pendingExternalImport,
                draftName: event.target.value,
                error: null,
              })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  confirmExternalImportRename()
                }
              }}
              className="w-full rounded border border-bs-border bg-bs-bg-editor px-3 py-2 text-[12px] text-bs-text outline-none focus:border-bs-border-focus"
            />
            {pendingExternalImport.error ? (
              <div className="text-[11px] text-bs-error">{pendingExternalImport.error}</div>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={deleteAllConfirmOpen}
        title="Delete All Data"
        onClose={() => setDeleteAllConfirmOpen(false)}
        actions={(
          <>
            <button
              onClick={() => setDeleteAllConfirmOpen(false)}
              className="rounded bg-bs-bg-hover px-3 py-1 text-bs-text-muted hover:text-bs-text"
            >
              cancel
            </button>
            <button
              onClick={() => {
                setDeleteAllConfirmOpen(false)
                void handleDeleteAllData()
              }}
              className="rounded bg-bs-error px-3 py-1 text-bs-accent-text"
            >
              delete everything &amp; reload
            </button>
          </>
        )}
      >
        <div className="space-y-2 text-[12px]">
          <div className="text-bs-text font-medium">This will permanently erase all browserver data.</div>
          <div className="text-bs-text-muted">
            All projects, databases, checkpoints, trust records, and settings stored in this browser will be deleted. The page will reload and appear as a fresh install.
          </div>
          <div className="rounded border border-bs-error/40 bg-bs-error/10 px-3 py-2 text-[11px] text-bs-error">
            This cannot be undone.
          </div>
        </div>
      </Modal>
      {draggedEditorItem && draggedItemLabel ? (
        <div
          className="pointer-events-none fixed z-[80] rounded border border-bs-border bg-bs-bg-panel/95 px-2 py-1 text-[11px] text-bs-text shadow-lg backdrop-blur-sm"
          style={{ left: dragCursor.x + 14, top: dragCursor.y + 16 }}
        >
          {draggedItemLabel}
        </div>
      ) : null}
    </div>
  )
}
