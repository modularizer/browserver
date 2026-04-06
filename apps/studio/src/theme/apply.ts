import * as monaco from 'monaco-editor'
import type { ThemeDefinition, ThemeTokens } from './tokens'

/**
 * Apply a theme's tokens as CSS custom properties on :root
 * so Tailwind utilities like `bg-[var(--bs-bg)]` work.
 */
export function applyCssVariables(tokens: ThemeTokens) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--bs-${camelToDash(key)}`, value)
  }
}

/**
 * Register and activate a Monaco editor theme derived from our tokens.
 */
export function applyMonacoTheme(theme: ThemeDefinition) {
  const t = theme.tokens

  monaco.editor.defineTheme('browserver', {
    base: theme.monacoBase,
    inherit: true,
    rules: [],
    colors: {
      'editor.background': t.bgEditor,
      'editor.foreground': t.text,
      'editor.lineHighlightBackground': t.bgHover,
      'editor.selectionBackground': t.bgActive,
      'editorCursor.foreground': t.accent,
      'editorLineNumber.foreground': t.textFaint,
      'editorLineNumber.activeForeground': t.textMuted,
      'editorIndentGuide.background': t.border,
      'editorIndentGuide.activeBackground': t.textFaint,
      'editorWidget.background': t.bgPanel,
      'editorWidget.border': t.border,
      'input.background': t.bgInput,
      'input.foreground': t.text,
      'input.border': t.border,
      'focusBorder': t.borderFocus,
      'list.hoverBackground': t.bgHover,
      'list.activeSelectionBackground': t.bgActive,
      'list.activeSelectionForeground': t.text,
      'scrollbarSlider.background': t.bgActive + '80',
      'scrollbarSlider.hoverBackground': t.bgActive + 'cc',
    },
  })

  monaco.editor.setTheme('browserver')
}

function camelToDash(str: string): string {
  return str.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}
