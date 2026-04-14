import { useEffect, useMemo, useState } from 'react'
import { useWorkspaceStore, type WorkspaceFile } from '../store/workspace'

export type HtmlMode = 'code' | 'split' | 'preview'

export function HtmlToolbar({
  mode,
  onChangeMode,
}: {
  mode: HtmlMode
  onChangeMode: (mode: HtmlMode) => void
}) {
  return (
    <div className="flex items-center gap-0.5">
      <ModeButton active={mode === 'code'} onClick={() => onChangeMode('code')} title="Source">
        <CodeIcon />
      </ModeButton>
      <ModeButton active={mode === 'split'} onClick={() => onChangeMode('split')} title="Split">
        <SplitIcon />
      </ModeButton>
      <ModeButton active={mode === 'preview'} onClick={() => onChangeMode('preview')} title="Preview">
        <PreviewIcon />
      </ModeButton>
    </div>
  )
}

export function HtmlPreview({
  content,
  filePath,
}: {
  content: string
  filePath: string
}) {
  const files = useWorkspaceStore((state) => state.files)
  const projectId = useWorkspaceStore((state) => state.sample.id)
  const [srcdoc, setSrcdoc] = useState(content)
  const fileMap = useMemo(() => buildWorkspaceAliasMap(files, projectId), [files, projectId])
  const fileName = useMemo(() => {
    const activeFile = files.find((file) => file.path === filePath)
    return activeFile?.name ?? stripProjectPrefix(filePath.split('/').filter(Boolean).join('/'), projectId)
  }, [filePath, files, projectId])

  useEffect(() => {
    let cancelled = false

    const next = buildHtmlPreviewDocument(content, fileName, fileMap)
    if (!cancelled) {
      setSrcdoc(next)
    }

    return () => {
      cancelled = true
    }
  }, [content, fileMap, fileName])

  return (
    <div className="flex h-full flex-col">
      <iframe
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        title="HTML preview"
        className="h-full w-full border-none bg-white"
      />
    </div>
  )
}

function buildWorkspaceAliasMap(
  files: WorkspaceFile[],
  projectId: string,
): Map<string, WorkspaceFile> {
  const map = new Map<string, WorkspaceFile>()

  for (const file of files) {
    const aliases = new Set([
      file.name,
      stripProjectPrefix(file.name, projectId),
      stripProjectLeafPrefix(file.name, projectId),
    ].filter(Boolean))

    for (const alias of aliases) {
      if (!map.has(alias)) {
        map.set(alias, file)
      }
    }
  }

  return map
}

function buildHtmlPreviewDocument(
  content: string,
  fileName: string,
  fileMap: Map<string, WorkspaceFile>,
): string {
  if (typeof DOMParser === 'undefined') return content

  const parser = new DOMParser()
  const document = parser.parseFromString(content, 'text/html')
  const cssCache = new Map<string, string>()
  const currentFolder = parentFolderName(fileName)

  for (const styleNode of Array.from(document.querySelectorAll('style'))) {
    styleNode.textContent = rewriteCssText(styleNode.textContent ?? '', fileName, fileMap, cssCache)
  }

  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[style]'))) {
    const inlineStyle = element.getAttribute('style')
    if (!inlineStyle) continue
    element.setAttribute('style', rewriteCssText(inlineStyle, fileName, fileMap, cssCache))
  }

  for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>('link[href]'))) {
    const rel = (link.getAttribute('rel') ?? '').toLowerCase()
    if (!rel.split(/\s+/).includes('stylesheet')) continue

    const resolvedName = resolveWorkspaceReference(fileName, link.getAttribute('href'))
    if (!resolvedName) continue

    const cssFile = fileMap.get(resolvedName)
    if (!cssFile) continue

    const style = document.createElement('style')
    style.setAttribute('data-browserver-source', resolvedName)
    style.textContent = loadCssFile(resolvedName, fileMap, cssCache)
    link.replaceWith(style)
  }

  for (const script of Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))) {
    const resolvedName = resolveWorkspaceReference(fileName, script.getAttribute('src'))
    if (!resolvedName) continue

    const scriptFile = fileMap.get(resolvedName)
    if (!scriptFile) continue

    script.removeAttribute('src')
    script.textContent = scriptFile.content
  }

  rewriteElementUrlAttribute(document, 'img', 'src', fileName, fileMap)
  rewriteElementUrlAttribute(document, 'source', 'src', fileName, fileMap)
  rewriteElementUrlAttribute(document, 'video', 'poster', fileName, fileMap)
  rewriteElementUrlAttribute(document, 'audio', 'src', fileName, fileMap)
  rewriteElementUrlAttribute(document, 'track', 'src', fileName, fileMap)
  rewriteElementUrlAttribute(document, 'embed', 'src', fileName, fileMap)
  rewriteElementUrlAttribute(document, 'object', 'data', fileName, fileMap)

  for (const source of Array.from(document.querySelectorAll<HTMLElement>('[srcset]'))) {
    const srcset = source.getAttribute('srcset')
    if (!srcset) continue
    source.setAttribute('srcset', rewriteSrcset(srcset, fileName, fileMap))
  }

  const serialized = document.documentElement.outerHTML
  const doctype = /^\s*<!doctype/i.test(content) ? '<!DOCTYPE html>\n' : ''
  const baseTag = currentFolder ? `<base href="${escapeHtmlAttribute(`/${currentFolder}/`)}">` : '<base href="/">'

  return injectIntoHead(`${doctype}${serialized}`, baseTag)
}

function rewriteElementUrlAttribute(
  document: Document,
  selector: string,
  attribute: string,
  ownerName: string,
  fileMap: Map<string, WorkspaceFile>,
): void {
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(`${selector}[${attribute}]`))) {
    const raw = element.getAttribute(attribute)
    if (!raw) continue
    const resolved = resolveWorkspaceAssetUrl(ownerName, raw, fileMap)
    if (resolved) {
      element.setAttribute(attribute, resolved)
    }
  }
}

function rewriteSrcset(
  srcset: string,
  ownerName: string,
  fileMap: Map<string, WorkspaceFile>,
): string {
  return srcset
    .split(',')
    .map((entry) => {
      const trimmed = entry.trim()
      if (!trimmed) return trimmed
      const firstSpace = trimmed.search(/\s/)
      const rawUrl = firstSpace >= 0 ? trimmed.slice(0, firstSpace) : trimmed
      const descriptor = firstSpace >= 0 ? trimmed.slice(firstSpace) : ''
      const resolved = resolveWorkspaceAssetUrl(ownerName, rawUrl, fileMap)
      return `${resolved ?? rawUrl}${descriptor}`
    })
    .join(', ')
}

function loadCssFile(
  fileName: string,
  fileMap: Map<string, WorkspaceFile>,
  cache: Map<string, string>,
): string {
  const cached = cache.get(fileName)
  if (cached !== undefined) return cached

  const file = fileMap.get(fileName)
  if (!file) return ''

  cache.set(fileName, '')
  const next = rewriteCssText(file.content, fileName, fileMap, cache)
  cache.set(fileName, next)
  return next
}

function rewriteCssText(
  cssText: string,
  ownerName: string,
  fileMap: Map<string, WorkspaceFile>,
  cache: Map<string, string>,
): string {
  let next = cssText.replace(/@import\s+(?:url\(\s*)?(['"]?)([^"')]+)\1\s*\)?\s*;/gi, (full, _quote, rawUrl: string) => {
    const resolvedName = resolveWorkspaceReference(ownerName, rawUrl)
    if (!resolvedName) return full
    if (!resolvedName.toLowerCase().endsWith('.css')) return full
    const imported = loadCssFile(resolvedName, fileMap, cache)
    return imported ? `\n${imported}\n` : full
  })

  next = next.replace(/url\(\s*(['"]?)([^"')]+)\1\s*\)/gi, (full, quote, rawUrl: string) => {
    const resolved = resolveWorkspaceAssetUrl(ownerName, rawUrl, fileMap)
    if (!resolved) return full
    const wrapped = quote || (/\s/.test(resolved) ? '"' : '')
    return `url(${wrapped}${resolved}${wrapped})`
  })

  return next
}

function resolveWorkspaceAssetUrl(
  ownerName: string,
  rawUrl: string,
  fileMap: Map<string, WorkspaceFile>,
): string | null {
  const resolvedName = resolveWorkspaceReference(ownerName, rawUrl)
  if (!resolvedName) return null

  const targetFile = fileMap.get(resolvedName)
  if (!targetFile) return null

  return fileContentToDataUrl(targetFile)
}

function resolveWorkspaceReference(ownerName: string, rawReference: string | null): string | null {
  const value = (rawReference ?? '').trim()
  if (!value) return null
  if (value.startsWith('#') || value.startsWith('//')) return null
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(value)) return null

  const [pathPart] = value.split(/[?#]/, 1)
  if (!pathPart) return null

  const segments = pathPart.startsWith('/')
    ? pathPart.split('/')
    : `${parentFolderName(ownerName) ?? ''}/${pathPart}`.split('/')

  const normalized: string[] = []
  for (const segment of segments) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      normalized.pop()
      continue
    }
    normalized.push(segment)
  }

  return normalized.join('/')
}

function stripProjectPrefix(name: string, projectId: string): string {
  const cleaned = name.replace(/^\/+/, '')
  const normalizedProject = projectId.replace(/^\/+|\/+$/g, '')
  if (!normalizedProject) return cleaned
  if (cleaned === normalizedProject) return ''
  if (cleaned.startsWith(`${normalizedProject}/`)) {
    return cleaned.slice(normalizedProject.length).replace(/^\/+/, '')
  }
  return cleaned
}

function stripProjectLeafPrefix(name: string, projectId: string): string {
  const cleaned = name.replace(/^\/+/, '')
  const leaf = projectId.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).at(-1) ?? ''
  if (!leaf) return cleaned
  if (cleaned === leaf) return ''
  if (cleaned.startsWith(`${leaf}/`)) {
    return cleaned.slice(leaf.length).replace(/^\/+/, '')
  }
  return cleaned
}

function fileContentToDataUrl(file: WorkspaceFile): string {
  if (file.content instanceof Uint8Array) {
    let binary = ''
    for (let i = 0; i < file.content.length; i++) binary += String.fromCharCode(file.content[i])
    return `data:${contentTypeForFile(file)};base64,${btoa(binary)}`
  }
  if (/^data:/i.test(file.content)) return file.content

  return `data:${contentTypeForFile(file)};charset=utf-8,${encodeURIComponent(file.content)}`
}

function contentTypeForFile(file: WorkspaceFile): string {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.css')) return 'text/css'
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'text/javascript'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.txt') || lower.endsWith('.md')) return 'text/plain'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.avif')) return 'image/avif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.ico')) return 'image/x-icon'
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}

function parentFolderName(name: string): string | null {
  const parts = name.split('/')
  if (parts.length <= 1) return null
  return parts.slice(0, -1).join('/')
}

function injectIntoHead(html: string, injected: string): string {
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${injected}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${injected}</head>`)
  }

  return `<head>${injected}</head>${html}`
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function ModeButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-[22px] w-[22px] items-center justify-center rounded text-[11px] ${
        active
          ? 'bg-bs-bg-active text-bs-text'
          : 'text-bs-text-faint hover:bg-bs-bg-hover hover:text-bs-text-muted'
      }`}
    >
      {children}
    </button>
  )
}

function CodeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5,3 1,8 5,13" />
      <polyline points="11,3 15,8 11,13" />
    </svg>
  )
}

function SplitIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="14" height="12" rx="1" />
      <line x1="8" y1="2" x2="8" y2="14" />
    </svg>
  )
}

function PreviewIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 4 L8 1 L15 4 L8 7 Z" />
      <path d="M1 4 V11 L8 14 L15 11 V4" />
      <line x1="8" y1="7" x2="8" y2="14" />
    </svg>
  )
}
