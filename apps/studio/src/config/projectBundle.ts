import type { LayoutPresetId } from '../store/layout'
import type { DatabaseSnapshot } from '@browserver/database'
import type { WorkspaceSnapshot } from '@browserver/storage'
import type { TrustSnapshot } from '../store/trust'

export interface ProjectBundle {
  version: 1
  exportedAt: number
  workspace: WorkspaceSnapshot
  database: DatabaseSnapshot
  trust?: TrustSnapshot
  ui: {
    themeId: string
    presetId: LayoutPresetId
    layout: {
      sidebarWidth: number
      bottomHeight: number
      rightWidth: number
      showSidebar: boolean
      showBottom: boolean
      showRight: boolean
    }
  }
}

export function serializeProjectBundle(bundle: ProjectBundle): string {
  return JSON.stringify(bundle, null, 2)
}

export function parseProjectBundle(source: string): ProjectBundle {
  const parsed = JSON.parse(source) as Partial<ProjectBundle>

  if (parsed.version !== 1 || !parsed.workspace || !parsed.database || !parsed.ui) {
    throw new Error('Invalid browserver project bundle')
  }

  return parsed as ProjectBundle
}
