import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type WheelEvent as ReactWheelEvent } from 'react'
import * as monaco from 'monaco-editor'
import * as XLSX from 'xlsx'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker&inline'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker&inline'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker&inline'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker&inline'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker&inline'
import { setupMonacoTypeEnvironment } from '../editor/setupMonaco'
import { EditorViewHost } from './EditorViewHost'
import { MarkdownPreview, MarkdownToolbar, type MdMode } from './MarkdownPane'
import { HtmlPreview, HtmlToolbar, type HtmlMode } from './HtmlPane'
import { NotebookPreview, NotebookToolbar, type NotebookMode } from './NotebookPane'
import { SvgPreview, SvgToolbar, type SvgMode } from './SvgPane'
import { MenuButton } from './MenuButton'
import { selectPaneRuntimeSession, useRuntimeStore } from '../store/runtime'
import {
  editorViewDefinitions,
  getEditorItemLabels,
  getEditorViewId,
  selectPaneActivePath,
  selectPaneTabs,
  selectPrimaryFile,
  selectSecondaryFile,
  selectTertiaryFile,
  useWorkspaceStore,
  type EditorPaneId,
  type WorkspaceFile,
} from '../store/workspace'

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'typescript':
      case 'javascript':
        return new TsWorker()
      case 'json':
        return new JsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new CssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new HtmlWorker()
      default:
        return new EditorWorker()
    }
  },
}

type PaneSplitMode = MdMode | SvgMode | HtmlMode | NotebookMode

interface PaneHandle {
  container: HTMLDivElement | null
  editor: monaco.editor.IStandaloneCodeEditor | null
  decorations: monaco.editor.IEditorDecorationsCollection | null
}

function hasExternalFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  return (
    dataTransfer.files.length > 0 ||
    Array.from(dataTransfer.items ?? []).some((item) => item.kind === 'file') ||
    Array.from(dataTransfer.types ?? []).includes('Files')
  )
}

function isRasterImageFile(file: WorkspaceFile | null): boolean {
  if (!file) return false
  if (file.language === 'image') return true

  const lower = file.name.toLowerCase()
  if (
    lower.endsWith('.png')
    || lower.endsWith('.jpg')
    || lower.endsWith('.jpeg')
    || lower.endsWith('.webp')
    || lower.endsWith('.gif')
    || lower.endsWith('.bmp')
    || lower.endsWith('.ico')
    || lower.endsWith('.avif')
  ) return true

  return file.content.startsWith('data:image/')
}

function isPdfFile(file: WorkspaceFile | null): boolean {
  if (!file) return false
  if (file.language === 'pdf') return true
  if (file.name.toLowerCase().endsWith('.pdf')) return true
  return file.content.startsWith('data:application/pdf')
}

function isVideoFile(file: WorkspaceFile | null): boolean {
  if (!file) return false
  if (file.language === 'video') return true
  const lower = file.name.toLowerCase()
  if (
    lower.endsWith('.mp4')
    || lower.endsWith('.webm')
    || lower.endsWith('.mov')
    || lower.endsWith('.m4v')
    || lower.endsWith('.ogv')
  ) return true
  return file.content.startsWith('data:video/')
}

function isCsvFile(file: WorkspaceFile | null): boolean {
  if (!file) return false
  return file.language === 'csv' || file.name.toLowerCase().endsWith('.csv')
}

function isXlsxFile(file: WorkspaceFile | null): boolean {
  if (!file) return false
  return file.language === 'xlsx' || file.name.toLowerCase().endsWith('.xlsx')
}

function isArchiveFile(file: WorkspaceFile | null): boolean {
  if (!file) return false
  const lower = file.name.toLowerCase()
  return file.language === 'archive' || lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')
}

export function Editor({
  onImportExternalFiles,
  onStartTabDrag,
  onEndTabDrag,
  onReorderTab,
  dragPreviewPaneCount = 0,
  hoveredDropPane = null,
  onHoverDropPane,
  onLeaveDropPane,
  onDropToPane,
}: {
  onImportExternalFiles: (files: FileList | File[], pane: EditorPaneId, folderName?: string | null) => void
  onStartTabDrag: (path: string) => void
  onEndTabDrag: () => void
  onReorderTab: (path: string, beforePath: string) => void
  dragPreviewPaneCount?: number
  hoveredDropPane?: EditorPaneId | null
  onHoverDropPane?: (pane: EditorPaneId) => void
  onLeaveDropPane?: () => void
  onDropToPane?: (pane: EditorPaneId) => void
}) {
  const primaryContainerRef = useRef<HTMLDivElement>(null)
  const secondaryContainerRef = useRef<HTMLDivElement>(null)
  const tertiaryContainerRef = useRef<HTMLDivElement>(null)
  const primaryPaneRef = useRef<PaneHandle>({ container: null, editor: null, decorations: null })
  const secondaryPaneRef = useRef<PaneHandle>({ container: null, editor: null, decorations: null })
  const tertiaryPaneRef = useRef<PaneHandle>({ container: null, editor: null, decorations: null })
  const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>())
  const viewStatesRef = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>())
  const hydrated = useWorkspaceStore((state) => state.hydrated)
  const files = useWorkspaceStore((state) => state.files)
  const openFilePaths = useWorkspaceStore((state) => state.openFilePaths)
  const viewTitles = useWorkspaceStore((state) => state.viewTitles)
  const paneTabs = useWorkspaceStore((state) => state.paneTabs)
  const paneFiles = useWorkspaceStore((state) => state.paneFiles)
  const primaryTabs = useWorkspaceStore((state) => selectPaneTabs(state, 'primary'))
  const secondaryTabs = useWorkspaceStore((state) => selectPaneTabs(state, 'secondary'))
  const tertiaryTabs = useWorkspaceStore((state) => selectPaneTabs(state, 'tertiary'))
  const primaryPath = useWorkspaceStore((state) => selectPaneActivePath(state, 'primary'))
  const secondaryPath = useWorkspaceStore((state) => selectPaneActivePath(state, 'secondary'))
  const tertiaryPath = useWorkspaceStore((state) => selectPaneActivePath(state, 'tertiary'))
  const primaryFile = useWorkspaceStore(selectPrimaryFile)
  const secondaryFile = useWorkspaceStore(selectSecondaryFile)
  const tertiaryFile = useWorkspaceStore(selectTertiaryFile)
  const activeEditorPane = useWorkspaceStore((state) => state.activeEditorPane)
  const updateFileContent = useWorkspaceStore((state) => state.updateFileContent)
  const setActivePanel = useWorkspaceStore((state) => state.setActivePanel)
  const focusEditorPane = useWorkspaceStore((state) => state.focusEditorPane)
  const assignFileToPane = useWorkspaceStore((state) => state.assignFileToPane)
  const openEditorView = useWorkspaceStore((state) => state.openEditorView)
  const focusPaneRuntime = useRuntimeStore((state) => state.focusPaneRuntime)
  const runPane = useRuntimeStore((state) => state.runPane)
  const stopPane = useRuntimeStore((state) => state.stopPane)
  const primaryRuntime = useRuntimeStore(selectPaneRuntimeSession('primary'))
  const secondaryRuntime = useRuntimeStore(selectPaneRuntimeSession('secondary'))
  const tertiaryRuntime = useRuntimeStore(selectPaneRuntimeSession('tertiary'))
  const highlightedHandler = useRuntimeStore((state) => state.highlightedHandler)
  const [paneModes, setPaneModes] = useState<Record<string, PaneSplitMode>>({})
  const setPaneMode = (path: string, mode: PaneSplitMode) => setPaneModes((prev) => ({ ...prev, [path]: mode }))
  const showPaneHeaders = paneTabs.secondary.tabs.length > 0 || paneTabs.tertiary.tabs.length > 0
  const actualVisiblePaneCount =
    1 + Number(paneTabs.secondary.tabs.length > 0) + Number(paneTabs.tertiary.tabs.length > 0)
  const previewPaneCount = Math.max(actualVisiblePaneCount, dragPreviewPaneCount)
  const dragPreviewActive = previewPaneCount > actualVisiblePaneCount
  const dragDropActive = Boolean(onDropToPane)
  const primaryView = getEditorViewId(primaryPath)
  const secondaryView = getEditorViewId(secondaryPath)
  const tertiaryView = getEditorViewId(tertiaryPath)
  const labelPaths = Array.from(new Set([...openFilePaths, primaryPath, secondaryPath, tertiaryPath].filter((path): path is string => Boolean(path))))
  const itemLabels = getEditorItemLabels(labelPaths, files, viewTitles)

  useEffect(() => {
    setupMonacoTypeEnvironment()
  }, [])

  useEffect(() => {
    if (!hydrated) return

    ensurePane(primaryPaneRef.current, primaryContainerRef.current, updateFileContent, 'primary')
    if (secondaryPath) {
      ensurePane(secondaryPaneRef.current, secondaryContainerRef.current, updateFileContent, 'secondary')
    } else {
      disposePane(secondaryPaneRef.current)
    }
    if (tertiaryPath) {
      ensurePane(tertiaryPaneRef.current, tertiaryContainerRef.current, updateFileContent, 'tertiary')
    } else {
      disposePane(tertiaryPaneRef.current)
    }
  }, [hydrated, secondaryPath, tertiaryPath, updateFileContent])

  useEffect(() => {
    return () => {
      disposePane(primaryPaneRef.current)
      disposePane(secondaryPaneRef.current)
      disposePane(tertiaryPaneRef.current)
      for (const model of modelsRef.current.values()) {
        model.dispose()
      }
      modelsRef.current.clear()
      viewStatesRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return

    const nextPaths = new Set(files.map((file) => file.path))
    for (const [path, model] of modelsRef.current.entries()) {
        if (!nextPaths.has(path)) {
          if (primaryPaneRef.current.editor?.getModel() === model) primaryPaneRef.current.editor.setModel(null)
          if (secondaryPaneRef.current.editor?.getModel() === model) secondaryPaneRef.current.editor.setModel(null)
          if (tertiaryPaneRef.current.editor?.getModel() === model) tertiaryPaneRef.current.editor.setModel(null)
          model.dispose()
          modelsRef.current.delete(path)
          viewStatesRef.current.delete(`primary:${path}`)
          viewStatesRef.current.delete(`secondary:${path}`)
          viewStatesRef.current.delete(`tertiary:${path}`)
        }
      }

    for (const file of files) {
      if (isRasterImageFile(file) || isVideoFile(file) || isPdfFile(file) || isXlsxFile(file) || isArchiveFile(file)) {
        const existing = modelsRef.current.get(file.path)
        if (existing) {
          if (primaryPaneRef.current.editor?.getModel() === existing) primaryPaneRef.current.editor.setModel(null)
          if (secondaryPaneRef.current.editor?.getModel() === existing) secondaryPaneRef.current.editor.setModel(null)
          if (tertiaryPaneRef.current.editor?.getModel() === existing) tertiaryPaneRef.current.editor.setModel(null)
          existing.dispose()
          modelsRef.current.delete(file.path)
        }
        continue
      }
      const uri = monaco.Uri.from({ scheme: 'file', path: file.path })
      const monacoLang = file.name.toLowerCase().endsWith('.svg') ? 'xml' : file.language
      const existing = modelsRef.current.get(file.path)
      if (!existing) {
        modelsRef.current.set(file.path, monaco.editor.createModel(file.content, monacoLang, uri))
        continue
      }
      monaco.editor.setModelLanguage(existing, monacoLang)
      if (existing.getValue() !== file.content) {
        existing.setValue(file.content)
      }
    }
  }, [files, hydrated])

  useEffect(() => {
    syncPaneModel(primaryPaneRef.current, primaryFile, 'primary', activeEditorPane === 'primary')
  }, [activeEditorPane, primaryFile, primaryView])

  useEffect(() => {
    syncPaneModel(secondaryPaneRef.current, secondaryFile, 'secondary', activeEditorPane === 'secondary')
  }, [activeEditorPane, secondaryFile, secondaryView])

  useEffect(() => {
    syncPaneModel(tertiaryPaneRef.current, tertiaryFile, 'tertiary', activeEditorPane === 'tertiary')
  }, [activeEditorPane, tertiaryFile, tertiaryView])

  useEffect(() => {
    syncDecorations(primaryPaneRef.current, primaryFile, highlightedHandler)
    syncDecorations(secondaryPaneRef.current, secondaryFile, highlightedHandler)
    syncDecorations(tertiaryPaneRef.current, tertiaryFile, highlightedHandler)
  }, [highlightedHandler, primaryFile, secondaryFile, tertiaryFile])

  return (
    <div className="flex h-full w-full min-w-0">
      <EditorPaneChrome
        header={showPaneHeaders ? (
          <PaneTabHeader
            paths={primaryTabs}
            activePath={primaryPath}
            itemLabels={itemLabels}
            active={activeEditorPane === 'primary'}
            paneId="primary"
            runtime={primaryView ? null : primaryRuntime}
            onRun={primaryView ? undefined : () => void runPane('primary')}
            onStop={primaryView ? undefined : () => void stopPane('primary')}
            onStartTabDrag={onStartTabDrag}
            onEndTabDrag={onEndTabDrag}
            onReorderTab={onReorderTab}
          />
        ) : undefined}
        active={activeEditorPane === 'primary'}
        dropPane={dragDropActive ? 'primary' : null}
        dropActive={hoveredDropPane === 'primary'}
        onHoverDropPane={onHoverDropPane}
        onLeaveDropPane={onLeaveDropPane}
        onDropToPane={onDropToPane}
        onDropExternalFiles={(filesToImport, pane) => onImportExternalFiles(filesToImport, pane, null)}
        onFocus={() => {
          focusEditorPane('primary')
          focusPaneRuntime('primary')
          setActivePanel('editor')
        }}
      >
        <PaneContent
          containerRef={primaryContainerRef}
          paneRef={primaryPaneRef}
          view={primaryView}
          path={primaryPath}
          file={primaryFile}
          splitMode={primaryPath ? paneModes[primaryPath] : undefined}
          onChangeSplitMode={(mode) => primaryPath && setPaneMode(primaryPath, mode)}
        />
      </EditorPaneChrome>

      {secondaryPath || previewPaneCount >= 2 ? (
        <>
          <div className="w-px bg-bs-border" />
          <EditorPaneChrome
            header={showPaneHeaders ? (
              secondaryPath ? (
                <PaneTabHeader
                  paths={secondaryTabs}
                  activePath={secondaryPath}
                  itemLabels={itemLabels}
                  active={activeEditorPane === 'secondary'}
                  paneId="secondary"
                  runtime={secondaryView ? null : secondaryRuntime}
                  onRun={secondaryView ? undefined : () => void runPane('secondary')}
                  onStop={secondaryView ? undefined : () => void stopPane('secondary')}
                  onClose={() => assignFileToPane('secondary', null)}
                  onStartTabDrag={onStartTabDrag}
                  onEndTabDrag={onEndTabDrag}
                  onReorderTab={onReorderTab}
                />
              ) : dragPreviewActive ? (
                <PreviewPaneHeader label="Pane 2" />
              ) : undefined
            ) : undefined}
            active={activeEditorPane === 'secondary'}
            dropPane={dragDropActive ? 'secondary' : null}
            dropActive={hoveredDropPane === 'secondary'}
            onHoverDropPane={onHoverDropPane}
            onLeaveDropPane={onLeaveDropPane}
            onDropToPane={onDropToPane}
            onDropExternalFiles={(filesToImport, pane) => onImportExternalFiles(filesToImport, pane, null)}
            onFocus={() => {
              focusEditorPane('secondary')
              focusPaneRuntime('secondary')
              setActivePanel('editor')
            }}
          >
            {secondaryPath ? (
              <PaneContent
                containerRef={secondaryContainerRef}
                paneRef={secondaryPaneRef}
                view={secondaryView}
                path={secondaryPath}
                file={secondaryFile}
                splitMode={secondaryPath ? paneModes[secondaryPath] : undefined}
                onChangeSplitMode={(mode) => secondaryPath && setPaneMode(secondaryPath, mode)}
              />
            ) : (
              <PreviewPaneBody label="Drop Here" hint="Open a second pane" active={hoveredDropPane === 'secondary'} />
            )}
          </EditorPaneChrome>
        </>
      ) : null}

      {tertiaryPath || previewPaneCount >= 3 ? (
        <>
          <div className="w-px bg-bs-border" />
          <EditorPaneChrome
            header={showPaneHeaders ? (
              tertiaryPath ? (
                <PaneTabHeader
                  paths={tertiaryTabs}
                  activePath={tertiaryPath}
                  itemLabels={itemLabels}
                  active={activeEditorPane === 'tertiary'}
                  paneId="tertiary"
                  runtime={tertiaryView ? null : tertiaryRuntime}
                  onRun={tertiaryView ? undefined : () => void runPane('tertiary')}
                  onStop={tertiaryView ? undefined : () => void stopPane('tertiary')}
                  onClose={() => assignFileToPane('tertiary', null)}
                  onStartTabDrag={onStartTabDrag}
                  onEndTabDrag={onEndTabDrag}
                  onReorderTab={onReorderTab}
                />
              ) : dragPreviewActive ? (
                <PreviewPaneHeader label="Pane 3" />
              ) : undefined
            ) : undefined}
            active={activeEditorPane === 'tertiary'}
            dropPane={dragDropActive ? 'tertiary' : null}
            dropActive={hoveredDropPane === 'tertiary'}
            onHoverDropPane={onHoverDropPane}
            onLeaveDropPane={onLeaveDropPane}
            onDropToPane={onDropToPane}
            onDropExternalFiles={(filesToImport, pane) => onImportExternalFiles(filesToImport, pane, null)}
            onFocus={() => {
              focusEditorPane('tertiary')
              focusPaneRuntime('tertiary')
              setActivePanel('editor')
            }}
          >
            {tertiaryPath ? (
              <PaneContent
                containerRef={tertiaryContainerRef}
                paneRef={tertiaryPaneRef}
                view={tertiaryView}
                path={tertiaryPath}
                file={tertiaryFile}
                splitMode={tertiaryPath ? paneModes[tertiaryPath] : undefined}
                onChangeSplitMode={(mode) => tertiaryPath && setPaneMode(tertiaryPath, mode)}
              />
            ) : (
              <PreviewPaneBody label="Drop Here" hint="Open another pane" active={hoveredDropPane === 'tertiary'} />
            )}
          </EditorPaneChrome>
        </>
      ) : null}

    </div>
  )

  function syncPaneModel(
    pane: PaneHandle,
    file: WorkspaceFile | null,
    paneId: EditorPaneId,
    focus: boolean,
  ) {
    const editor = pane.editor
    if (!editor) return
    if (!file || isRasterImageFile(file) || isVideoFile(file) || isPdfFile(file) || isXlsxFile(file) || isArchiveFile(file)) {
      if (editor.getModel()) {
        editor.setModel(null)
      }
      return
    }

    const nextModel = modelsRef.current.get(file.path)
    if (!nextModel) return

    const currentModel = editor.getModel()
    if (currentModel?.uri.path && currentModel !== nextModel) {
      viewStatesRef.current.set(`${paneId}:${currentModel.uri.path}`, editor.saveViewState())
    }

    if (currentModel !== nextModel) {
      editor.setModel(nextModel)
    }

    const viewState = viewStatesRef.current.get(`${paneId}:${file.path}`)
    if (viewState) {
      editor.restoreViewState(viewState)
    }

    if (focus) {
      editor.focus()
    }
  }

  function ensurePane(
    pane: PaneHandle,
    container: HTMLDivElement | null,
    onUpdateFile: (path: string, content: string) => void,
    paneId: EditorPaneId,
  ) {
    if (!container || pane.editor) return

    pane.container = container
    pane.editor = monaco.editor.create(container, {
      automaticLayout: true,
      fontSize: 13,
      lineNumbers: 'on',
      minimap: { enabled: false },
      model: null,
      padding: { top: 8 },
      renderLineHighlight: 'all',
      scrollBeyondLastLine: false,
      theme: 'browserver',
    })
    pane.decorations = pane.editor.createDecorationsCollection([])
    pane.editor.onDidChangeModelContent(() => {
      const model = pane.editor?.getModel()
      if (!model) return

      const path = model.uri.path
      const content = model.getValue()
      const existing = useWorkspaceStore.getState().files.find((file) => file.path === path)
      if (existing && existing.content !== content) {
        onUpdateFile(path, content)
      }
    })
    pane.editor.onDidFocusEditorText(() => {
      useWorkspaceStore.getState().focusEditorPane(paneId)
      useWorkspaceStore.getState().setActivePanel('editor')
      useRuntimeStore.getState().focusPaneRuntime(paneId)
    })
  }
}

function isSvgFile(file: WorkspaceFile | null): boolean {
  return Boolean(file && file.name.toLowerCase().endsWith('.svg'))
}

function isNotebookFile(file: WorkspaceFile | null): boolean {
  return Boolean(file && file.name.toLowerCase().endsWith('.ipynb'))
}

function PaneContent({
  containerRef,
  paneRef,
  view,
  path,
  file,
  splitMode,
  onChangeSplitMode,
}: {
  containerRef: { current: HTMLDivElement | null }
  paneRef: { current: PaneHandle }
  view: string | null
  path: string | null
  file: WorkspaceFile | null
  splitMode?: PaneSplitMode
  onChangeSplitMode: (mode: PaneSplitMode) => void
}) {
  const isMarkdown = file?.language === 'markdown'
  const isSvg = isSvgFile(file)
  const isHtml = file?.language === 'html'
  const isNotebook = isNotebookFile(file)
  const isImage = isRasterImageFile(file)
  const isVideo = isVideoFile(file)
  const isPdf = isPdfFile(file)
  const isCsv = isCsvFile(file)
  const isXlsx = isXlsxFile(file)
  const isArchive = isArchiveFile(file)
  const hasSplit = (isMarkdown || isSvg || isHtml || isNotebook) && !view
  const mode = hasSplit ? (splitMode ?? 'split') : 'code'

  return (
    <div className="flex h-full w-full flex-col">
      {hasSplit ? (
        <div className="flex h-[26px] flex-none items-center justify-end border-b border-bs-border bg-bs-bg-panel px-2">
          {isMarkdown ? (
            <MarkdownToolbar mode={mode} onChangeMode={onChangeSplitMode} />
          ) : isSvg ? (
            <SvgToolbar mode={mode as SvgMode} onChangeMode={onChangeSplitMode} />
          ) : isNotebook ? (
            <NotebookToolbar mode={mode as NotebookMode} onChangeMode={onChangeSplitMode} />
          ) : (
            <HtmlToolbar mode={mode as HtmlMode} onChangeMode={onChangeSplitMode} />
          )}
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1">
        <div
          ref={containerRef}
          className={`h-full ${
            view || isImage || isVideo || isPdf || isCsv || isXlsx || isArchive ? 'hidden'
              : mode === 'preview' ? 'hidden'
              : mode === 'split' ? 'w-1/2'
              : 'w-full'
          }`}
        />
        {isImage && file ? (
          <ImagePreview content={file.content} name={file.name} />
        ) : null}
        {isVideo && file ? (
          <VideoPreview content={file.content} name={file.name} />
        ) : null}
        {isPdf && file ? (
          <PdfPreview content={file.content} name={file.name} />
        ) : null}
        {(isCsv || isXlsx) && file ? (
          <SpreadsheetPreview file={file} />
        ) : null}
        {isArchive && file ? (
          <ArchivePreview file={file} />
        ) : null}
        {isMarkdown && !view && mode !== 'code' ? (
          <>
            {mode === 'split' ? <div className="w-px flex-none bg-bs-border" /> : null}
            <div className={`min-w-0 ${mode === 'split' ? 'w-1/2' : 'w-full'}`}>
              <MarkdownPreview content={file.content} editor={paneRef.current.editor} />
            </div>
          </>
        ) : null}
        {isSvg && !view && mode !== 'code' && file ? (
          <>
            {mode === 'split' ? <div className="w-px flex-none bg-bs-border" /> : null}
            <div className={`min-w-0 ${mode === 'split' ? 'w-1/2' : 'w-full'}`}>
              <SvgPreview content={file.content} />
            </div>
          </>
        ) : null}
        {isHtml && !view && mode !== 'code' && file ? (
          <>
            {mode === 'split' ? <div className="w-px flex-none bg-bs-border" /> : null}
            <div className={`min-w-0 ${mode === 'split' ? 'w-1/2' : 'w-full'}`}>
              <HtmlPreview content={file.content} />
            </div>
          </>
        ) : null}
        {isNotebook && !view && mode !== 'code' && file ? (
          <>
            {mode === 'split' ? <div className="w-px flex-none bg-bs-border" /> : null}
            <div className={`min-w-0 ${mode === 'split' ? 'w-1/2' : 'w-full'}`}>
              <NotebookPreview content={file.content} onUpdateContent={(nextContent) => useWorkspaceStore.getState().updateFileContent(file.path, nextContent)} />
            </div>
          </>
        ) : null}
        {view && path ? (
          <div className="absolute inset-0">
            <EditorViewHost path={path} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function PdfPreview({ content, name }: { content: string; name: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bs-bg-panel">
      <div className="flex h-[28px] flex-none items-center border-b border-bs-border bg-bs-bg-panel px-2 text-[10px]">
        <span className="truncate text-bs-text-faint">{name}</span>
        <div className="flex-1" />
        <span className="text-bs-text-faint">PDF</span>
      </div>
      <div className="min-h-0 flex-1 bg-bs-bg-editor p-2">
        <iframe
          src={content}
          title={name}
          className="h-full w-full rounded border border-bs-border bg-white"
        />
      </div>
    </div>
  )
}

function VideoPreview({ content, name }: { content: string; name: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bs-bg-panel">
      <div className="flex h-[28px] flex-none items-center border-b border-bs-border bg-bs-bg-panel px-2 text-[10px]">
        <span className="truncate text-bs-text-faint">{name}</span>
        <div className="flex-1" />
        <span className="text-bs-text-faint">Video</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black p-4">
        <video
          src={content}
          controls
          className="max-h-full max-w-full"
          preload="metadata"
        />
      </div>
    </div>
  )
}

function SpreadsheetPreview({ file }: { file: WorkspaceFile }) {
  const workbookData = useMemo(() => {
    try {
      if (isXlsxFile(file)) {
        const workbook = XLSX.read(decodeBase64Payload(file.content), { type: 'array' })
        return workbook.SheetNames.map((sheetName) => ({
          sheetName,
          rows: XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(workbook.Sheets[sheetName], {
            header: 1,
            raw: false,
          }),
        }))
      }

      const workbook = XLSX.read(file.content, { type: 'string' })
      return workbook.SheetNames.map((sheetName) => ({
        sheetName,
        rows: XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(workbook.Sheets[sheetName], {
          header: 1,
          raw: false,
        }),
      }))
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Could not parse spreadsheet',
        sheets: [] as Array<{ sheetName: string; rows: Array<Array<string | number | boolean | null>> }>,
      }
    }
  }, [file])

  const sheets = Array.isArray(workbookData) ? workbookData : workbookData.sheets
  const error = Array.isArray(workbookData) ? null : workbookData.error
  const [activeSheet, setActiveSheet] = useState(0)

  useEffect(() => {
    setActiveSheet(0)
  }, [file.path])

  const sheet = sheets[activeSheet] ?? sheets[0] ?? null
  const rows = sheet?.rows ?? []
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bs-bg-panel">
      <div className="flex h-[28px] flex-none items-center gap-1 border-b border-bs-border bg-bs-bg-panel px-2 text-[10px]">
        <span className="truncate text-bs-text-faint">{file.name}</span>
        <div className="flex-1" />
        {sheets.length > 1 ? (
          <div className="flex items-center gap-1 overflow-hidden">
            {sheets.map((entry, index) => (
              <button
                key={entry.sheetName}
                onClick={() => setActiveSheet(index)}
                className={`rounded px-2 py-0.5 ${
                  index === activeSheet
                    ? 'bg-bs-bg-active text-bs-text'
                    : 'bg-bs-bg-hover text-bs-text-faint hover:text-bs-text'
                }`}
              >
                {entry.sheetName}
              </button>
            ))}
          </div>
        ) : (
          <span className="text-bs-text-faint">{isXlsxFile(file) ? 'XLSX' : 'CSV'}</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-bs-bg-editor">
        {error ? (
          <div className="p-3 text-[11px] text-bs-error">{error}</div>
        ) : !sheet ? (
          <div className="p-3 text-[11px] text-bs-text-faint">No spreadsheet data</div>
        ) : (
          <table className="min-w-full border-separate border-spacing-0 text-[11px]">
            <thead className="sticky top-0 z-10 bg-bs-bg-panel">
              <tr>
                <th className="border-b border-r border-bs-border bg-bs-bg-panel px-2 py-1 text-left text-bs-text-faint">#</th>
                {Array.from({ length: columnCount }, (_, index) => (
                  <th
                    key={index}
                    className="border-b border-r border-bs-border bg-bs-bg-panel px-2 py-1 text-left text-bs-text-faint"
                  >
                    {columnLabel(index)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td className="border-b border-r border-bs-border bg-bs-bg-panel px-2 py-1 text-bs-text-faint">
                    {rowIndex + 1}
                  </td>
                  {Array.from({ length: columnCount }, (_, columnIndex) => (
                    <td
                      key={columnIndex}
                      className="border-b border-r border-bs-border px-2 py-1 align-top text-bs-text"
                    >
                      {String(row[columnIndex] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function ArchivePreview({ file }: { file: WorkspaceFile }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bs-bg-panel">
      <div className="flex h-[28px] flex-none items-center border-b border-bs-border bg-bs-bg-panel px-2 text-[10px]">
        <span className="truncate text-bs-text-faint">{file.name}</span>
        <div className="flex-1" />
        <span className="text-bs-text-faint">Archive</span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded border border-bs-border bg-bs-bg-sidebar px-4 py-3 text-[11px] text-bs-text-muted">
          This archive was kept zipped. Drop it again and choose <span className="text-bs-text">extract</span> if you want its contents imported into the workspace.
        </div>
      </div>
    </div>
  )
}

function columnLabel(index: number): string {
  let value = index + 1
  let label = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    value = Math.floor((value - 1) / 26)
  }
  return label
}

function decodeBase64Payload(source: string): Uint8Array {
  const payload = source.includes(',') ? source.slice(source.indexOf(',') + 1) : source
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function ImagePreview({ content, name }: { content: string; name: string }) {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)

  const clampZoom = (value: number) => Math.max(0.1, Math.min(8, Number(value.toFixed(2))))

  const updateZoom = (nextZoom: number) => {
    setZoom(clampZoom(nextZoom))
  }

  const resetView = () => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.1 : 0.9
    updateZoom(zoom * factor)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[linear-gradient(45deg,var(--bs-bg-panel)_25%,transparent_25%,transparent_75%,var(--bs-bg-panel)_75%,var(--bs-bg-panel)),linear-gradient(45deg,var(--bs-bg-panel)_25%,transparent_25%,transparent_75%,var(--bs-bg-panel)_75%,var(--bs-bg-panel))] bg-[length:24px_24px] bg-[position:0_0,12px_12px]">
      <div className="flex h-[28px] flex-none items-center gap-1 border-b border-bs-border bg-bs-bg-panel px-2 text-[10px]">
        <button
          onClick={() => updateZoom(zoom / 1.15)}
          className="rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text-muted hover:text-bs-text"
          title="Zoom out"
        >
          -
        </button>
        <button
          onClick={() => updateZoom(zoom * 1.15)}
          className="rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text-muted hover:text-bs-text"
          title="Zoom in"
        >
          +
        </button>
        <button
          onClick={resetView}
          className="rounded bg-bs-bg-hover px-2 py-0.5 text-bs-text-muted hover:text-bs-text"
          title="Reset zoom and pan"
        >
          fit
        </button>
        <span className="ml-1 text-bs-text-faint">{Math.round(zoom * 100)}%</span>
        <div className="flex-1" />
        <span className="truncate text-bs-text-faint">{name}</span>
      </div>
      <div
        className={`relative min-h-0 flex-1 overflow-hidden p-6 ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
        onWheel={onWheel}
        onDoubleClick={resetView}
        onMouseDown={(event) => {
          if (event.button !== 0 || zoom <= 1) return
          event.preventDefault()
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            offsetX: offset.x,
            offsetY: offset.y,
          }
        }}
        onMouseMove={(event) => {
          const drag = dragRef.current
          if (!drag) return
          setOffset({
            x: drag.offsetX + (event.clientX - drag.x),
            y: drag.offsetY + (event.clientY - drag.y),
          })
        }}
        onMouseUp={() => {
          dragRef.current = null
        }}
        onMouseLeave={() => {
          dragRef.current = null
        }}
      >
        <div className="flex h-full w-full items-center justify-center">
          <img
            src={content}
            alt={name}
            className="max-h-full max-w-full rounded border border-bs-border bg-bs-bg shadow-[0_18px_50px_rgba(0,0,0,0.28)] select-none"
            draggable={false}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
            }}
          />
        </div>
      </div>
    </div>
  )
}

function EditorPaneChrome({
  header,
  active,
  dropPane,
  dropActive,
  onHoverDropPane,
  onLeaveDropPane,
  onDropToPane,
  onDropExternalFiles,
  onFocus,
  children,
}: {
  header?: React.ReactNode
  active: boolean
  dropPane?: EditorPaneId | null
  dropActive?: boolean
  onHoverDropPane?: (pane: EditorPaneId) => void
  onLeaveDropPane?: () => void
  onDropToPane?: (pane: EditorPaneId) => void
  onDropExternalFiles?: (files: FileList, pane: EditorPaneId) => void
  onFocus: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className={`relative flex min-w-0 flex-1 flex-col ${active ? 'bg-bs-bg-editor' : 'bg-bs-bg-panel'} ${
        dropActive ? 'bg-bs-accent/10' : ''
      }`}
      onMouseEnter={() => {
        if (dropPane && onHoverDropPane) onHoverDropPane(dropPane)
      }}
      onMouseLeave={() => {
        if (dropPane && onLeaveDropPane) onLeaveDropPane()
      }}
      onMouseUp={() => {
        if (dropPane && onDropToPane) onDropToPane(dropPane)
      }}
      onDragOver={(event) => {
        if (!dropPane || !onDropExternalFiles || !hasExternalFiles(event.dataTransfer)) return
        event.preventDefault()
        if (onHoverDropPane) onHoverDropPane(dropPane)
      }}
      onDrop={(event) => {
        if (!dropPane || !onDropExternalFiles || event.dataTransfer.files.length === 0) return
        event.preventDefault()
        event.stopPropagation()
        onDropExternalFiles(event.dataTransfer.files, dropPane)
        if (onLeaveDropPane) onLeaveDropPane()
      }}
      onMouseDown={onFocus}
    >
      {header ? <div className="flex-none border-b border-bs-border">{header}</div> : null}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function PreviewPaneHeader({ label }: { label: string }) {
  return (
    <div className="flex h-[30px] items-center border-b border-bs-border bg-bs-bg-panel px-3 text-xs text-bs-text-faint">
      {label}
    </div>
  )
}

function PreviewPaneBody({
  label,
  hint,
  active,
}: {
  label: string
  hint: string
  active: boolean
}) {
  return (
    <div className={`flex h-full items-center justify-center px-4 text-center ${
      active ? 'bg-bs-accent/10' : 'bg-bs-bg-panel/70'
    }`}>
      <div>
        <div className="text-sm text-bs-text">{label}</div>
        <div className="mt-1 text-[11px] text-bs-text-muted">{hint}</div>
      </div>
    </div>
  )
}

function PaneTabHeader({
  paths,
  activePath,
  itemLabels,
  active,
  paneId,
  runtime,
  onRun,
  onStop,
  onClose,
  onStartTabDrag,
  onEndTabDrag,
  onReorderTab,
}: {
  paths: string[]
  activePath: string | null
  itemLabels: Record<string, string>
  active: boolean
  paneId: EditorPaneId
  runtime: ReturnType<ReturnType<typeof selectPaneRuntimeSession>> | null
  onRun?: () => void
  onStop?: () => void
  onClose?: () => void
  onStartTabDrag: (path: string) => void
  onEndTabDrag: () => void
  onReorderTab: (path: string, beforePath: string) => void
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
  const openEditorView = useWorkspaceStore((state) => state.openEditorView)
  const createFile = useWorkspaceStore((state) => state.createFile)
  const setActiveFile = useWorkspaceStore((state) => state.setActiveFile)
  const closeFile = useWorkspaceStore((state) => state.closeFile)
  const closePaths = useWorkspaceStore((state) => state.closePaths)
  const assignFileToPane = useWorkspaceStore((state) => state.assignFileToPane)
  const splitFileToPane = useWorkspaceStore((state) => state.splitFileToPane)
  const isRunning = runtime?.mode === 'server' && (runtime.status === 'running' || runtime.status === 'starting')
  const statusTone = isRunning
    ? 'text-bs-good'
    : runtime?.status === 'error'
      ? 'text-bs-error'
      : 'text-bs-text-faint'
  const unopenedFiles = files
    .filter((file) => !openFilePaths.includes(file.path))
    .map((file) => ({
      id: `pane.${paneId}.existing.${file.path}`,
      label: file.name,
      hint: file.language,
      run: () => setActiveFile(file.path, paneId),
    }))
  const newTabItems = [
    {
      id: `pane.${paneId}.file.new`,
      label: 'New File',
      hint: 'TypeScript',
      run: () => createFile(paneId),
    },
    {
      id: `pane.${paneId}.file.existing`,
      label: 'Existing File',
      hint: unopenedFiles.length === 0 ? 'All open' : `${unopenedFiles.length} available`,
      disabled: unopenedFiles.length === 0,
      children: unopenedFiles,
    },
    ...editorViewDefinitions.map((view) => ({
      id: `pane.${paneId}.${view.id}`,
      label: view.label,
      hint: 'In this pane',
      run: () => openEditorView(view.id, paneId),
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
          && (
            event.clientX < rect.left - 6
            || event.clientX > rect.right + 6
            || event.clientY < rect.top - 6
            || event.clientY > rect.bottom + 6
          )
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

    if (paneId !== 'secondary') {
      actions.push({
        id: 'move.secondary',
        label: paths.includes(path) && paneId === 'primary' ? 'Move To Pane 2' : 'Split To New Pane',
        run: () => {
          if (paneId === 'primary') {
            splitFileToPane('secondary', path)
          } else {
            assignFileToPane('secondary', path)
          }
          useWorkspaceStore.getState().focusEditorPane('secondary')
          setContextMenu(null)
        },
      })
    }

    if (paneId !== 'tertiary' && useWorkspaceStore.getState().paneTabs.secondary.tabs.length > 0) {
      actions.push({
        id: 'move.tertiary',
        label: useWorkspaceStore.getState().paneTabs.tertiary.tabs.length > 0 ? 'Move To Pane 3' : 'Split To Third Pane',
        run: () => {
          if (useWorkspaceStore.getState().paneTabs.tertiary.tabs.length > 0) {
            assignFileToPane('tertiary', path)
          } else {
            splitFileToPane('tertiary', path)
          }
          useWorkspaceStore.getState().focusEditorPane('tertiary')
          setContextMenu(null)
        },
      })
    }

    if (paneId !== 'primary') {
      actions.push({
        id: 'move.primary',
        label: 'Move To Pane 1',
        run: () => {
          assignFileToPane('primary', path)
          useWorkspaceStore.getState().focusEditorPane('primary')
          setContextMenu(null)
        },
      })
    }

    const index = paths.indexOf(path)
    if (index !== -1) {
      actions.push({
        id: 'close.current',
        label: 'Close',
        run: () => {
          closeFile(path)
          setContextMenu(null)
        },
      })
      actions.push({
        id: 'close.all',
        label: 'Close All',
        run: () => {
          closePaths(paths)
          setContextMenu(null)
        },
      })
      actions.push({
        id: 'close.others',
        label: 'Close Others',
        run: () => {
          closePaths(paths.filter((entry) => entry !== path))
          setContextMenu(null)
        },
      })
      actions.push({
        id: 'close.left',
        label: 'Close Tabs To Left',
        run: () => {
          closePaths(paths.slice(0, index))
          setContextMenu(null)
        },
      })
      actions.push({
        id: 'close.right',
        label: 'Close Tabs To Right',
        run: () => {
          closePaths(paths.slice(index + 1))
          setContextMenu(null)
        },
      })
    }

    return actions
  }, [assignFileToPane, closeFile, closePaths, contextMenu, paneId, paths, splitFileToPane])

  return (
    <div ref={rootRef} className="flex h-[30px] items-stretch justify-between overflow-hidden bg-bs-bg-panel px-2">
      <div className="flex h-full min-w-0 flex-1 items-stretch overflow-hidden">
        <div className="no-scrollbar flex h-full min-w-0 flex-none overflow-x-auto overflow-y-hidden">
          {paths.map((path) => {
            const title = itemLabels[path] ?? path
            const isTabActive = path === activePath
            return (
              <div
                key={path}
                onClick={() => {
                  if (suppressClickPathRef.current === path) {
                    suppressClickPathRef.current = null
                    return
                  }
                  setActiveFile(path, paneId)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setActiveFile(path, paneId)
                  setContextMenu({
                    path,
                    x: event.clientX,
                    y: event.clientY,
                  })
                }}
              onMouseDown={(event: ReactMouseEvent<HTMLDivElement>) => {
                if (event.button !== 0) return
                event.preventDefault()
                pendingDragRef.current = {
                  path,
                  startX: event.clientX,
                  startY: event.clientY,
                    dragging: false,
                    splitMode: false,
                  }
                }}
                onMouseEnter={() => {
                  const pending = pendingDragRef.current
                  if (!pending?.dragging || pending.splitMode || pending.path === path) return
                  setReorderTargetPath(path)
                }}
                onMouseLeave={() => {
                  if (reorderTargetPath === path) {
                    setReorderTargetPath(null)
                  }
                }}
                onMouseUp={() => {
                  const pending = pendingDragRef.current
                  if (!pending?.dragging || pending.splitMode || pending.path === path) return
                  onReorderTab(pending.path, path)
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
                className={`flex h-full min-w-0 cursor-pointer select-none items-center gap-2 border-r border-bs-border px-3 text-xs whitespace-nowrap ${
                  isTabActive
                    ? 'border-t-2 border-t-bs-accent bg-bs-tab-active text-bs-text'
                    : 'border-t-2 border-t-transparent bg-bs-tab-inactive text-bs-text-muted hover:bg-bs-tab-hover hover:text-bs-text'
                } ${reorderTargetPath === path ? 'shadow-[inset_2px_0_0_0_var(--bs-accent)]' : ''}`}
              >
                {isTabActive && runtime ? (
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isRunning
                        ? 'bg-bs-good'
                        : runtime.status === 'error'
                          ? 'bg-bs-error'
                          : 'bg-bs-text-faint'
                    }`}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="truncate">{title}</span>
                {paths.length > 1 || onClose ? (
                  <button
                    onClick={(event) => {
                      event.stopPropagation()
                      if (path === activePath && onClose && paths.length === 1) {
                        onClose()
                      } else {
                        closeFile(path)
                      }
                    }}
                    className="text-bs-text-faint hover:text-bs-text"
                    aria-label={`Close ${title}`}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
        <div className="flex h-full flex-none items-center overflow-hidden border-r border-bs-border bg-bs-tab-inactive px-1">
          <MenuButton
            label="+"
            title="Open a workbench section in this pane"
            items={newTabItems}
          />
        </div>
      </div>
      <div className="flex h-full flex-none items-center gap-2 bg-bs-tab-inactive pl-3">
        {runtime ? (
          <>
            <span className={`text-[9px] uppercase leading-none tracking-wide ${statusTone}`}>
              {runtime.status}
            </span>
            <button
              onClick={(event) => {
                event.stopPropagation()
                if (isRunning) {
                  onStop?.()
                } else {
                  onRun?.()
                }
              }}
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] leading-none ${
                isRunning
                  ? 'bg-bs-error text-bs-accent-text'
                  : 'bg-bs-good text-bs-accent-text'
              }`}
              aria-label={isRunning ? `Stop ${itemLabels[activePath ?? ''] ?? activePath ?? paneId}` : `Run ${itemLabels[activePath ?? ''] ?? activePath ?? paneId}`}
              title={
                isRunning
                  ? 'Stop this pane runtime'
                  : runtime.mode === 'client' || (itemLabels[activePath ?? ''] ?? '').toLowerCase().startsWith('client')
                    ? 'Run this pane as a client'
                    : 'Run this pane as a server'
              }
            >
              {isRunning ? '■' : '▶'}
            </button>
          </>
        ) : null}
      </div>
      {contextMenu && contextActions.length > 0 ? (
        <div
          className="fixed z-[2000] min-w-48 overflow-hidden rounded border border-bs-border bg-bs-bg-panel shadow-[0_18px_50px_rgba(0,0,0,0.4)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextActions.map((action) => (
            <button
              key={action.id}
              onClick={action.run}
              className="flex w-full items-center px-3 py-2 text-left text-[11px] text-bs-text-muted hover:bg-bs-bg-hover hover:text-bs-text"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function SplitDropOverlay({
  visiblePaneCount,
  hoveredPane,
  onDropFileToPane,
  onHoverPane,
  onLeavePane,
}: {
  visiblePaneCount: number
  hoveredPane: EditorPaneId | null
  onDropFileToPane: (pane: EditorPaneId) => void
  onHoverPane: (pane: EditorPaneId) => void
  onLeavePane: () => void
}) {
  const previewTargets: Array<{ pane: EditorPaneId; label: string; kind: 'existing' | 'new' }> =
    visiblePaneCount <= 1
      ? [
          { pane: 'primary', label: 'Pane 1', kind: 'existing' },
          { pane: 'secondary', label: 'Pane 2', kind: 'new' },
        ]
      : visiblePaneCount === 2
        ? [
            { pane: 'primary', label: 'Pane 1', kind: 'existing' },
            { pane: 'secondary', label: 'Pane 2', kind: 'existing' },
            { pane: 'tertiary', label: 'Pane 3', kind: 'new' },
          ]
        : [
            { pane: 'primary', label: 'Pane 1', kind: 'existing' },
            { pane: 'secondary', label: 'Pane 2', kind: 'existing' },
            { pane: 'tertiary', label: 'Pane 3', kind: 'existing' },
          ]

  return (
    <div className="absolute inset-0 z-20 bg-bs-bg/38 p-0">
      <div
        className="grid h-full"
        style={{ gridTemplateColumns: `repeat(${previewTargets.length}, minmax(0, 1fr))` }}
      >
        {previewTargets.map((target, index) => (
          <DropTarget
            key={target.pane}
            target={{
              pane: target.pane,
              label: target.label,
              hint: target.kind === 'new' ? 'drop to open here' : 'drop to move here',
            }}
            kind={target.kind}
            hoveredPane={hoveredPane}
            onHoverPane={onHoverPane}
            onLeavePane={onLeavePane}
            onDropFileToPane={onDropFileToPane}
            className={index < previewTargets.length - 1 ? 'border-r border-bs-border' : ''}
          />
        ))}
      </div>
    </div>
  )
}

function DropTarget({
  target,
  kind,
  hoveredPane,
  onDropFileToPane,
  onHoverPane,
  onLeavePane,
  className = '',
}: {
  target: { pane: EditorPaneId; label: string; hint: string }
  kind: 'existing' | 'new'
  hoveredPane: EditorPaneId | null
  onDropFileToPane: (pane: EditorPaneId) => void
  onHoverPane: (pane: EditorPaneId) => void
  onLeavePane: () => void
  className?: string
}) {
  return (
    <div
      onMouseEnter={() => onHoverPane(target.pane)}
      onMouseLeave={onLeavePane}
      onMouseUp={() => onDropFileToPane(target.pane)}
      className={`flex h-full min-w-0 flex-col overflow-hidden text-center transition-colors ${
        hoveredPane === target.pane
          ? 'bg-bs-accent/12'
          : 'bg-bs-bg-panel/88 hover:bg-bs-bg-hover/70'
      } ${className}`}
    >
      <div className={`flex h-[30px] w-full items-center border-b px-3 text-[11px] ${
        hoveredPane === target.pane
          ? 'border-bs-accent bg-bs-bg-active text-bs-text'
          : 'border-bs-border bg-bs-bg-panel text-bs-text-faint'
      }`}>
        <span className="truncate">{target.label}</span>
      </div>
      <div className="flex flex-1 items-center justify-center px-3">
        <div>
          <div className="text-xs font-medium text-bs-text">
            {kind === 'new' ? 'New pane' : 'Existing pane'}
          </div>
          <div className="mt-1 text-[10px] text-bs-text-muted">{target.hint}</div>
        </div>
      </div>
    </div>
  )
}

function disposePane(pane: PaneHandle) {
  pane.decorations?.clear()
  pane.decorations = null
  pane.editor?.setModel(null)
  pane.editor?.dispose()
  pane.editor = null
  pane.container = null
}

function syncDecorations(pane: PaneHandle, file: WorkspaceFile | null, highlightedHandler: string | null) {
  const editor = pane.editor
  const model = editor?.getModel()
  const decorations = pane.decorations

  if (!editor || !model || !decorations) return

  if (!highlightedHandler || !file?.name.endsWith('.ts') || !file.name.startsWith('server')) {
    decorations.set([])
    return
  }

  const matches = model.findMatches(`\\b${escapeRegExp(highlightedHandler)}\\s*\\(`, false, true, false, null, true)
  const first = matches[0]
  if (!first) {
    decorations.set([])
    return
  }

  decorations.set([
    {
      range: new monaco.Range(first.range.startLineNumber, 1, first.range.startLineNumber, 1),
      options: {
        isWholeLine: true,
        className: 'bs-runtime-line',
        linesDecorationsClassName: 'bs-runtime-glyph',
      },
    },
  ])
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
