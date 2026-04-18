/**
 * Bidirectional converter between the "browser" and "server" source forms.
 *
 * The API surface of `@modularizer/plat` has been aligned so that both runtimes
 * accept the same `createServer(opts, ...Apis).listen()` idiom. The only thing
 * that still differs between a browser-executable file and a Node-executable
 * file is a handful of import specifiers.
 *
 * `toBrowserSource` and `toServerSource` are pure string rewrites and are
 * round-trip stable: `toServerSource(toBrowserSource(x)) === x` for any input
 * that was already in canonical server form (and vice versa).
 *
 * Applies to TypeScript / JavaScript source only — non-code files pass through.
 */

export interface SourceFile {
  path: string
  content: string | Uint8Array
}

/**
 * Specifier rewrites. Left column is the legacy *browser-only* form that
 * only resolves via the studio's in-browser aliasing (`@modularizer/plat-client`
 * is a browser-safe prebuilt dist, not a valid npm specifier on Node). Right
 * column is the canonical portable form that works identically on Node and
 * in-browser — `@modularizer/plat` exposes matching subpath exports
 * (`./client-server`, `./client`, etc.).
 *
 * Order matters: longer specifiers must come first so a rule for
 * `@modularizer/plat-client/client-server` is tried before the bare
 * `@modularizer/plat-client` rule.
 */
const SPECIFIER_RULES: Array<{ browser: string; server: string }> = [
  // Bare + subpath (handled by the subpath-preservation logic in `rewrite`).
  { browser: '@modularizer/plat-client', server: '@modularizer/plat' },
  { browser: 'fake-redis',               server: 'redis' },
]

const TS_FILE = /\.[cm]?[jt]sx?$/i

/** Match any ESM / CommonJS specifier position we care about. */
const SPECIFIER_CONTEXTS: RegExp[] = [
  // import defaultBinding from 'spec'
  // import { named } from 'spec'
  // import 'spec'
  // export { x } from 'spec'
  // export * from 'spec'
  /((?:^|\n)\s*(?:import|export)\b[^'";\n]*?from\s*|(?:^|\n)\s*import\s*)(['"])([^'"]+)(\2)/g,
  // import('spec')
  /(\bimport\s*\(\s*)(['"])([^'"]+)(\2)/g,
  // require('spec')
  /(\brequire\s*\(\s*)(['"])([^'"]+)(\2)/g,
]

function rewrite(content: string, direction: 'toBrowser' | 'toServer'): string {
  let out = content
  for (const re of SPECIFIER_CONTEXTS) {
    re.lastIndex = 0
    out = out.replace(re, (_match, lead: string, quote: string, spec: string, tail: string) => {
      for (const rule of SPECIFIER_RULES) {
        const from = direction === 'toBrowser' ? rule.server : rule.browser
        const to = direction === 'toBrowser' ? rule.browser : rule.server
        if (spec === from) return `${lead}${quote}${to}${tail}`
        // Subpath preservation: `<from>/sub` → `<to>/sub`. Rules are
        // authored so package names never prefix each other, so a single
        // `startsWith` check is unambiguous even for scoped specifiers.
        if (spec.startsWith(from + '/')) {
          return `${lead}${quote}${to}${spec.slice(from.length)}${tail}`
        }
      }
      return _match
    })
  }
  return out
}

function convertFile(file: SourceFile, direction: 'toBrowser' | 'toServer'): SourceFile {
  if (!TS_FILE.test(file.path)) return file
  if (typeof file.content !== 'string') return file
  const next = rewrite(file.content, direction)
  if (next === file.content) return file
  return { ...file, content: next }
}

export function toBrowserSource<T extends SourceFile>(files: T[]): T[] {
  return files.map((f) => convertFile(f, 'toBrowser') as T)
}

export function toServerSource<T extends SourceFile>(files: T[]): T[] {
  return files.map((f) => convertFile(f, 'toServer') as T)
}

/** Single-file helpers for the common case where you already have source text. */
export function toBrowserText(source: string): string {
  return rewrite(source, 'toBrowser')
}

export function toServerText(source: string): string {
  return rewrite(source, 'toServer')
}

/**
 * Inspect which direction a source file is currently written in. Useful for an
 * IDE toggle that wants to show the opposite form without accidentally
 * double-converting.
 *
 * Returns `'browser'` if any browser-only specifier appears,
 * `'server'` if any server-only specifier appears,
 * `'neutral'` otherwise (no discriminator found — either form is safe).
 */
export function detectSourceForm(content: string): 'browser' | 'server' | 'neutral' {
  for (const rule of SPECIFIER_RULES) {
    if (content.includes(`'${rule.browser}'`) || content.includes(`"${rule.browser}"`) || content.includes(`'${rule.browser}/`) || content.includes(`"${rule.browser}/`)) {
      return 'browser'
    }
  }
  for (const rule of SPECIFIER_RULES) {
    if (content.includes(`'${rule.server}'`) || content.includes(`"${rule.server}"`) || content.includes(`'${rule.server}/`) || content.includes(`"${rule.server}/`)) {
      return 'server'
    }
  }
  return 'neutral'
}
