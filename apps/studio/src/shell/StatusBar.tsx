import { selectActiveFile, useWorkspaceStore } from '../store/workspace'
import { selectRuntimeIsStale, useRuntimeStore } from '../store/runtime'
import { useThemeStore } from '../theme'
import { layoutPresets, useLayoutStore } from '../store/layout'

export function StatusBar() {
  const sample = useWorkspaceStore((state) => state.sample)
  const activeFile = useWorkspaceStore(selectActiveFile)
  const dirtyFilePaths = useWorkspaceStore((state) => state.dirtyFilePaths)
  const saveState = useWorkspaceStore((state) => state.saveState)
  const activePanel = useWorkspaceStore((state) => state.activePanel)
  const runtimeLanguage = useRuntimeStore((state) => state.language)
  const runtimeStatus = useRuntimeStore((state) => state.status)
  const launchable = useRuntimeStore((state) => state.launchable)
  const connectionUrl = useRuntimeStore((state) => state.connectionUrl)
  const runtimeIsStale = useRuntimeStore(selectRuntimeIsStale)
  const currentTheme = useThemeStore((state) => state.theme())
  const presetId = useLayoutStore((state) => state.presetId)
  const toggleSidebar = useLayoutStore((state) => state.toggleSidebar)
  const toggleBottom = useLayoutStore((state) => state.toggleBottom)
  const toggleRight = useLayoutStore((state) => state.toggleRight)
  const presetLabel = presetId === 'custom' ? 'Custom' : layoutPresets[presetId].label

  return (
    <div className="flex-none h-[22px] flex items-center px-2 text-[10px] bg-bs-accent text-bs-accent-text gap-3">
      <span className="font-medium">{sample.name}</span>
      <span className="opacity-70">{activeFile?.name ?? 'no file'}</span>
      <span className="opacity-70">{activeFile?.language ?? 'n/a'}</span>
      <span className="opacity-70">{dirtyFilePaths.length > 0 ? `${dirtyFilePaths.length} unsaved` : 'clean'}</span>
      <span className="opacity-70">{saveState}</span>
      <span className="opacity-70">{runtimeLanguage ?? sample.serverLanguage}</span>
      <span className="opacity-70">{runtimeStatus}</span>
      <span className="opacity-70">{launchable ? 'launchable' : 'blocked'}</span>
      <span className="opacity-70">{runtimeIsStale ? 'stale' : 'fresh'}</span>
      <span className="opacity-70">{connectionUrl ?? 'runtime offline'}</span>
      <div className="flex-1" />
      <span className="opacity-70">{activePanel}</span>
      <span className="opacity-70">{presetLabel}</span>
      <button title="Show or hide the left file/sample sidebar" onClick={toggleSidebar} className="opacity-70 hover:opacity-100">sidebar</button>
      <button title="Show or hide the bottom panel stack" onClick={toggleBottom} className="opacity-70 hover:opacity-100">panel</button>
      <button title="Show or hide the right-side workspace panel" onClick={toggleRight} className="opacity-70 hover:opacity-100">right</button>
      <span className="opacity-70">{currentTheme.name}</span>
    </div>
  )
}
