import type { EditorPaneId } from '../store/workspace'
import { useIdentityStore } from '../store/identity'
import { useNamespaceStore } from '../store/namespace'

function getDefaultOwnedNamespace(): string | null {
  if (!useIdentityStore.getState().user) return null

  const namespaces = [...useNamespaceStore.getState().namespaces]
    .sort((a, b) => {
      const approvedAtDelta = (a.approvedAt ?? 0) - (b.approvedAt ?? 0)
      if (approvedAtDelta !== 0) return approvedAtDelta
      return a.namespace.localeCompare(b.namespace)
    })

  return namespaces[0]?.namespace ?? null
}

function resolveProjectServerBase(projectId: string): string {
  if (!projectId.startsWith('dmz/')) return projectId

  const namespace = getDefaultOwnedNamespace()
  if (!namespace) return projectId

  return `${namespace}/${projectId.slice('dmz/'.length)}`
}

export function preferredServerNameForProject(projectId: string, pane: EditorPaneId): string {
  const baseProjectId = resolveProjectServerBase(projectId)
  return pane === 'primary' ? baseProjectId : `${baseProjectId}-${pane}`
}
