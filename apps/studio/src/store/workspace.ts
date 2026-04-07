 import { create } from 'zustand'
import {
  loadWorkspaceSnapshot,
  saveWorkspaceSnapshot,
  type WorkspaceSnapshot,
  type StoredWorkspaceFile,
  StoredWorkspaceLanguage,
} from '@browserver/storage'
import { samples, type Sample, type SampleFile } from '../samples'
import { useHistoryStore } from './history'
import { useLayoutStore } from './layout'
import { useThemeStore } from '../theme'

export interface WorkspaceFile extends StoredWorkspaceFile {
  name: string
}

export type BottomPanelId = 'logs' | 'calls' | 'build' | 'problems' | 'client' | 'data' | 'trust' | 'history'
export type WorkbenchPanelId = 'sidebar' | 'editor' | 'inspector' | 'bottom'
export type EditorPaneId = 'primary' | 'secondary' | 'tertiary'
export type RightPanelTabId = 'inspector' | 'client' | 'trust'
export type EditorViewId =
  | 'inspect'
  | 'api'
  | 'client'
  | 'swagger'
  | 'redoc'
  | 'data'
  | 'trust'
  | 'history'
  | 'logs'
  | 'calls'
  | 'build'
  | 'problems'
export interface EditorPaneTabs {
  tabs: string[]
  activePath: string | null
}
export type EditorPaneTabState = Record<EditorPaneId, EditorPaneTabs>
export interface EditorPaneAssignments {
  primary: string
  secondary: string | null
  tertiary: string | null
}
export interface WorkspaceEditorSession {
  folders?: string[]
  openFilePaths: string[]
  paneTabs?: EditorPaneTabState
  paneFiles: EditorPaneAssignments
  activeEditorPane: EditorPaneId
  activeFilePath: string
  activeBottomPanel: BottomPanelId
  activeRightPanelTab: RightPanelTabId
  viewTitles?: Record<string, string>
}

export const editorViewDefinitions: Array<{ id: EditorViewId; label: string }> = [
  { id: 'inspect', label: 'Inspect' },
  { id: 'api', label: 'API' },
  { id: 'data', label: 'Data' },
  { id: 'trust', label: 'Trust' },
  { id: 'history', label: 'History' },
  { id: 'logs', label: 'Logs' },
  { id: 'calls', label: 'Calls' },
  { id: 'build', label: 'Build' },
  { id: 'problems', label: 'Problems' },
]

interface WorkspaceState {
  // Sync a .browserver.yaml config reflecting UI/theme/layout
  syncBrowserYaml: () => void,
  hydrated: boolean
  sample: Sample
  files: WorkspaceFile[]
  folders: string[]
  openFilePaths: string[]
  dirtyFilePaths: string[]
  saveState: 'idle' | 'saving' | 'saved'
  saveError: string | null
  paneTabs: EditorPaneTabState
  paneFiles: EditorPaneAssignments
  activeEditorPane: EditorPaneId
  activeFilePath: string
  activeBottomPanel: BottomPanelId
  activePanel: WorkbenchPanelId
  activeRightPanelTab: RightPanelTabId
  viewTitles: Record<string, string>
  renamingPath: string | null
  renamingFolderPath: string | null
  editorSession: () => WorkspaceEditorSession
  hydrate: () => Promise<void>
  setSample: (id: string) => Promise<void>
  importSnapshot: (snapshot: WorkspaceSnapshot) => Promise<void>
  restoreEditorSession: (session: WorkspaceEditorSession | null | undefined) => void
  openEditorView: (viewId: EditorViewId, pane?: EditorPaneId) => void
  createFile: (pane?: EditorPaneId) => void
  createFolder: (pane?: EditorPaneId) => void
  startRenaming: (path: string) => void
  startRenamingFolder: (folderPath: string) => void
  cancelRenaming: () => void
  renameFile: (path: string, nextName: string) => boolean
  renameFolder: (folderPath: string, nextName: string) => boolean
  deleteFile: (path: string) => boolean
  deleteFolder: (folderPath: string) => boolean
  moveFileToFolder: (path: string, folderName: string | null) => boolean
  moveFolderToFolder: (folderName: string, destinationFolderName: string | null) => boolean
  importExternalFiles: (files: FileList | Array<File | { file: File; name: string }>, pane?: EditorPaneId, folderName?: string | null) => Promise<void>
  setActiveFile: (path: string, pane?: EditorPaneId) => void
  splitFileToPane: (pane: EditorPaneId, path: string) => void
  assignFileToPane: (pane: EditorPaneId, path: string | null) => void
  focusEditorPane: (pane: EditorPaneId) => void
  reorderOpenFile: (path: string, beforePath: string) => void
  closeFile: (path: string) => void
  closePaths: (paths: string[]) => void
  setActiveBottomPanel: (panel: BottomPanelId) => void
  setActivePanel: (panel: WorkbenchPanelId) => void
  setActiveRightPanelTab: (tab: RightPanelTabId) => void
  updateFileContent: (path: string, content: string) => void
  saveFile: (path: string, message?: string) => Promise<void>
}

const saveTimers = new Map<string, number>()
const ACTIVE_WORKSPACE_KEY = 'browserver:active-workspace'
const editorPaneOrder: EditorPaneId[] = ['primary', 'secondary', 'tertiary']
const WORKSPACE_UI_KEY_PREFIX = 'browserver:workspace-ui:'

function toPath(sampleId: string, fileName: string): string {
  return `/${sampleId}/${fileName}`
}

export function editorViewPath(viewId: EditorViewId, instanceId = crypto.randomUUID()): string {
  return `view://${viewId}#${instanceId}`
}

export function getEditorViewId(path: string | null | undefined): EditorViewId | null {
  if (!path?.startsWith('view://')) return null

  const candidate = path.slice('view://'.length).split('#')[0] ?? ''
  return editorViewDefinitions.some((view) => view.id === candidate)
    ? (candidate as EditorViewId)
    : null
}

export function isEditorViewPath(path: string | null | undefined): path is string {
  return getEditorViewId(path) !== null
}

export function getEditorItemLabel(path: string, files: WorkspaceFile[], viewTitles: Record<string, string> = {}): string {
  const viewId = getEditorViewId(path)
  if (viewId) {
    return viewTitles[path] ?? editorViewDefinitions.find((view) => view.id === viewId)?.label ?? viewId
  }

  return files.find((file) => file.path === path)?.name ?? fileNameFromPath(path)
}

export function getEditorItemLabels(paths: string[], files: WorkspaceFile[], viewTitles: Record<string, string> = {}): Record<string, string> {
  const baseLabels = new Map<string, string>()
  const counts = new Map<string, number>()

  for (const path of paths) {
    const baseLabel = getEditorItemLabel(path, files, viewTitles)
    baseLabels.set(path, baseLabel)
    counts.set(baseLabel, (counts.get(baseLabel) ?? 0) + 1)
  }

  const seen = new Map<string, number>()
  const labels: Record<string, string> = {}

  for (const path of paths) {
    const baseLabel = baseLabels.get(path) ?? path
    if ((counts.get(baseLabel) ?? 0) <= 1) {
      labels[path] = baseLabel
      continue
    }

    const index = (seen.get(baseLabel) ?? 0) + 1
    seen.set(baseLabel, index)
    labels[path] = `${baseLabel} (${index})`
  }

  return labels
}

function buildViewTitle(viewId: EditorViewId, existingPaths: string[], viewTitles: Record<string, string>): string {
  const baseLabel = editorViewDefinitions.find((view) => view.id === viewId)?.label ?? viewId
  const sameKindCount = existingPaths.filter((path) => getEditorViewId(path) === viewId).length
  const explicitCount = Object.entries(viewTitles).filter(([path]) => getEditorViewId(path) === viewId).length
  const nextIndex = Math.max(sameKindCount, explicitCount) + 1
  return `${baseLabel} (${nextIndex})`
}

function buildUntitledFileName(files: WorkspaceFile[]): string {
  const used = new Set(files.map((file) => file.name))
  let index = 1
  while (used.has(`untitled-${index}.ts`)) {
    index += 1
  }
  return `untitled-${index}.ts`
}

function buildUntitledFolderPath(files: WorkspaceFile[]): string {
  const used = new Set(files.map((file) => file.name))
  let index = 1
  while (used.has(`folder-${index}/index.ts`)) {
    index += 1
  }
  return `folder-${index}/index.ts`
}

function normalizeImportedFileName(files: WorkspaceFile[], requestedName: string): string {
  const cleaned = requestedName.replace(/^\/+/, '').trim() || 'untitled.txt'
  if (!files.some((file) => file.name === cleaned)) return cleaned

  const slashIndex = cleaned.lastIndexOf('/')
  const folderPrefix = slashIndex >= 0 ? `${cleaned.slice(0, slashIndex)}/` : ''
  const leafName = slashIndex >= 0 ? cleaned.slice(slashIndex + 1) : cleaned
  const extensionIndex = leafName.lastIndexOf('.')
  const stem = extensionIndex > 0 ? leafName.slice(0, extensionIndex) : leafName
  const extension = extensionIndex > 0 ? leafName.slice(extensionIndex) : ''

  let index = 2
  let candidate = `${folderPrefix}${stem}-${index}${extension}`
  while (files.some((file) => file.name === candidate)) {
    index += 1
    candidate = `${folderPrefix}${stem}-${index}${extension}`
  }
  return candidate
}

function languageFromFileName(name: string): StoredWorkspaceFile['language'] {
  const lower = name.toLowerCase()
  if (lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'archive'
  if (lower.endsWith('.xlsx')) return 'xlsx'
  if (lower.endsWith('.csv')) return 'csv'
  if (lower.endsWith('.pdf')) return 'pdf'
  if (
    lower.endsWith('.mp4')
    || lower.endsWith('.webm')
    || lower.endsWith('.mov')
    || lower.endsWith('.m4v')
    || lower.endsWith('.ogv')
  ) return 'video'
  if (
    lower.endsWith('.png')
    || lower.endsWith('.jpg')
    || lower.endsWith('.jpeg')
    || lower.endsWith('.webp')
    || lower.endsWith('.gif')
    || lower.endsWith('.bmp')
    || lower.endsWith('.ico')
    || lower.endsWith('.avif')
  ) return 'image'
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript'
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript'
  if (lower.endsWith('.json') || lower.endsWith('.ipynb')) return 'json'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.less')) return 'css'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.py')) return 'python'
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'yaml'
  return 'plaintext'
}

function isUniqueFileName(files: WorkspaceFile[], currentPath: string, nextName: string): boolean {
  return !files.some((file) => file.path !== currentPath && file.name === nextName)
}

function baseName(name: string): string {
  const parts = name.split('/')
  return parts[parts.length - 1] ?? name
}

function isRasterImageName(name: string): boolean {
  return languageFromFileName(name) === 'image'
}

function isPdfName(name: string): boolean {
  return languageFromFileName(name) === 'pdf'
}

function isXlsxName(name: string): boolean {
  return languageFromFileName(name) === 'xlsx'
}

function isArchiveName(name: string): boolean {
  return languageFromFileName(name) === 'archive'
}

function isVideoName(name: string): boolean {
  return languageFromFileName(name) === 'video'
}

function readImportedFileContent(file: File, requestedName: string): Promise<string> {
  if (
    !isRasterImageName(requestedName || file.name)
    && !isVideoName(requestedName || file.name)
    && !isPdfName(requestedName || file.name)
    && !isXlsxName(requestedName || file.name)
    && !isArchiveName(requestedName || file.name)
  ) {
    return file.text()
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

function parentFolderName(name: string): string | null {
  const parts = name.split('/')
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join('/')
}

function fileNamesAreUnique(
  files: WorkspaceFile[],
  renameMap: Map<string, string>,
): boolean {
  const nextNames = new Set<string>()
  for (const file of files) {
    const nextName = renameMap.get(file.name) ?? file.name
    if (nextNames.has(nextName)) return false
    nextNames.add(nextName)
  }
  return true
}

function renameWorkspaceFiles(
  state: WorkspaceState,
  renameMap: Map<string, string>,
) {
  const pathMap = new Map<string, string>()
  for (const [oldName, nextName] of renameMap.entries()) {
    pathMap.set(toPath(state.sample.id, oldName), toPath(state.sample.id, nextName))
  }

  const files = state.files.map((file) => {
    const nextName = renameMap.get(file.name)
    if (!nextName) return file
    return {
      ...file,
      path: toPath(state.sample.id, nextName),
      name: nextName,
      updatedAt: Date.now(),
    }
  })
  const sample = {
    ...state.sample,
    files: state.sample.files.map((file) => {
      const nextName = renameMap.get(file.name)
      return nextName ? ({ ...file, name: nextName } satisfies SampleFile) : file
    }),
  }
  const remapPath = (path: string | null) => (path ? (pathMap.get(path) ?? path) : null)
  const openFilePaths = state.openFilePaths.map((path) => remapPath(path) ?? path)
  const paneTabs = normalizePaneTabs({
    primary: {
      tabs: state.paneTabs.primary.tabs.map((path) => remapPath(path) ?? path),
      activePath: remapPath(state.paneTabs.primary.activePath),
    },
    secondary: {
      tabs: state.paneTabs.secondary.tabs.map((path) => remapPath(path) ?? path),
      activePath: remapPath(state.paneTabs.secondary.activePath),
    },
    tertiary: {
      tabs: state.paneTabs.tertiary.tabs.map((path) => remapPath(path) ?? path),
      activePath: remapPath(state.paneTabs.tertiary.activePath),
    },
  }, remapPath(state.paneFiles.primary) ?? state.paneFiles.primary)
  const paneFiles = {
    primary: derivePaneAssignments(paneTabs, remapPath(state.paneFiles.primary) ?? state.paneFiles.primary).primary,
    secondary: derivePaneAssignments(paneTabs, remapPath(state.paneFiles.primary) ?? state.paneFiles.primary).secondary,
    tertiary: derivePaneAssignments(paneTabs, remapPath(state.paneFiles.primary) ?? state.paneFiles.primary).tertiary,
  }
  const activeFilePath = remapPath(state.activeFilePath) ?? state.activeFilePath
  const dirtyFilePaths = state.dirtyFilePaths.map((path) => remapPath(path) ?? path)
  const viewTitles = Object.fromEntries(
    Object.entries(state.viewTitles).map(([path, title]) => [remapPath(path) ?? path, title]),
  )
  const renamingPath = remapPath(state.renamingPath)

  return {
    hydrated: state.hydrated,
    sample,
    files,
    folders: state.folders,
    openFilePaths,
    dirtyFilePaths,
    saveState: 'saving' as const,
    paneTabs,
    paneFiles,
    activeEditorPane: state.activeEditorPane,
    activeFilePath,
    activeBottomPanel: state.activeBottomPanel,
    activePanel: state.activePanel,
    activeRightPanelTab: state.activeRightPanelTab,
    viewTitles,
    renamingPath,
    renamingFolderPath: state.renamingFolderPath,
  }
}

function fileNameFromPath(path: string): string {
  if (!path.startsWith('/')) return path
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 1) return parts[0] ?? path
  return parts.slice(1).join('/')
}

function sampleToSnapshot(sample: Sample): WorkspaceSnapshot {
  const now = Date.now()

  return {
    id: sample.id,
    name: sample.name,
    serverLanguage: sample.serverLanguage,
    updatedAt: now,
    files: sample.files.map((file) => ({
      path: toPath(sample.id, file.name),
      language: file.language,
      content: file.content,
      updatedAt: now,
    })),
  }
}

function snapshotToFiles(snapshot: WorkspaceSnapshot): WorkspaceFile[] {
  return snapshot.files.map((file) => ({
    ...file,
    name: fileNameFromPath(file.path),
  }))
}

function mergeSampleSnapshot(sample: Sample, snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const fileMap = new Map(snapshot.files.map((file) => [fileNameFromPath(file.path), file]))
  const now = Date.now()

  const mergedFiles: StoredWorkspaceFile[] = sample.files.map((file) => {
    const persisted = fileMap.get(file.name)

    return {
      path: toPath(sample.id, file.name),
      language: file.language,
      content: persisted?.content ?? file.content,
      updatedAt: persisted?.updatedAt ?? now,
    }
  })

  for (const file of snapshot.files) {
    const name = fileNameFromPath(file.path)
    if (!mergedFiles.some((entry) => entry.path === file.path)) {
      mergedFiles.push({
        ...file,
        path: toPath(sample.id, name),
      })
    }
  }

  return {
    id: sample.id,
    name: sample.name,
    serverLanguage: sample.serverLanguage,
    files: mergedFiles,
    updatedAt: snapshot.updatedAt,
  }
}

function buildSampleFromSnapshot(sample: Sample, snapshot: WorkspaceSnapshot): Sample {
  return {
    ...sample,
    files: snapshot.files.map((file) => ({
      name: fileNameFromPath(file.path),
      language: file.language,
      content: file.content,
    })),
    description: sample.description,
    serverLanguage: sample.serverLanguage,
  }
}

function queueSave(
  snapshot: WorkspaceSnapshot,
  clearDirty: () => void,
) {
  const existing = saveTimers.get(snapshot.id)
  if (existing) window.clearTimeout(existing)

  const timeout = window.setTimeout(() => {
    void saveWorkspaceSnapshot(snapshot)
      .then(() => {
        clearDirty()
      })
      .catch((error) => {
        console.error('Workspace snapshot save failed', error)
      })
    saveTimers.delete(snapshot.id)
  }, 250)

  saveTimers.set(snapshot.id, timeout)
}

function currentSnapshot(state: WorkspaceState): WorkspaceSnapshot {
  return {
    id: state.sample.id,
    name: state.sample.name,
    serverLanguage: state.sample.serverLanguage,
    files: state.files.map(({ path, language, content, updatedAt }) => ({
      path,
      language,
      content,
      updatedAt,
    })),
    updatedAt: Date.now(),
  }
}

function workspaceUiKey(workspaceId: string): string {
  return `${WORKSPACE_UI_KEY_PREFIX}${workspaceId}`
}

function persistWorkspaceUiState(workspaceId: string, session: WorkspaceEditorSession) {
  window.localStorage.setItem(workspaceUiKey(workspaceId), JSON.stringify(session))
  try {
    useWorkspaceStore.getState().syncBrowserYaml()
  } catch {
    // ignore
  }
}

function buildEditorSessionSnapshot(state: Pick<
  WorkspaceState,
  'folders' | 'paneTabs' | 'paneFiles' | 'activeEditorPane' | 'activeFilePath' | 'activeBottomPanel' | 'activeRightPanelTab' | 'viewTitles'
> & Partial<Pick<WorkspaceState, 'openFilePaths' | 'activePanel'>>): WorkspaceEditorSession {
  return {
    folders: state.folders,
    openFilePaths: deriveOpenFilePaths(state.paneTabs),
    paneTabs: state.paneTabs,
    paneFiles: state.paneFiles,
    activeEditorPane: state.activeEditorPane,
    activeFilePath: state.activeFilePath,
    activeBottomPanel: state.activeBottomPanel,
    activeRightPanelTab: state.activeRightPanelTab,
    viewTitles: state.viewTitles,
  }
}

function isAllowedEditorPath(path: string, files: WorkspaceFile[]): boolean {
  return isEditorViewPath(path) || files.some((file) => file.path === path)
}

function createDefaultEditorSession(files: WorkspaceFile[]): WorkspaceEditorSession {
  const firstPath = files[0]?.path ?? ''
  const paneTabs = normalizePaneTabs({
    primary: { tabs: files.map((file) => file.path), activePath: firstPath },
    secondary: { tabs: [], activePath: null },
    tertiary: { tabs: [], activePath: null },
  }, firstPath)
  return {
    folders: [],
    openFilePaths: deriveOpenFilePaths(paneTabs),
    paneTabs,
    paneFiles: derivePaneAssignments(paneTabs, firstPath),
    activeEditorPane: 'primary',
    activeFilePath: firstPath,
    activeBottomPanel: 'logs',
    activeRightPanelTab: 'inspector',
    viewTitles: {},
  }
}

function normalizeEditorSession(
  files: WorkspaceFile[],
  session: Partial<WorkspaceEditorSession> | null | undefined,
): WorkspaceEditorSession {
  const fallback = createDefaultEditorSession(files)
  if (!session) return fallback

  const allowedOpenFilePaths = dedupePaths(
    Array.isArray(session.openFilePaths)
      ? session.openFilePaths.filter((path): path is string => typeof path === 'string' && isAllowedEditorPath(path, files))
      : [],
  )
  const fallbackPrimaryPath = allowedOpenFilePaths[0] ?? fallback.paneFiles.primary
  const legacyPaneTabs: EditorPaneTabState = {
    primary: {
      tabs: allowedOpenFilePaths.filter((path) => path !== session.paneFiles?.secondary && path !== session.paneFiles?.tertiary),
      activePath: isAllowedEditorPath(session.paneFiles?.primary ?? '', files)
        ? (session.paneFiles?.primary ?? null)
        : null,
    },
    secondary: {
      tabs: isAllowedEditorPath(session.paneFiles?.secondary ?? '', files) && session.paneFiles?.secondary
        ? [session.paneFiles.secondary]
        : [],
      activePath: isAllowedEditorPath(session.paneFiles?.secondary ?? '', files)
        ? (session.paneFiles?.secondary ?? null)
        : null,
    },
    tertiary: {
      tabs: isAllowedEditorPath(session.paneFiles?.tertiary ?? '', files) && session.paneFiles?.tertiary
        ? [session.paneFiles.tertiary]
        : [],
      activePath: isAllowedEditorPath(session.paneFiles?.tertiary ?? '', files)
        ? (session.paneFiles?.tertiary ?? null)
        : null,
    },
  }
  const sessionPaneTabs = session.paneTabs
    ? normalizePaneTabs({
        primary: {
          tabs: dedupePaths(session.paneTabs.primary?.tabs ?? []).filter((path) => isAllowedEditorPath(path, files)),
          activePath: isAllowedEditorPath(session.paneTabs.primary?.activePath ?? '', files)
            ? (session.paneTabs.primary?.activePath ?? null)
            : null,
        },
        secondary: {
          tabs: dedupePaths(session.paneTabs.secondary?.tabs ?? []).filter((path) => isAllowedEditorPath(path, files)),
          activePath: isAllowedEditorPath(session.paneTabs.secondary?.activePath ?? '', files)
            ? (session.paneTabs.secondary?.activePath ?? null)
            : null,
        },
        tertiary: {
          tabs: dedupePaths(session.paneTabs.tertiary?.tabs ?? []).filter((path) => isAllowedEditorPath(path, files)),
          activePath: isAllowedEditorPath(session.paneTabs.tertiary?.activePath ?? '', files)
            ? (session.paneTabs.tertiary?.activePath ?? null)
            : null,
        },
      }, fallbackPrimaryPath)
    : normalizePaneTabs(legacyPaneTabs, fallbackPrimaryPath)
  const paneFiles = derivePaneAssignments(sessionPaneTabs, fallbackPrimaryPath)
  const activeEditorPane = editorPaneOrder.includes(session.activeEditorPane as EditorPaneId)
    ? (session.activeEditorPane as EditorPaneId)
    : 'primary'
  const activeFilePath = isAllowedEditorPath(session.activeFilePath ?? '', files)
    ? (session.activeFilePath as string)
    : resolveActiveFilePath(sessionPaneTabs, activeEditorPane)

  return {
    folders: Array.isArray(session.folders)
      ? Array.from(new Set(session.folders.filter((folder): folder is string => typeof folder === 'string' && !!folder.trim())))
      : [],
    openFilePaths: deriveOpenFilePaths(sessionPaneTabs),
    paneTabs: sessionPaneTabs,
    paneFiles,
    activeEditorPane,
    activeFilePath,
    activeBottomPanel: session.activeBottomPanel ?? fallback.activeBottomPanel,
    activeRightPanelTab: session.activeRightPanelTab ?? fallback.activeRightPanelTab,
    viewTitles: Object.fromEntries(
      Object.entries(session.viewTitles ?? {}).filter(([path, title]) => isAllowedEditorPath(path, files) && typeof title === 'string' && title.trim()),
    ),
  }
}

function loadWorkspaceUiState(workspaceId: string, files: WorkspaceFile[]): WorkspaceEditorSession {
  try {
    const raw = window.localStorage.getItem(workspaceUiKey(workspaceId))
    if (!raw) return createDefaultEditorSession(files)
    return normalizeEditorSession(files, JSON.parse(raw) as Partial<WorkspaceEditorSession>)
  } catch {
    return createDefaultEditorSession(files)
  }
}

async function loadSampleWorkspace(sampleId: string): Promise<{
  sample: Sample
  files: WorkspaceFile[]
}> {
  const seedSample = samples.find((entry) => entry.id === sampleId) ?? null
  const persisted = await loadWorkspaceSnapshot(sampleId)

  if (!seedSample && persisted) {
    return {
      sample: buildImportedSample(persisted),
      files: snapshotToFiles(persisted),
    }
  }

  const fallbackSample = seedSample ?? samples[0]
  const snapshot = mergeSampleSnapshot(fallbackSample, persisted ?? sampleToSnapshot(fallbackSample))

  if (!persisted) {
    await saveWorkspaceSnapshot(snapshot)
  }

  return {
    sample: buildSampleFromSnapshot(fallbackSample, snapshot),
    files: snapshotToFiles(snapshot),
  }
}

function buildImportedSample(snapshot: WorkspaceSnapshot): Sample {
  return {
    id: snapshot.id,
    name: snapshot.name,
    description: 'Imported workspace',
    serverLanguage: snapshot.serverLanguage,
    files: snapshot.files.map((file) => ({
      name: fileNameFromPath(file.path),
      language: file.language,
      content: file.content,
    })),
  }
}

function persistActiveWorkspaceId(id: string) {
  window.localStorage.setItem(ACTIVE_WORKSPACE_KEY, id)
}

function createEmptyPaneTabs(): EditorPaneTabState {
  return {
    primary: { tabs: [], activePath: null },
    secondary: { tabs: [], activePath: null },
    tertiary: { tabs: [], activePath: null },
  }
}

function clonePaneTabs(paneTabs: EditorPaneTabState): EditorPaneTabState {
  return {
    primary: { tabs: [...paneTabs.primary.tabs], activePath: paneTabs.primary.activePath },
    secondary: { tabs: [...paneTabs.secondary.tabs], activePath: paneTabs.secondary.activePath },
    tertiary: { tabs: [...paneTabs.tertiary.tabs], activePath: paneTabs.tertiary.activePath },
  }
}

function dedupePaths(paths: Array<string | null | undefined>): string[] {
  return Array.from(new Set(paths.filter((path): path is string => Boolean(path))))
}

function getPaneFilePath(assignments: EditorPaneAssignments, pane: EditorPaneId): string | null {
  return assignments[pane]
}

function deriveOpenFilePaths(paneTabs: EditorPaneTabState): string[] {
  return dedupePaths(editorPaneOrder.flatMap((pane) => paneTabs[pane].tabs))
}

function derivePaneAssignments(
  paneTabs: EditorPaneTabState,
  fallbackPrimaryPath: string,
): EditorPaneAssignments {
  const primary = paneTabs.primary.activePath ?? paneTabs.primary.tabs[0] ?? fallbackPrimaryPath

  return {
    primary,
    secondary: paneTabs.secondary.activePath ?? paneTabs.secondary.tabs[0] ?? null,
    tertiary: paneTabs.tertiary.activePath ?? paneTabs.tertiary.tabs[0] ?? null,
  }
}

function normalizePaneTabs(
  paneTabs: EditorPaneTabState,
  fallbackPrimaryPath: string,
): EditorPaneTabState {
  const seen = new Set<string>()
  const ordered: Array<EditorPaneTabs> = []

  for (const pane of editorPaneOrder) {
    const tabs = paneTabs[pane].tabs.filter((path) => {
      if (seen.has(path)) return false
      seen.add(path)
      return true
    })
    const activePath = tabs.includes(paneTabs[pane].activePath ?? '')
      ? paneTabs[pane].activePath
      : (tabs[0] ?? null)
    if (tabs.length > 0) {
      ordered.push({ tabs, activePath })
    }
  }

  if (ordered.length === 0 && fallbackPrimaryPath) {
    ordered.push({ tabs: [fallbackPrimaryPath], activePath: fallbackPrimaryPath })
  }

  const normalized = createEmptyPaneTabs()
  for (let index = 0; index < editorPaneOrder.length; index += 1) {
    const pane = editorPaneOrder[index]
    const entry = ordered[index]
    if (!entry) continue
    normalized[pane] = {
      tabs: [...entry.tabs],
      activePath: entry.activePath ?? entry.tabs[0] ?? null,
    }
  }

  return normalized
}

function findPaneForPath(paneTabs: EditorPaneTabState, path: string): EditorPaneId | null {
  return editorPaneOrder.find((pane) => paneTabs[pane].tabs.includes(path)) ?? null
}

function setPaneActivePath(
  paneTabs: EditorPaneTabState,
  pane: EditorPaneId,
  path: string,
): EditorPaneTabState {
  const next = clonePaneTabs(paneTabs)
  if (!next[pane].tabs.includes(path)) {
    next[pane].tabs = [...next[pane].tabs, path]
  }
  next[pane].activePath = path
  return normalizePaneTabs(next, path)
}

function upsertPathInPane(
  paneTabs: EditorPaneTabState,
  pane: EditorPaneId,
  path: string,
  fallbackPrimaryPath: string,
): EditorPaneTabState {
  const next = clonePaneTabs(paneTabs)
  const existingPane = findPaneForPath(next, path)

  if (existingPane) {
    next[existingPane].tabs = next[existingPane].tabs.filter((entry) => entry !== path)
    next[existingPane].activePath = next[existingPane].activePath === path
      ? (next[existingPane].tabs[0] ?? null)
      : next[existingPane].activePath
  }

  next[pane].tabs = [...next[pane].tabs.filter((entry) => entry !== path), path]
  next[pane].activePath = path

  return normalizePaneTabs(next, fallbackPrimaryPath)
}

function clearPane(
  paneTabs: EditorPaneTabState,
  pane: EditorPaneId,
  fallbackPrimaryPath: string,
): EditorPaneTabState {
  const next = clonePaneTabs(paneTabs)
  next[pane] = { tabs: [], activePath: null }
  return normalizePaneTabs(next, fallbackPrimaryPath)
}

function resolveActiveFilePath(paneTabs: EditorPaneTabState, pane: EditorPaneId): string {
  return paneTabs[pane].activePath
    ?? paneTabs[pane].tabs[0]
    ?? paneTabs.primary.activePath
    ?? paneTabs.primary.tabs[0]
    ?? ''
}

interface BrowserYamlRuntime {
  /** Map from pane id to the file path of the server that was running. */
  runningServers: Partial<Record<EditorPaneId, string>>
}

function buildBrowserYaml(
  themeId: string,
  layout: { sidebarWidth: number; bottomHeight: number; rightWidth: number; showSidebar: boolean; showBottom: boolean; showRight: boolean },
  session: WorkspaceEditorSession & { activePanel?: WorkbenchPanelId },
  runtime?: BrowserYamlRuntime,
): string {
  const lines: string[] = []
  lines.push('# browserver UI state')
  lines.push(`theme: ${themeId}`)
  lines.push('layout:')
  lines.push(`  sidebarWidth: ${Math.round(layout.sidebarWidth)}`)
  lines.push(`  bottomHeight: ${Math.round(layout.bottomHeight)}`)
  lines.push(`  rightWidth: ${Math.round(layout.rightWidth)}`)
  lines.push(`  showSidebar: ${layout.showSidebar ? 'true' : 'false'}`)
  lines.push(`  showBottom: ${layout.showBottom ? 'true' : 'false'}`)
  lines.push(`  showRight: ${layout.showRight ? 'true' : 'false'}`)
  if (session.activePanel) lines.push(`activePanel: ${session.activePanel}`)
  lines.push(`activeBottomPanel: ${session.activeBottomPanel}`)
  lines.push(`activeRightPanelTab: ${session.activeRightPanelTab}`)
  lines.push('panes:')
  for (const pane of ['primary','secondary','tertiary'] as EditorPaneId[]) {
    const tabs = session.paneTabs?.[pane]?.tabs ?? []
    const active = session.paneTabs?.[pane]?.activePath ?? null
    lines.push(`  ${pane}:`)
    lines.push(`    active: ${active ?? ''}`)
    lines.push('    tabs:')
    for (const t of tabs) lines.push(`      - ${t}`)
  }
  lines.push('openFiles:')
  for (const p of session.openFilePaths ?? []) lines.push(`  - ${p}`)
  lines.push('folders:')
  for (const f of session.folders ?? []) lines.push(`  - ${f}`)
  if (runtime && Object.keys(runtime.runningServers).length > 0) {
    lines.push('runtime:')
    lines.push('  servers:')
    for (const [pane, filePath] of Object.entries(runtime.runningServers)) {
      if (filePath) lines.push(`    ${pane}: ${filePath}`)
    }
  }
  return lines.join('\n') + '\n'
}

export function parseBrowserYaml(content: string): any {
  const result: any = {
    layout: {},
    panes: {
      primary: { tabs: [] },
      secondary: { tabs: [] },
      tertiary: { tabs: [] }
    },
    openFiles: [],
    folders: [],
    runtime: { servers: {} },
  };
  const lines = content.split('\n');
  let currentSection = '';
  let currentPane: 'primary' | 'secondary' | 'tertiary' | '' = '';
  let inRuntimeServers = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (!line.startsWith(' ') && !line.startsWith('-')) {
      const parts = trimmed.split(':');
      const key = parts[0].trim();
      const value = parts.slice(1).join(':').trim();
      inRuntimeServers = false;

      if (key === 'theme') {
        result.theme = value;
      } else if (key === 'layout') {
        currentSection = 'layout';
      } else if (key === 'panes') {
        currentSection = 'panes';
      } else if (key === 'openFiles') {
        currentSection = 'openFiles';
      } else if (key === 'folders') {
        currentSection = 'folders';
      } else if (key === 'runtime') {
        currentSection = 'runtime';
      } else if (key === 'activePanel') {
        result.activePanel = value;
      } else if (key === 'activeBottomPanel') {
        result.activeBottomPanel = value;
      } else if (key === 'activeRightPanelTab') {
        result.activeRightPanelTab = value;
      }
    } else if (currentSection === 'layout' && trimmed.includes(':')) {
      const [key, value] = trimmed.split(':').map(s => s.trim());
      if (key === 'sidebarWidth' || key === 'bottomHeight' || key === 'rightWidth') {
        result.layout[key] = Number(value) || 0;
      } else {
        result.layout[key] = value === 'true';
      }
    } else if (currentSection === 'panes') {
      if (line.startsWith('  ') && !line.startsWith('    ') && trimmed.endsWith(':')) {
        currentPane = trimmed.slice(0, -1).trim() as any;
      } else if (currentPane && trimmed.startsWith('active:')) {
        result.panes[currentPane].active = trimmed.split(':')[1].trim() || null;
      } else if (currentPane && trimmed.startsWith('-')) {
        result.panes[currentPane].tabs.push(trimmed.slice(1).trim());
      }
    } else if (currentSection === 'runtime') {
      if (trimmed === 'servers:') {
        inRuntimeServers = true;
      } else if (inRuntimeServers && trimmed.includes(':')) {
        const [pane, ...rest] = trimmed.split(':');
        const filePath = rest.join(':').trim();
        if (filePath) result.runtime.servers[pane.trim()] = filePath;
      }
    } else if (currentSection === 'openFiles' && trimmed.startsWith('-')) {
      result.openFiles.push(trimmed.slice(1).trim());
    } else if (currentSection === 'folders' && trimmed.startsWith('-')) {
      result.folders.push(trimmed.slice(1).trim());
    }
  }
  return result;
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  syncBrowserYaml: () => {
    const state = get()
    if (!state.hydrated) return
    const name = '.browserver.yaml'
    const path = toPath(state.sample.id, name)
    if (state.dirtyFilePaths.includes(path)) return

    const themeId = useThemeStore.getState().themeId
    const layout = useLayoutStore.getState()
    const session = state.editorSession()

    // Collect running server panes (lazy import to avoid circular dep)
    let runtimeInfo: BrowserYamlRuntime | undefined
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useRuntimeStore } = require('./runtime') as typeof import('./runtime')
      const rtState = useRuntimeStore.getState()
      const runningServers: Partial<Record<EditorPaneId, string>> = {}
      for (const pane of ['primary', 'secondary', 'tertiary'] as EditorPaneId[]) {
        const paneState = state.paneTabs[pane]
        const preferred = paneState.activePath
        const orderedPaths = preferred
          ? [preferred, ...paneState.tabs.filter((path) => path !== preferred)]
          : [...paneState.tabs]
        const runningPath = orderedPaths.find((path) => {
          const session = rtState.tabSessions[path]
          return session?.mode === 'server' && session.status === 'running'
        })
        if (runningPath) {
          runningServers[pane] = runningPath
        }
      }
      if (Object.keys(runningServers).length > 0) {
        runtimeInfo = { runningServers }
      }
    } catch { /* ignore if runtime store not available */ }

    const yaml = buildBrowserYaml(themeId, {
      sidebarWidth: layout.sidebarWidth,
      bottomHeight: layout.bottomHeight,
      rightWidth: layout.rightWidth,
      showSidebar: layout.showSidebar,
      showBottom: layout.showBottom,
      showRight: layout.showRight,
    }, { ...session, activePanel: state.activePanel }, runtimeInfo)
    
    const existing = state.files.find((f) => f.name === name)
    if (existing && existing.content === yaml) return
    const now = Date.now()
    const files = existing
      ? state.files.map((f) => f.name === name ? { ...f, content: yaml, updatedAt: now } : f)
      : [...state.files, { path, name, language: 'yaml' as StoredWorkspaceLanguage, content: yaml, updatedAt: now }]
    const sample = existing
      ? {
          ...state.sample,
          files: state.sample.files.map((f) => f.name === name ? ({ ...f, content: yaml }) as SampleFile : f),
        }
      : {
          ...state.sample,
          files: [...state.sample.files, { name, language: 'yaml' as StoredWorkspaceLanguage, content: yaml } as SampleFile],
        }
    set({ files, sample })
    queueSave(currentSnapshot({ ...state, files, sample }), () => {
      set((latest) => ({
        dirtyFilePaths: latest.dirtyFilePaths.filter((p) => p !== path)
      }))
    })
  },
  hydrated: false,
  sample: samples[0],
  files: sampleToSnapshot(samples[0]).files.map((file) => ({
    ...file,
    name: fileNameFromPath(file.path),
  })),
  folders: [],
  openFilePaths: [toPath(samples[0].id, samples[0].files[0].name)],
  dirtyFilePaths: [],
  saveState: 'idle',
  saveError: null,
  paneTabs: {
    primary: { tabs: [toPath(samples[0].id, samples[0].files[0].name)], activePath: toPath(samples[0].id, samples[0].files[0].name) },
    secondary: { tabs: [], activePath: null },
    tertiary: { tabs: [], activePath: null },
  },
  paneFiles: {
    primary: toPath(samples[0].id, samples[0].files[0].name),
    secondary: null,
    tertiary: null,
  },
  activeEditorPane: 'primary',
  activeFilePath: toPath(samples[0].id, samples[0].files[0].name),
  activeBottomPanel: 'logs',
  activePanel: 'editor',
  activeRightPanelTab: 'inspector',
  viewTitles: {},
  renamingPath: null,
  renamingFolderPath: null,
  editorSession: () => {
    const state = get()
    return {
      folders: state.folders,
      openFilePaths: state.openFilePaths,
      paneTabs: state.paneTabs,
      paneFiles: state.paneFiles,
      activeEditorPane: state.activeEditorPane,
      activeFilePath: state.activeFilePath,
      activeBottomPanel: state.activeBottomPanel,
      activeRightPanelTab: state.activeRightPanelTab,
      viewTitles: state.viewTitles,
    }
  },
  hydrate: async () => {
    const preferredId = window.localStorage.getItem(ACTIVE_WORKSPACE_KEY) ?? get().sample.id
    const { sample, files } = await loadSampleWorkspace(preferredId)
    const session = loadWorkspaceUiState(sample.id, files)

    set({
      hydrated: true,
      sample,
      files,
      folders: session.folders ?? [],
      openFilePaths: session.openFilePaths,
      dirtyFilePaths: [],
      saveState: 'idle',
      paneTabs: session.paneTabs ?? createDefaultEditorSession(files).paneTabs ?? createEmptyPaneTabs(),
      paneFiles: session.paneFiles,
      activeEditorPane: session.activeEditorPane,
      activeFilePath: session.activeFilePath,
      activeBottomPanel: session.activeBottomPanel,
      activeRightPanelTab: session.activeRightPanelTab,
      viewTitles: session.viewTitles ?? {},
    })
    persistActiveWorkspaceId(sample.id)
  },
  setSample: async (id: string) => {
    const { sample, files } = await loadSampleWorkspace(id)
    const session = loadWorkspaceUiState(sample.id, files)

    set({
      sample,
      files,
      folders: session.folders ?? [],
      openFilePaths: session.openFilePaths,
      dirtyFilePaths: [],
      saveState: 'idle',
      paneTabs: session.paneTabs ?? createDefaultEditorSession(files).paneTabs ?? createEmptyPaneTabs(),
      paneFiles: session.paneFiles,
      activeEditorPane: session.activeEditorPane,
      activeFilePath: session.activeFilePath,
      activeBottomPanel: session.activeBottomPanel,
      activeRightPanelTab: session.activeRightPanelTab,
      viewTitles: session.viewTitles ?? {},
      activePanel: 'editor',
    })
    persistActiveWorkspaceId(sample.id)
  },
  importSnapshot: async (snapshot) => {
    await saveWorkspaceSnapshot(snapshot)
    const files = snapshotToFiles(snapshot)
    const seedSample = samples.find((entry) => entry.id === snapshot.id)
    const sample = seedSample
      ? buildSampleFromSnapshot(seedSample, snapshot)
      : buildImportedSample(snapshot)

    const session = loadWorkspaceUiState(sample.id, files)
    set({
      hydrated: true,
      sample,
      files,
      folders: session.folders ?? [],
      openFilePaths: session.openFilePaths,
      dirtyFilePaths: [],
      saveState: 'saved',
      paneTabs: session.paneTabs ?? createDefaultEditorSession(files).paneTabs ?? createEmptyPaneTabs(),
      paneFiles: session.paneFiles,
      activeEditorPane: session.activeEditorPane,
      activeFilePath: session.activeFilePath,
      activeBottomPanel: session.activeBottomPanel,
      activeRightPanelTab: session.activeRightPanelTab,
      viewTitles: session.viewTitles ?? {},
      activePanel: 'editor',
    })
    persistActiveWorkspaceId(sample.id)
  },
  restoreEditorSession: (session) =>
    set((state) => {
      const nextSession = normalizeEditorSession(state.files, session)
      persistWorkspaceUiState(state.sample.id, nextSession)
      return {
        folders: nextSession.folders ?? [],
        openFilePaths: nextSession.openFilePaths,
        paneTabs: nextSession.paneTabs ?? createDefaultEditorSession(state.files).paneTabs ?? createEmptyPaneTabs(),
        paneFiles: nextSession.paneFiles,
        activeEditorPane: nextSession.activeEditorPane,
        activeFilePath: nextSession.activeFilePath,
        activeBottomPanel: nextSession.activeBottomPanel,
        activeRightPanelTab: nextSession.activeRightPanelTab,
        viewTitles: nextSession.viewTitles ?? {},
      }
    }),
  openEditorView: (viewId, pane = 'primary') =>
    set((state) => {
      const path = editorViewPath(viewId)
      const paneTabs = upsertPathInPane(state.paneTabs, pane, path, state.paneFiles.primary)
      const paneFiles = derivePaneAssignments(paneTabs, state.paneFiles.primary)
      const viewTitles = {
        ...state.viewTitles,
        [path]: buildViewTitle(viewId, state.openFilePaths, state.viewTitles),
      }
      const nextState = {
        paneTabs,
        paneFiles,
        activeEditorPane: pane,
        activeFilePath: path,
        activePanel: 'editor' as const,
        openFilePaths: deriveOpenFilePaths(paneTabs),
        viewTitles,
      }
      persistWorkspaceUiState(state.sample.id, {
        ...buildEditorSessionSnapshot({ ...state, ...nextState }),
        folders: state.folders,
      })
      return nextState
    }),
  createFile: (pane = 'primary') => {
    const history = useHistoryStore.getState()
    history.begin('Create file')
    set((state) => {
      const name = buildUntitledFileName(state.files)
      const path = toPath(state.sample.id, name)
      const file: WorkspaceFile = {
        path,
        name,
        language: 'typescript',
        content: '',
        updatedAt: Date.now(),
      }
      const files = [...state.files, file]
      const sample = {
        ...state.sample,
        files: [...state.sample.files, { name, language: 'typescript', content: '' } satisfies SampleFile],
      }
      const paneTabs = upsertPathInPane(state.paneTabs, pane, path, state.paneFiles.primary)
      const paneFiles = derivePaneAssignments(paneTabs, state.paneFiles.primary)
      const nextState = {
        sample,
        files,
        paneTabs,
        paneFiles,
        activeEditorPane: pane,
        activeFilePath: path,
        activePanel: 'editor' as const,
        openFilePaths: deriveOpenFilePaths(paneTabs),
        saveState: 'saving' as const,
        renamingPath: path,
        renamingFolderPath: null,
      }
      queueSave(currentSnapshot({ ...state, ...nextState, dirtyFilePaths: [], viewTitles: state.viewTitles }), () => {
        set({ saveState: 'saved' })
        window.setTimeout(() => {
          if (get().saveState === 'saved') {
            set({ saveState: 'idle' })
          }
        }, 1200)
      })
      persistWorkspaceUiState(state.sample.id, {
        ...buildEditorSessionSnapshot({ ...state, ...nextState }),
        folders: state.folders,
      })
      return nextState
    })
    void history.commit(get().sample.id)
  },
  createFolder: (pane = 'primary') => {
    const history = useHistoryStore.getState()
    history.begin('Create folder')
    set((state) => {
      const folderPath = buildUntitledFolderPath(state.files).replace(/\/index\.ts$/, '')
      const folders = Array.from(new Set([...state.folders, folderPath]))
      const nextState = {
        folders,
        saveState: 'idle' as const,
        renamingPath: null,
        renamingFolderPath: folderPath,
      }
      persistWorkspaceUiState(state.sample.id, {
        ...buildEditorSessionSnapshot({ ...state, ...nextState }),
        folders,
      })
      return nextState
    })
    void history.commit(get().sample.id)
  },
  startRenaming: (path) => set({ renamingPath: path }),
  startRenamingFolder: (folderPath) => set({ renamingFolderPath: folderPath, renamingPath: null }),
  cancelRenaming: () => set({ renamingPath: null, renamingFolderPath: null }),
  renameFile: (path, nextName) => {
    const history = useHistoryStore.getState()
    history.begin('Rename file')
    const trimmed = nextName.trim()
    if (!trimmed) { history.abort(); return false }

    const state = get()
    const target = state.files.find((file) => file.path === path)
    if (!target) { history.abort(); return false }
    if (!isUniqueFileName(state.files, path, trimmed)) { history.abort(); return false }
    if (target.name === trimmed) {
      set({ renamingPath: null, renamingFolderPath: null })
      history.abort()
      return true
    }

    const nextPath = toPath(state.sample.id, trimmed)
    const files = state.files.map((file) =>
      file.path === path
        ? { ...file, path: nextPath, name: trimmed, updatedAt: Date.now() }
        : file,
    )
    const sample = {
      ...state.sample,
      files: state.sample.files.map((file) =>
        file.name === target.name
          ? ({ ...file, name: trimmed } satisfies SampleFile)
          : file,
      ),
    }
    const paneTabs = normalizePaneTabs({
      primary: {
        tabs: state.paneTabs.primary.tabs.map((entry) => (entry === path ? nextPath : entry)),
        activePath: state.paneTabs.primary.activePath === path ? nextPath : state.paneTabs.primary.activePath,
      },
      secondary: {
        tabs: state.paneTabs.secondary.tabs.map((entry) => (entry === path ? nextPath : entry)),
        activePath: state.paneTabs.secondary.activePath === path ? nextPath : state.paneTabs.secondary.activePath,
      },
      tertiary: {
        tabs: state.paneTabs.tertiary.tabs.map((entry) => (entry === path ? nextPath : entry)),
        activePath: state.paneTabs.tertiary.activePath === path ? nextPath : state.paneTabs.tertiary.activePath,
      },
    }, nextPath)
    const openFilePaths = deriveOpenFilePaths(paneTabs)
    const paneFiles = derivePaneAssignments(paneTabs, nextPath)
    const activeFilePath = state.activeFilePath === path ? nextPath : state.activeFilePath
    const nextState = {
      sample,
      files,
      paneTabs,
      openFilePaths,
      paneFiles,
      activeFilePath,
      saveState: 'saving' as const,
      renamingPath: null,
      renamingFolderPath: null,
    }

    queueSave(currentSnapshot({ ...state, ...nextState, dirtyFilePaths: state.dirtyFilePaths, viewTitles: state.viewTitles }), () => {
      set({ saveState: 'saved' })
      window.setTimeout(() => {
        if (get().saveState === 'saved') {
          set({ saveState: 'idle' })
        }
      }, 1200)
    })

    persistWorkspaceUiState(state.sample.id, {
      ...buildEditorSessionSnapshot({
        ...state,
        ...nextState,
        folders: Array.from(new Set([...state.folders, parentFolderName(trimmed)].filter((folder): folder is string => Boolean(folder)))),
      }),
      folders: Array.from(new Set([...state.folders, parentFolderName(trimmed)].filter((folder): folder is string => Boolean(folder)))),
    })

    set({
      ...nextState,
      folders: Array.from(new Set([...state.folders, parentFolderName(trimmed)].filter((folder): folder is string => Boolean(folder)))),
    })
    void history.commit(get().sample.id)
    return true
  },
  renameFolder: (folderPath, nextName) => {
    const history = useHistoryStore.getState()
    history.begin('Rename folder')
    const trimmedBase = nextName.trim().replace(/\/+$/g, '')
    if (!trimmedBase || trimmedBase.includes('/')) { history.abort(); return false }

    const state = get()
    const sourcePrefix = `${folderPath}/`
    const affected = state.files.filter((file) => file.name.startsWith(sourcePrefix))
    const affectsFolderState = state.folders.some((folder) => folder === folderPath || folder.startsWith(sourcePrefix))
    if (affected.length === 0 && !affectsFolderState) { history.abort(); return false }

    const parent = parentFolderName(folderPath)
    const nextFolderPath = parent ? `${parent}/${trimmedBase}` : trimmedBase
    if (nextFolderPath === folderPath) {
      set({ renamingFolderPath: null, renamingPath: null })
      history.abort()
      return true
    }

    const renameMap = new Map<string, string>()
    for (const file of affected) {
      const suffix = file.name.slice(sourcePrefix.length)
      renameMap.set(file.name, `${nextFolderPath}/${suffix}`)
    }
    if (!fileNamesAreUnique(state.files, renameMap)) { history.abort(); return false }

    const nextState = {
      ...renameWorkspaceFiles(state, renameMap),
      folders: Array.from(new Set(
        state.folders.map((folder) => {
          if (folder === folderPath) return nextFolderPath
          if (folder.startsWith(sourcePrefix)) {
            return `${nextFolderPath}/${folder.slice(sourcePrefix.length)}`
          }
          return folder
        }),
      )),
      renamingFolderPath: null as string | null,
      renamingPath: null as string | null,
    }

    queueSave(currentSnapshot({ ...state, ...nextState }), () => {
      set({ saveState: 'saved' })
      window.setTimeout(() => {
        if (get().saveState === 'saved') {
          set({ saveState: 'idle' })
        }
      }, 1200)
    })

    persistWorkspaceUiState(state.sample.id, {
      ...buildEditorSessionSnapshot(nextState),
      folders: nextState.folders,
    })

    set(nextState)
    void history.commit(get().sample.id)
    return true
  },
  deleteFile: (path) => {
    const history = useHistoryStore.getState()
    history.begin('Delete file')
    const state = get()
    if (state.files.length <= 1) { history.abort(); return false }

    const files = state.files.filter((file) => file.path !== path)
    const sample = {
      ...state.sample,
      files: state.sample.files.filter((file) => toPath(state.sample.id, file.name) !== path),
    }
    const nextPaneTabs = clonePaneTabs(state.paneTabs)
    const pane = findPaneForPath(nextPaneTabs, path)
    if (!pane) { history.abort(); return false }
    nextPaneTabs[pane].tabs = nextPaneTabs[pane].tabs.filter((entry) => entry !== path)
    nextPaneTabs[pane].activePath = nextPaneTabs[pane].activePath === path
      ? (nextPaneTabs[pane].tabs[0] ?? null)
      : nextPaneTabs[pane].activePath
    const fallbackPath = deriveOpenFilePaths(nextPaneTabs).at(-1) ?? files[0]?.path ?? state.paneFiles.primary
    const paneTabs = normalizePaneTabs(nextPaneTabs, fallbackPath)
    const nextOpenFilePaths = deriveOpenFilePaths(paneTabs)
    const paneFiles = derivePaneAssignments(paneTabs, fallbackPath)
    const activeFileExists = getPaneFilePath(paneFiles, state.activeEditorPane)
    const nextActiveEditorPane = activeFileExists ? state.activeEditorPane : 'primary'
    const nextActiveFilePath = resolveActiveFilePath(paneTabs, nextActiveEditorPane)

    const dirtyFilePaths = state.dirtyFilePaths.filter((entry) => entry !== path)
    const nextState = {
      sample,
      files,
      openFilePaths: nextOpenFilePaths,
      paneTabs,
      paneFiles,
      activeEditorPane: nextActiveEditorPane,
      activeFilePath: nextActiveFilePath,
      dirtyFilePaths,
      saveState: 'saving' as const,
      renamingPath: state.renamingPath === path ? null : state.renamingPath,
      renamingFolderPath: state.renamingFolderPath,
      viewTitles: Object.fromEntries(Object.entries(state.viewTitles).filter(([entryPath]) => entryPath !== path)),
    }

    queueSave(currentSnapshot({ ...state, ...nextState }), () => {
      set({ saveState: 'saved' })
      window.setTimeout(() => {
        if (get().saveState === 'saved') {
          set({ saveState: 'idle' })
        }
      }, 1200)
    })

    persistWorkspaceUiState(state.sample.id, {
      ...buildEditorSessionSnapshot({ ...state, ...nextState }),
      folders: state.folders,
    })

    set(nextState)
    void history.commit(get().sample.id)
    return true
  },
  deleteFolder: (folderPath) => {
    const history = useHistoryStore.getState()
    history.begin('Delete folder')
    const state = get()
    const sourcePrefix = `${folderPath}/`
    const affectedFiles = state.files.filter((file) => file.name.startsWith(sourcePrefix))

    if (affectedFiles.length === 0) { history.abort(); return false }

    const files = state.files.filter((file) => !file.name.startsWith(sourcePrefix))
    if (files.length === 0) { history.abort(); return false }

    const affectedPaths = new Set(affectedFiles.map((f) => f.path))

    const sample = {
      ...state.sample,
      files: state.sample.files.filter((file) => !affectedPaths.has(toPath(state.sample.id, file.name))),
    }

    const nextPaneTabs = clonePaneTabs(state.paneTabs)
    for (const pane of editorPaneOrder) {
      nextPaneTabs[pane].tabs = nextPaneTabs[pane].tabs.filter((entry) => !affectedPaths.has(entry))
      if (nextPaneTabs[pane].activePath && affectedPaths.has(nextPaneTabs[pane].activePath)) {
        nextPaneTabs[pane].activePath = nextPaneTabs[pane].tabs[0] ?? null
      }
    }

    const fallbackPath = deriveOpenFilePaths(nextPaneTabs).at(-1) ?? files[0]?.path ?? state.paneFiles.primary
    const paneTabs = normalizePaneTabs(nextPaneTabs, fallbackPath)
    const openFilePaths = deriveOpenFilePaths(paneTabs)
    const paneFiles = derivePaneAssignments(paneTabs, fallbackPath)
    const activeEditorPane = getPaneFilePath(paneFiles, state.activeEditorPane) ? state.activeEditorPane : 'primary'
    const activeFilePath = affectedPaths.has(state.activeFilePath)
      ? resolveActiveFilePath(paneTabs, activeEditorPane)
      : state.activeFilePath

    const dirtyFilePaths = state.dirtyFilePaths.filter((entry) => !affectedPaths.has(entry))

    const nextFolders = state.folders.filter((folder) => folder !== folderPath && !folder.startsWith(sourcePrefix))

    const nextState = {
      sample,
      files,
      openFilePaths,
      paneTabs,
      paneFiles,
      activeEditorPane,
      activeFilePath,
      dirtyFilePaths,
      saveState: 'saving' as const,
      renamingPath: affectedPaths.has(state.renamingPath ?? '') ? null : state.renamingPath,
      renamingFolderPath: state.renamingFolderPath && (state.renamingFolderPath === folderPath || state.renamingFolderPath.startsWith(sourcePrefix)) ? null : state.renamingFolderPath,
      viewTitles: Object.fromEntries(Object.entries(state.viewTitles).filter(([entryPath]) => !affectedPaths.has(entryPath))),
    }

    queueSave(currentSnapshot({ ...state, ...nextState }), () => {
      set({ saveState: 'saved' })
      window.setTimeout(() => {
        if (get().saveState === 'saved') {
          set({ saveState: 'idle' })
        }
      }, 1200)
    })

    persistWorkspaceUiState(state.sample.id, {
      ...buildEditorSessionSnapshot({ ...state, ...nextState }),
      folders: nextFolders,
    })

    set({
      ...nextState,
      folders: nextFolders,
    })

    void history.commit(get().sample.id)
    return true
  },
  moveFileToFolder: (path, folderName) => {
    const history = useHistoryStore.getState()
    history.begin('Move file')
    const state = get()
    const target = state.files.find((file) => file.path === path)
    if (!target) { history.abort(); return false }

    const nextName = folderName ? `${folderName}/${baseName(target.name)}` : baseName(target.name)
    if (nextName === target.name) { history.abort(); return true }
    if (!isUniqueFileName(state.files, path, nextName)) { history.abort(); return false }

    const nextState = renameWorkspaceFiles(state, new Map([[target.name, nextName]]))

    queueSave(currentSnapshot({ ...state, ...nextState }), () => {
      set({ saveState: 'saved' })
      window.setTimeout(() => {
        if (get().saveState === 'saved') {
          set({ saveState: 'idle' })
        }
      }, 1200)
    })

    persistWorkspaceUiState(state.sample.id, {
      ...buildEditorSessionSnapshot({
        ...nextState,
        activeBottomPanel: state.activeBottomPanel,
        activeRightPanelTab: state.activeRightPanelTab,
        activePanel: state.activePanel,
      }),
      folders: Array.from(new Set([...nextState.folders, ...(folderName ? [folderName] : [])])),
    })

    set({
      ...nextState,
      folders: Array.from(new Set([...nextState.folders, ...(folderName ? [folderName] : [])])),
    })
    void history.commit(get().sample.id)
    return true
  },
  moveFolderToFolder: (folderName, destinationFolderName) => {
    const history = useHistoryStore.getState()
    history.begin('Move folder')
    const state = get()
    const sourcePrefix = `${folderName}/`
    const affected = state.files.filter((file) => file.name.startsWith(sourcePrefix))
    if (affected.length === 0) { history.abort(); return false }
    if (destinationFolderName === folderName) { history.abort(); return true }
    if (destinationFolderName && destinationFolderName.startsWith(sourcePrefix)) { history.abort(); return false }

    const movedFolderBase = baseName(folderName)
    const nextFolderName = destinationFolderName ? `${destinationFolderName}/${movedFolderBase}` : movedFolderBase
    if (nextFolderName === folderName) { history.abort(); return true }

    const renameMap = new Map<string, string>()
    for (const file of affected) {
      const suffix = file.name.slice(sourcePrefix.length)
      renameMap.set(file.name, `${nextFolderName}/${suffix}`)
    }
    if (!fileNamesAreUnique(state.files, renameMap)) { history.abort(); return false }

    const nextState = renameWorkspaceFiles(state, renameMap)

    queueSave(currentSnapshot({ ...state, ...nextState }), () => {
      set({ saveState: 'saved' })
      window.setTimeout(() => {
        if (get().saveState === 'saved') {
          set({ saveState: 'idle' })
        }
      }, 1200)
    })

    persistWorkspaceUiState(state.sample.id, {
      ...buildEditorSessionSnapshot({
        ...nextState,
        activeBottomPanel: nextState.activeBottomPanel,
        activeRightPanelTab: nextState.activeRightPanelTab,
        activePanel: nextState.activePanel,
      }),
      folders: Array.from(new Set(
        state.folders.map((folder) => {
          if (folder === folderName) return nextFolderName
          if (folder.startsWith(`${folderName}/`)) {
            return `${nextFolderName}/${folder.slice(folderName.length + 1)}`
          }
          return folder
        }),
      )),
    })

    set({
      ...nextState,
      folders: Array.from(new Set(
        state.folders.map((folder) => {
          if (folder === folderName) return nextFolderName
          if (folder.startsWith(`${folderName}/`)) {
            return `${nextFolderName}/${folder.slice(folderName.length + 1)}`
          }
          return folder
        }),
      )),
    })
    void history.commit(get().sample.id)
    return true
  },
  importExternalFiles: async (incomingFiles, pane = 'primary', folderName = null) => {
    const fileList = Array.from(incomingFiles)
    if (fileList.length === 0) return

    const contents = await Promise.all(fileList.map(async (item) => {
      const sourceFile = item instanceof File ? item : item.file
      const requestedName = item instanceof File ? item.name : item.name
      return {
        sourceFile,
        requestedName,
        content: await readImportedFileContent(sourceFile, requestedName),
      }
    }))

    set((state) => {
      const importedAt = Date.now()
      const importedFiles = contents.map(({ sourceFile, requestedName, content }) => {
        const targetName = folderName ? `${folderName}/${requestedName}` : requestedName
        const cleanedRequestedName = targetName.replace(/^\/+/, '')
        const name = normalizeImportedFileName(state.files, cleanedRequestedName)
        return {
          path: toPath(state.sample.id, name),
          name,
          language: languageFromFileName(name) as StoredWorkspaceLanguage,
          content,
          updatedAt: importedAt,
        } satisfies WorkspaceFile
      })

      const files = [...state.files, ...importedFiles]
      const sample = {
        ...state.sample,
        files: [
          ...state.sample.files,
          ...importedFiles.map((file) => ({
            name: file.name,
            language: file.language,
            content: file.content,
          } satisfies SampleFile)),
        ],
      }

      let paneTabs = state.paneTabs
      for (const file of importedFiles) {
        paneTabs = upsertPathInPane(paneTabs, pane, file.path, state.paneFiles.primary)
      }
      const paneFiles = derivePaneAssignments(paneTabs, importedFiles[0]?.path ?? state.paneFiles.primary)
      const nextFolders = folderName ? Array.from(new Set([...state.folders, folderName])) : state.folders
      const nextState = {
        sample,
        files,
        folders: nextFolders,
        paneTabs,
        paneFiles,
        openFilePaths: deriveOpenFilePaths(paneTabs),
        activeEditorPane: pane,
        activeFilePath: importedFiles.at(-1)?.path ?? state.activeFilePath,
        activePanel: 'editor' as const,
        saveState: 'saving' as const,
        renamingPath: null,
        renamingFolderPath: null,
      }

      queueSave(currentSnapshot({ ...state, ...nextState, dirtyFilePaths: [], viewTitles: state.viewTitles }), () => {
        set({ saveState: 'saved' })
        window.setTimeout(() => {
          if (get().saveState === 'saved') {
            set({ saveState: 'idle' })
          }
        }, 1200)
      })

      persistWorkspaceUiState(state.sample.id, {
        ...buildEditorSessionSnapshot({ ...state, ...nextState }),
        folders: nextFolders,
      })

      return nextState
    })
  },
  setActiveFile: (path: string, pane = 'primary') =>
    set((state) => {
      const existingPane = findPaneForPath(state.paneTabs, path)
      const targetPane = existingPane ?? pane
      const paneTabs = existingPane
        ? setPaneActivePath(state.paneTabs, existingPane, path)
        : upsertPathInPane(state.paneTabs, targetPane, path, state.paneFiles.primary)
      const paneFiles = derivePaneAssignments(paneTabs, state.paneFiles.primary)
      const nextState = {
        paneTabs,
        paneFiles,
        activeEditorPane: targetPane,
        activeFilePath: path,
        activePanel: 'editor' as const,
        openFilePaths: deriveOpenFilePaths(paneTabs),
      }
      persistWorkspaceUiState(state.sample.id, {
        ...buildEditorSessionSnapshot({ ...state, ...nextState }),
        folders: state.folders,
      })
      return nextState
    }),
  splitFileToPane: (pane, path) =>
    set((state) => {
      const paneTabs = upsertPathInPane(state.paneTabs, pane, path, state.paneFiles.primary)
      const paneFiles = derivePaneAssignments(paneTabs, state.paneFiles.primary)
      const nextOpenFilePaths = deriveOpenFilePaths(paneTabs)
      persistWorkspaceUiState(state.sample.id, {
        ...buildEditorSessionSnapshot({
          ...state,
          paneTabs,
          paneFiles,
          activeEditorPane: pane,
          activeFilePath: path,
          openFilePaths: nextOpenFilePaths,
        }),
        folders: state.folders,
      })
      return {
        paneTabs,
        paneFiles,
        activeEditorPane: pane,
        activeFilePath: path,
        activePanel: 'editor' as const,
        openFilePaths: nextOpenFilePaths,
      }
    }),
  assignFileToPane: (pane, path) =>
    set((state) => {
      const paneTabs = path === null
        ? clearPane(state.paneTabs, pane, state.paneFiles.primary)
        : upsertPathInPane(state.paneTabs, pane, path, state.paneFiles.primary)
      const paneFiles = derivePaneAssignments(paneTabs, state.paneFiles.primary)
      const activeEditorPane = path === null && state.activeEditorPane === pane ? 'primary' : state.activeEditorPane
      const nextState = {
        paneTabs,
        paneFiles,
        activeEditorPane,
        activeFilePath: resolveActiveFilePath(paneTabs, activeEditorPane),
        activePanel: 'editor' as const,
        openFilePaths: deriveOpenFilePaths(paneTabs),
      }
      persistWorkspaceUiState(state.sample.id, {
        ...buildEditorSessionSnapshot({ ...state, ...nextState }),
        folders: state.folders,
      })
      return nextState
    }),
  focusEditorPane: (pane) =>
    set((state) => {
      const activeFilePath = resolveActiveFilePath(state.paneTabs, pane)
      persistWorkspaceUiState(state.sample.id, {
        ...buildEditorSessionSnapshot({ ...state, activeEditorPane: pane, activeFilePath }),
        folders: state.folders,
      })
      return {
        activeEditorPane: pane,
        activeFilePath,
        activePanel: 'editor',
      }
    }),
  reorderOpenFile: (path, beforePath) =>
    set((state) => {
      if (path === beforePath) return state

      const pane = findPaneForPath(state.paneTabs, path)
      if (!pane || findPaneForPath(state.paneTabs, beforePath) !== pane) return state
      const nextPaneTabs = clonePaneTabs(state.paneTabs)
      const panePaths = nextPaneTabs[pane].tabs.filter((entry) => entry !== path)
      const insertIndex = panePaths.indexOf(beforePath)
      if (insertIndex === -1) return state
      panePaths.splice(insertIndex, 0, path)
      nextPaneTabs[pane].tabs = panePaths
      const paneTabs = normalizePaneTabs(nextPaneTabs, state.paneFiles.primary)
      const nextOpenFilePaths = deriveOpenFilePaths(paneTabs)
      const paneFiles = derivePaneAssignments(paneTabs, state.paneFiles.primary)

      persistWorkspaceUiState(state.sample.id, {
        ...buildEditorSessionSnapshot({ ...state, paneTabs, paneFiles, openFilePaths: nextOpenFilePaths }),
        folders: state.folders,
      })
      return { paneTabs, paneFiles, openFilePaths: nextOpenFilePaths }
    }),
  closeFile: (path: string) =>
    set((state) => {
      if (state.openFilePaths.length <= 1) return state

      const nextPaneTabs = clonePaneTabs(state.paneTabs)
      const pane = findPaneForPath(nextPaneTabs, path)
      if (!pane) return state
      nextPaneTabs[pane].tabs = nextPaneTabs[pane].tabs.filter((entry) => entry !== path)
      nextPaneTabs[pane].activePath = nextPaneTabs[pane].activePath === path
        ? (nextPaneTabs[pane].tabs[0] ?? null)
        : nextPaneTabs[pane].activePath
      const fallbackPath = deriveOpenFilePaths(nextPaneTabs).filter((entry) => entry !== path).at(-1) ?? state.paneFiles.primary
      const paneTabs = normalizePaneTabs(nextPaneTabs, fallbackPath)
      const nextOpenFilePaths = deriveOpenFilePaths(paneTabs)
      const paneFiles = derivePaneAssignments(paneTabs, fallbackPath)
      const activeFileExists = getPaneFilePath(paneFiles, state.activeEditorPane)
      const nextActiveEditorPane = activeFileExists ? state.activeEditorPane : 'primary'
      const nextActiveFilePath = resolveActiveFilePath(paneTabs, nextActiveEditorPane)

      const nextState = {
        openFilePaths: nextOpenFilePaths,
        paneTabs,
        paneFiles,
        activeEditorPane: nextActiveEditorPane,
        activeFilePath: nextActiveFilePath,
        viewTitles: Object.fromEntries(Object.entries(state.viewTitles).filter(([entryPath]) => entryPath !== path)),
        renamingPath: state.renamingPath === path ? null : state.renamingPath,
      }
      persistWorkspaceUiState(state.sample.id, {
        ...buildEditorSessionSnapshot({ ...state, ...nextState }),
        folders: state.folders,
      })
      return nextState
    }),
  closePaths: (paths: string[]) =>
    set((state) => {
      const uniquePaths = Array.from(new Set(paths))
      if (uniquePaths.length === 0) return state

      const remainingPaths = state.openFilePaths.filter((path) => !uniquePaths.includes(path))
      if (remainingPaths.length === 0) return state

      const nextPaneTabs = clonePaneTabs(state.paneTabs)
      for (const pane of editorPaneOrder) {
        nextPaneTabs[pane].tabs = nextPaneTabs[pane].tabs.filter((entry) => !uniquePaths.includes(entry))
        if (nextPaneTabs[pane].activePath && uniquePaths.includes(nextPaneTabs[pane].activePath)) {
          nextPaneTabs[pane].activePath = nextPaneTabs[pane].tabs[0] ?? null
        }
      }

      const fallbackPath = remainingPaths.at(-1) ?? state.paneFiles.primary
      const paneTabs = normalizePaneTabs(nextPaneTabs, fallbackPath)
      const nextOpenFilePaths = deriveOpenFilePaths(paneTabs)
      const paneFiles = derivePaneAssignments(paneTabs, fallbackPath)
      const activeFileExists = getPaneFilePath(paneFiles, state.activeEditorPane)
      const nextActiveEditorPane = activeFileExists ? state.activeEditorPane : 'primary'
      const nextActiveFilePath = resolveActiveFilePath(paneTabs, nextActiveEditorPane)

      const nextState = {
        openFilePaths: nextOpenFilePaths,
        paneTabs,
        paneFiles,
        activeEditorPane: nextActiveEditorPane,
        activeFilePath: nextActiveFilePath,
        viewTitles: Object.fromEntries(Object.entries(state.viewTitles).filter(([entryPath]) => !uniquePaths.includes(entryPath))),
        renamingPath: state.renamingPath && uniquePaths.includes(state.renamingPath) ? null : state.renamingPath,
      }
      persistWorkspaceUiState(state.sample.id, {
        ...buildEditorSessionSnapshot({ ...state, ...nextState }),
        folders: state.folders,
      })
      return nextState
    }),
  setActiveBottomPanel: (panel) =>
    set((state) => {
      persistWorkspaceUiState(state.sample.id, {
        ...buildEditorSessionSnapshot({ ...state, activeBottomPanel: panel }),
        folders: state.folders,
      })
      return { activeBottomPanel: panel }
    }),
  setActivePanel: (panel) => set({ activePanel: panel }),
  setActiveRightPanelTab: (tab) =>
    set((state) => {
      persistWorkspaceUiState(state.sample.id, {
        ...buildEditorSessionSnapshot({ ...state, activeRightPanelTab: tab }),
        folders: state.folders,
      })
      return { activeRightPanelTab: tab }
    }),
  updateFileContent: (path: string, content: string) => {
    const current = get()
    const targetFile = current.files.find((file) => file.path === path)
    if (!targetFile || targetFile.content === content) return

    const wasDirty = current.dirtyFilePaths.includes(path)
    if (!wasDirty) {
      const history = useHistoryStore.getState()
      if (!history.pending) {
        // Capture pre-edit workspace state so save transactions produce meaningful line diffs.
        history.begin(`Save ${targetFile.name}`)
      }
    }

    set((state) => {
      const files = state.files.map((file) =>
        file.path === path ? { ...file, content, updatedAt: Date.now() } : file,
      )
      const sample = {
        ...state.sample,
        files: state.sample.files.map((file) => {
          const updated = files.find((entry) => entry.name === file.name)
          return updated ? ({ ...file, content: updated.content } satisfies SampleFile) : file
        }),
      }
      const nextDirtyFilePaths = state.dirtyFilePaths.includes(path)
        ? state.dirtyFilePaths
        : [...state.dirtyFilePaths, path]

      return {
        files,
        sample,
        dirtyFilePaths: nextDirtyFilePaths,
      }
    })
  },
  saveFile: async (path: string, message?: string) => {
    const state = get()
    const file = state.files.find(f => f.path === path)
    if (!file) return
    if (!state.dirtyFilePaths.includes(path)) {
      // No content diff for this file; avoid no-op snapshot/history writes.
      return
    }

    if (file.name === '.browserver.yaml') {
      try {
        const config = parseBrowserYaml(file.content)
        if (!config.theme || typeof config.layout?.sidebarWidth !== 'number') {
          throw new Error('Invalid .browserver.yaml format')
        }
        
        // Two-way sync: apply to other stores
        useThemeStore.getState().applyThemeId(config.theme)
        useLayoutStore.getState().applySnapshot(config.layout)
        if (config.activePanel) set({ activePanel: config.activePanel as any })
        if (config.activeBottomPanel) set({ activeBottomPanel: config.activeBottomPanel as any })
        if (config.activeRightPanelTab) set({ activeRightPanelTab: config.activeRightPanelTab as any })
        
        set({ saveError: null })
      } catch (e: any) {
        set({ saveError: e.message })
        window.alert(`Invalid .browserver.yaml: ${e.message}`)
        return
      }
    }

    const history = useHistoryStore.getState()
    if (!history.pending) {
      const historyLabel = message || `Save ${file.name}`
      history.begin(historyLabel)
    }

    // Push save action into history immediately for responsive UI feedback.
    try {
      await history.commit(state.sample.id)
    } catch (error) {
      console.error('History commit failed on save', error)
      history.abort()
    }

    set({ saveState: 'saving' })
    const snapshot = currentSnapshot(get())
    try {
      await saveWorkspaceSnapshot(snapshot)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('Workspace snapshot save failed', error)
      set({ saveState: 'idle', saveError: message })
      window.alert(`Failed to save workspace snapshot: ${message}`)
      return
    }
    

    set((s) => ({
      dirtyFilePaths: s.dirtyFilePaths.filter((p) => p !== path),
      saveState: 'saved',
      saveError: null,
    }))
    
    window.setTimeout(() => {
      const latest = useWorkspaceStore.getState()
      if (latest.saveState === 'saved') {
        set({ saveState: 'idle' })
      }
    }, 1200)
  },
}))

export function selectActiveFile(state: WorkspaceState): WorkspaceFile | null {
  return state.files.find((file) => file.path === state.activeFilePath) ?? null
}

export function selectPaneTabs(state: WorkspaceState, pane: EditorPaneId): string[] {
  return state.paneTabs[pane].tabs
}

export function selectPaneActivePath(state: WorkspaceState, pane: EditorPaneId): string | null {
  return state.paneTabs[pane].activePath
}

export function selectPrimaryFile(state: WorkspaceState): WorkspaceFile | null {
  const path = state.paneTabs.primary.activePath ?? state.paneTabs.primary.tabs[0] ?? null
  return path ? (state.files.find((file) => file.path === path) ?? null) : null
}

export function selectSecondaryFile(state: WorkspaceState): WorkspaceFile | null {
  const path = state.paneTabs.secondary.activePath ?? state.paneTabs.secondary.tabs[0] ?? null
  return path ? (state.files.find((file) => file.path === path) ?? null) : null
}

export function selectTertiaryFile(state: WorkspaceState): WorkspaceFile | null {
  const path = state.paneTabs.tertiary.activePath ?? state.paneTabs.tertiary.tabs[0] ?? null
  return path ? (state.files.find((file) => file.path === path) ?? null) : null
}
