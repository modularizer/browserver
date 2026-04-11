import type { StoredWorkspaceLanguage } from '@browserver/storage'

interface WorkspaceLikeFile {
  name: string
  language: StoredWorkspaceLanguage
  content: string
}

export interface DetectedServeClientSideServerCall {
  name: string
  fileName: string
}

export interface ServeClientSideServerDetection {
  kind: 'none' | 'single' | 'multiple'
  calls: DetectedServeClientSideServerCall[]
}

const CODE_LANGUAGES = new Set<StoredWorkspaceLanguage>(['typescript', 'javascript'])
const CALL_PATTERN = /serveClientSideServer\s*\(\s*(['"`])([^'"`\n\r]+)\1/g

export function detectServeClientSideServerName(files: WorkspaceLikeFile[]): ServeClientSideServerDetection {
  const calls: DetectedServeClientSideServerCall[] = []

  for (const file of files) {
    if (!CODE_LANGUAGES.has(file.language)) continue

    CALL_PATTERN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = CALL_PATTERN.exec(file.content)) !== null) {
      const detectedName = (match[2] ?? '').trim()
      if (!detectedName) continue
      calls.push({
        name: detectedName,
        fileName: file.name,
      })
    }
  }

  const dedupedByFileAndName = new Map<string, DetectedServeClientSideServerCall>()
  for (const call of calls) {
    dedupedByFileAndName.set(`${call.fileName}::${call.name}`, call)
  }

  const uniqueCalls = Array.from(dedupedByFileAndName.values())
  const uniqueNames = new Set(uniqueCalls.map((call) => call.name))

  if (uniqueCalls.length === 0) {
    return { kind: 'none', calls: [] }
  }
  if (uniqueNames.size === 1) {
    return { kind: 'single', calls: uniqueCalls }
  }
  return { kind: 'multiple', calls: uniqueCalls }
}

