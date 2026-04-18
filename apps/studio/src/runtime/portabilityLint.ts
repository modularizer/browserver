import type { RuntimeDiagnostic } from './types'

/**
 * Non-portable bare specifiers the studio accepts locally but that will fail
 * when the same source is run against a real Node/Deno server. Each rule maps
 * the studio-only specifier to the portable replacement we want users to reach
 * for instead.
 */
const RULES: Array<{
  code: number
  match: RegExp
  replacement: (m: RegExpMatchArray) => string
  reason: string
}> = [
  {
    code: 9001,
    match: /^@modularizer\/plat-client(\/.*)?$/,
    replacement: (m) => `@modularizer/plat${m[1] ?? ''}`,
    reason: 'studio-only alias — use @modularizer/plat so the source also runs against a real server',
  },
  {
    code: 9002,
    match: /^fake-redis$/,
    replacement: () => 'redis',
    reason: 'studio-only shim — use `redis` so the same source runs against a real Redis server',
  },
  {
    code: 9003,
    match: /^plat\/static$/,
    replacement: () => '@modularizer/plat/static',
    reason: 'non-portable shortcut — use @modularizer/plat/static',
  },
]

const TS_FILE = /\.[cm]?[jt]sx?$/i

const IMPORT_FROM = /(?:^|\n)\s*(?:import|export)\b[^'"\n;]*from\s*(['"])([^'"]+)\1/g
const BARE_IMPORT = /(?:^|\n)\s*import\s*(['"])([^'"]+)\1/g
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(['"])([^'"]+)\1/g

function forEachStaticImport(source: string, visit: (spec: string, offset: number) => void): void {
  for (const re of [IMPORT_FROM, BARE_IMPORT, DYNAMIC_IMPORT]) {
    re.lastIndex = 0
    for (let m = re.exec(source); m; m = re.exec(source)) {
      visit(m[2], m.index + m[0].indexOf(m[2]))
    }
  }
}

function locate(source: string, offset: number): { line: number; column: number } {
  let line = 1
  let col = 1
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source.charCodeAt(i) === 10) {
      line++
      col = 1
    } else {
      col++
    }
  }
  return { line, column: col }
}

export function lintPortableImports(files: Array<{ path: string; content: string | Uint8Array }>): RuntimeDiagnostic[] {
  const diagnostics: RuntimeDiagnostic[] = []
  for (const file of files) {
    if (!TS_FILE.test(file.path)) continue
    if (typeof file.content !== 'string') continue
    forEachStaticImport(file.content, (spec, offset) => {
      for (const rule of RULES) {
        const m = rule.match.exec(spec)
        if (!m) continue
        const { line, column } = locate(file.content as string, offset)
        diagnostics.push({
          category: 'warning',
          code: rule.code,
          message: `${file.path}: import '${spec}' is not portable — prefer '${rule.replacement(m)}'. ${rule.reason}.`,
          line,
          column,
        })
        break
      }
    })
  }
  return diagnostics
}
