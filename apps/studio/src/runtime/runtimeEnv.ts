import type { EditorPaneId } from '../store/workspace'
import { preferredServerNameForProject } from './serverNames'

export interface RuntimeEnvBindings {
  PROJECT_ID: string
  PROJECT_SLUG: string
  PROJECT_NAMESPACE: string
  SERVER_NAME: string
  SERVER_NAMESPACE: string
  BROWSERVER_PROJECT_ID: string
  BROWSERVER_PROJECT_SLUG: string
  BROWSERVER_PROJECT_NAMESPACE: string
  BROWSERVER_SERVER_NAME: string
  BROWSERVER_SERVER_NAMESPACE: string
}

export function extractProjectSlug(projectId: string): string {
  const trimmed = projectId.trim().replace(/^\/+|\/+$/g, '')
  if (!trimmed) return 'preview'
  const parts = trimmed.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? 'preview'
}

export function extractServerNamespace(serverName: string): string {
  const trimmed = serverName.trim()
  if (!trimmed) return ''
  const slashIndex = trimmed.indexOf('/')
  return slashIndex > 0 ? trimmed.slice(0, slashIndex) : ''
}

export function buildRuntimeEnvBindings(options: {
  projectId?: string
  serverName: string
}): RuntimeEnvBindings {
  const projectId = options.projectId?.trim() || extractProjectSlug(options.serverName)
  const projectSlug = extractProjectSlug(projectId)
  const serverNamespace = extractServerNamespace(options.serverName)

  return {
    PROJECT_ID: projectId,
    PROJECT_SLUG: projectSlug,
    PROJECT_NAMESPACE: serverNamespace,
    SERVER_NAME: options.serverName,
    SERVER_NAMESPACE: serverNamespace,
    BROWSERVER_PROJECT_ID: projectId,
    BROWSERVER_PROJECT_SLUG: projectSlug,
    BROWSERVER_PROJECT_NAMESPACE: serverNamespace,
    BROWSERVER_SERVER_NAME: options.serverName,
    BROWSERVER_SERVER_NAMESPACE: serverNamespace,
  }
}

export function buildRuntimeEnvBindingsForPane(projectId: string, pane: EditorPaneId): RuntimeEnvBindings {
  return buildRuntimeEnvBindings({
    projectId,
    serverName: preferredServerNameForProject(projectId, pane),
  })
}
