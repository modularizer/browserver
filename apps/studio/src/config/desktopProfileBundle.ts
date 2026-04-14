import type { ProjectBundle } from './projectBundle'
import type { StoredWorkspaceLanguage } from '@browserver/storage'
import { detectServeClientSideServerName } from '../runtime/detectServeClientSideServerName'

type ServerLanguage = 'typescript' | 'python'

interface WorkspaceFileLike {
  path: string
  name: string
  language: StoredWorkspaceLanguage
  content: string
}

export interface DesktopProfileAsset {
  path: string
  source: string
}

export interface DesktopProfileBundle {
  version: 1
  exportedAt: number
  profile: {
    id: string
    projectId: string
    projectName: string
    appName: string
    serverLanguage: ServerLanguage
    entrypointPath: string | null
    serverName: string | null
    preferredClientTarget: string | null
    launchOnOpen: boolean
    icon: DesktopProfileAsset | null
    notes: string[]
  }
  project: ProjectBundle
}

export interface BuildDesktopProfileBundleOptions {
  project: ProjectBundle
  files: WorkspaceFileLike[]
  projectId: string
  projectName: string
  serverLanguage: ServerLanguage
  activeFilePath: string | null
  launchedServerFilePath: string | null
  runtimeServerName: string | null
  preferredClientTarget: string | null
}

function isFileInWorkspace(files: WorkspaceFileLike[], path: string | null | undefined): path is string {
  return Boolean(path && files.some((file) => file.path === path))
}

function looksLikeServerEntrypoint(file: WorkspaceFileLike, serverLanguage: ServerLanguage): boolean {
  const lowerName = file.name.toLowerCase()
  if (serverLanguage === 'typescript') {
    if (file.language !== 'typescript' && file.language !== 'javascript') return false
    return /(^|\/)(server|main|index)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lowerName)
  }

  if (file.language !== 'python') return false
  return /(^|\/)(server|main|app|index)\.py$/.test(lowerName)
}

function pickEntrypoint(
  files: WorkspaceFileLike[],
  serverLanguage: ServerLanguage,
  activeFilePath: string | null,
  launchedServerFilePath: string | null,
): { entrypointPath: string | null; serverName: string | null; notes: string[] } {
  const notes: string[] = []

  if (isFileInWorkspace(files, launchedServerFilePath)) {
    const launchedFile = files.find((file) => file.path === launchedServerFilePath) ?? null
    return {
      entrypointPath: launchedServerFilePath,
      serverName: launchedFile ? detectServerName(files, launchedFile.name) : null,
      notes,
    }
  }

  if (isFileInWorkspace(files, activeFilePath)) {
    const activeFile = files.find((file) => file.path === activeFilePath) ?? null
    if (activeFile && looksLikeServerEntrypoint(activeFile, serverLanguage)) {
      notes.push('Using the active editor tab as the desktop launch entrypoint.')
      return {
        entrypointPath: activeFile.path,
        serverName: detectServerName(files, activeFile.name),
        notes,
      }
    }
  }

  if (serverLanguage === 'typescript') {
    const detection = detectServeClientSideServerName(files)
    if (detection.calls.length > 0) {
      const preferredCall = detection.calls.find((call) => /(^|\/)server\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(call.fileName))
        ?? detection.calls[0]
      const entrypoint = files.find((file) => file.name === preferredCall.fileName) ?? null
      if (entrypoint) {
        if (detection.kind === 'multiple') {
          notes.push('Multiple serveClientSideServer() calls were found; the first matching server file was chosen.')
        } else {
          notes.push('Using the detected serveClientSideServer() file as the desktop launch entrypoint.')
        }
        return {
          entrypointPath: entrypoint.path,
          serverName: preferredCall.name,
          notes,
        }
      }
    }
  }

  const conventional = files.find((file) => looksLikeServerEntrypoint(file, serverLanguage)) ?? null
  if (conventional) {
    notes.push('No running server was active, so a conventional server entrypoint file was chosen.')
    return {
      entrypointPath: conventional.path,
      serverName: detectServerName(files, conventional.name),
      notes,
    }
  }

  notes.push('No obvious server entrypoint was found. The desktop shell should ask the user which file to launch.')
  return {
    entrypointPath: null,
    serverName: null,
    notes,
  }
}

function detectServerName(files: WorkspaceFileLike[], fileName: string): string | null {
  const detection = detectServeClientSideServerName(files)
  return detection.calls.find((call) => call.fileName === fileName)?.name ?? null
}

function pickIcon(files: WorkspaceFileLike[]): DesktopProfileAsset | null {
  const preferredNames = [
    'favicon.svg',
    'icon.svg',
    'app-icon.svg',
    'favicon.png',
    'icon.png',
    'logo.svg',
  ]
  const lowerToFile = new Map(files.map((file) => [file.name.toLowerCase(), file] as const))

  for (const preferredName of preferredNames) {
    const exact = lowerToFile.get(preferredName)
    if (exact) {
      return {
        path: exact.path,
        source: exact.content,
      }
    }
  }

  const firstSvg = files.find((file) => file.name.toLowerCase().endsWith('.svg')) ?? null
  if (firstSvg) {
    return {
      path: firstSvg.path,
      source: firstSvg.content,
    }
  }

  const firstImage = files.find((file) => file.language === 'image') ?? null
  if (firstImage) {
    return {
      path: firstImage.path,
      source: firstImage.content,
    }
  }

  return null
}

function slugifyProfileId(projectId: string): string {
  return projectId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'project'
}

export function buildDesktopProfileBundle(options: BuildDesktopProfileBundleOptions): DesktopProfileBundle {
  const { entrypointPath, serverName, notes } = pickEntrypoint(
    options.files,
    options.serverLanguage,
    options.activeFilePath,
    options.launchedServerFilePath,
  )
  const icon = pickIcon(options.files)

  if (icon) {
    notes.push(`Bundled ${icon.path} as the preferred launcher icon source.`)
  } else {
    notes.push('No icon file was found in the workspace; the desktop shell should fall back to a generated default icon.')
  }

  return {
    version: 1,
    exportedAt: Date.now(),
    profile: {
      id: slugifyProfileId(options.projectId),
      projectId: options.projectId,
      projectName: options.projectName,
      appName: options.projectName,
      serverLanguage: options.serverLanguage,
      entrypointPath,
      serverName: options.runtimeServerName ?? serverName,
      preferredClientTarget: options.preferredClientTarget?.trim() || null,
      launchOnOpen: true,
      icon,
      notes,
    },
    project: options.project,
  }
}

export function serializeDesktopProfileBundle(bundle: DesktopProfileBundle): string {
  return JSON.stringify(bundle, null, 2)
}
