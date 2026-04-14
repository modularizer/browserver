import { selectActiveFile, useWorkspaceStore } from '../store/workspace'
import { evaluateServerAuthorityStatus } from '../runtime/authorityPolicy'
import { preferredServerNameForProject } from '../runtime/serverNames'
import { selectRuntimeIsStale, useRuntimeStore } from '../store/runtime'
import { useIdentityStore } from '../store/identity'
import { useNamespaceStore } from '../store/namespace'
import { useThemeStore } from '../theme'
import { layoutPresets, useLayoutStore } from '../store/layout'

export function StatusBar() {
  const sample = useWorkspaceStore((state) => state.sample)
  const activeFile = useWorkspaceStore(selectActiveFile)
  const dirtyFilePaths = useWorkspaceStore((state) => state.dirtyFilePaths)
  const saveState = useWorkspaceStore((state) => state.saveState)
  const saveError = useWorkspaceStore((state) => state.saveError)
  const activePanel = useWorkspaceStore((state) => state.activePanel)
  const activeEditorPane = useWorkspaceStore((state) => state.activeEditorPane)
  const sampleId = useWorkspaceStore((state) => state.sample.id)
  const setActiveBottomPanel = useWorkspaceStore((state) => state.setActiveBottomPanel)
  const runtimeLanguage = useRuntimeStore((state) => state.language)
  const runtimeStatus = useRuntimeStore((state) => state.status)
  const launchable = useRuntimeStore((state) => state.launchable)
  const connectionUrl = useRuntimeStore((state) => state.connectionUrl)
  const runtimeIsStale = useRuntimeStore(selectRuntimeIsStale)
  const user = useIdentityStore((state) => state.user)
  const namespaces = useNamespaceStore((state) => state.namespaces)
  const currentTheme = useThemeStore((state) => state.theme())
  const presetId = useLayoutStore((state) => state.presetId)
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar)
  const toggleBottom = useLayoutStore((state) => state.toggleBottom)
  const toggleRight = useLayoutStore((state) => state.toggleRight)
  const presetLabel = presetId === 'custom' ? 'Custom' : layoutPresets[presetId].label
  const launchAuthorityStatus = activeFile?.name.split('/').pop()?.startsWith('server')
    ? evaluateServerAuthorityStatus(preferredServerNameForProject(sampleId, activeEditorPane), user, namespaces)
    : null
  const launchStatusLabel = launchAuthorityStatus
    ? (launchAuthorityStatus.allowed ? 'launchable' : 'blocked')
    : (launchable ? 'launchable' : 'blocked')

  return (
    <div className="flex-none h-[22px] flex items-center px-2 text-[10px] bg-bs-accent text-bs-accent-text gap-3">
      <span className="font-medium">{sample.name}</span>
      <span className="opacity-70">{activeFile?.name ?? 'no file'}</span>
      <span className="opacity-70">{activeFile?.language ?? 'n/a'}</span>
      <span className="opacity-70">{dirtyFilePaths.length > 0 ? `${dirtyFilePaths.length} unsaved` : 'clean'}</span>
      <span className={`opacity-70 ${saveError ? 'text-white bg-bs-error px-1 font-bold' : ''}`}>
        {saveError ? `Error: ${saveError}` : saveState}
      </span>
      <span className="opacity-70">{runtimeLanguage ?? sample.serverLanguage}</span>
      <span className="opacity-70">{runtimeStatus}</span>
      <span className="opacity-70" title={launchAuthorityStatus?.reason || undefined}>{launchStatusLabel}</span>
      <span className="opacity-70">{runtimeIsStale ? 'stale' : 'fresh'}</span>
      <span className="opacity-70">{connectionUrl ?? 'runtime offline'}</span>
      <div className="flex-1" />
      <span className="opacity-70">{activePanel}</span>
      <span className="opacity-70">{presetLabel}</span>
      <button title="Show or hide the left file/sample sidebar" onClick={toggleSidebar} className="opacity-70 hover:opacity-100">sidebar</button>
      <button title="Show or hide the bottom panel stack" onClick={toggleBottom} className="opacity-70 hover:opacity-100">panel</button>
      <button title="Show or hide the right-side workspace panel" onClick={toggleRight} className="opacity-70 hover:opacity-100">right</button>
      <button
        title={user?.email || 'Sign in to use custom namespaces'}
        onClick={() => setActiveBottomPanel('namespace')}
        className="opacity-70 hover:opacity-100"
      >
        {user?.name.split(' ')[0] || 'anon'}
      </button>
      <span className="opacity-70">{currentTheme.name}</span>
    </div>
  )
}
