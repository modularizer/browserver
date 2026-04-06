/**
 * Theme token definitions for browserver.
 *
 * Each theme defines a full set of semantic color tokens that drive:
 * - Tailwind via CSS custom properties
 * - Monaco via programmatic theme registration
 * - All custom browserver panels, inspectors, and chrome
 */

export interface ThemeTokens {
  // Surfaces
  bg: string
  bgPanel: string
  bgSidebar: string
  bgEditor: string
  bgInput: string
  bgHover: string
  bgActive: string
  bgBadge: string

  // Borders
  border: string
  borderFocus: string

  // Text
  text: string
  textMuted: string
  textFaint: string
  textInverse: string

  // Accent / brand
  accent: string
  accentHover: string
  accentText: string

  // Semantic
  good: string
  warn: string
  error: string
  info: string

  // Runtime activity
  callActive: string
  logStream: string
  peerOnline: string
  peerOffline: string

  // Tab bar
  tabActive: string
  tabInactive: string
  tabHover: string
}

export interface ThemeDefinition {
  id: string
  name: string
  monacoBase: 'vs-dark' | 'vs' | 'hc-black' | 'hc-light'
  tokens: ThemeTokens
}

export const themes: ThemeDefinition[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    monacoBase: 'vs-dark',
    tokens: {
      bg: '#0f1117',
      bgPanel: '#161822',
      bgSidebar: '#12141c',
      bgEditor: '#1a1d2e',
      bgInput: '#1e2130',
      bgHover: '#1f2335',
      bgActive: '#252940',
      bgBadge: '#2a2f4a',
      border: '#2a2e42',
      borderFocus: '#5c6bc0',
      text: '#c8ccd8',
      textMuted: '#7c829d',
      textFaint: '#4a4f6a',
      textInverse: '#0f1117',
      accent: '#7c8cf0',
      accentHover: '#9aa5f4',
      accentText: '#ffffff',
      good: '#66bb6a',
      warn: '#ffa726',
      error: '#ef5350',
      info: '#42a5f5',
      callActive: '#7c8cf0',
      logStream: '#80cbc4',
      peerOnline: '#66bb6a',
      peerOffline: '#616680',
      tabActive: '#1a1d2e',
      tabInactive: '#12141c',
      tabHover: '#1f2335',
    },
  },
  {
    id: 'arctic',
    name: 'Arctic',
    monacoBase: 'vs-dark',
    tokens: {
      bg: '#0e1518',
      bgPanel: '#141d22',
      bgSidebar: '#111a1e',
      bgEditor: '#18232a',
      bgInput: '#1c2830',
      bgHover: '#1f2e36',
      bgActive: '#243640',
      bgBadge: '#2c404a',
      border: '#253540',
      borderFocus: '#26c6da',
      text: '#c0d8e0',
      textMuted: '#6e909c',
      textFaint: '#3e5a66',
      textInverse: '#0e1518',
      accent: '#26c6da',
      accentHover: '#4dd0e1',
      accentText: '#0e1518',
      good: '#66bb6a',
      warn: '#ffca28',
      error: '#ef5350',
      info: '#29b6f6',
      callActive: '#26c6da',
      logStream: '#80deea',
      peerOnline: '#66bb6a',
      peerOffline: '#4a6670',
      tabActive: '#18232a',
      tabInactive: '#111a1e',
      tabHover: '#1f2e36',
    },
  },
  {
    id: 'sand',
    name: 'Sand',
    monacoBase: 'vs',
    tokens: {
      bg: '#f5f0e8',
      bgPanel: '#ede7dd',
      bgSidebar: '#f0ebe2',
      bgEditor: '#faf6f0',
      bgInput: '#e8e2d8',
      bgHover: '#e2dcd0',
      bgActive: '#d8d0c4',
      bgBadge: '#d0c8ba',
      border: '#d4ccc0',
      borderFocus: '#8b7355',
      text: '#2c2416',
      textMuted: '#7a6e5e',
      textFaint: '#a89e8e',
      textInverse: '#f5f0e8',
      accent: '#8b7355',
      accentHover: '#a08868',
      accentText: '#ffffff',
      good: '#558b2f',
      warn: '#f57f17',
      error: '#c62828',
      info: '#1565c0',
      callActive: '#8b7355',
      logStream: '#4e7a5a',
      peerOnline: '#558b2f',
      peerOffline: '#a89e8e',
      tabActive: '#faf6f0',
      tabInactive: '#f0ebe2',
      tabHover: '#e2dcd0',
    },
  },
  {
    id: 'overcast',
    name: 'Overcast',
    monacoBase: 'vs',
    tokens: {
      bg: '#f0f2f5',
      bgPanel: '#e6e9ee',
      bgSidebar: '#ebeef2',
      bgEditor: '#f8f9fb',
      bgInput: '#e0e4ea',
      bgHover: '#d8dce4',
      bgActive: '#cdd2dc',
      bgBadge: '#c4c9d4',
      border: '#d0d4dc',
      borderFocus: '#5570a0',
      text: '#1e2430',
      textMuted: '#5a6478',
      textFaint: '#9098aa',
      textInverse: '#f0f2f5',
      accent: '#5570a0',
      accentHover: '#6880b0',
      accentText: '#ffffff',
      good: '#2e7d32',
      warn: '#e65100',
      error: '#b71c1c',
      info: '#0277bd',
      callActive: '#5570a0',
      logStream: '#37796c',
      peerOnline: '#2e7d32',
      peerOffline: '#9098aa',
      tabActive: '#f8f9fb',
      tabInactive: '#ebeef2',
      tabHover: '#d8dce4',
    },
  },
  {
    id: 'signal',
    name: 'Signal',
    monacoBase: 'vs-dark',
    tokens: {
      bg: '#121218',
      bgPanel: '#1a1a24',
      bgSidebar: '#15151e',
      bgEditor: '#1d1d2a',
      bgInput: '#232332',
      bgHover: '#2a2a3b',
      bgActive: '#35354a',
      bgBadge: '#41415a',
      border: '#36364b',
      borderFocus: '#f25f5c',
      text: '#ddddea',
      textMuted: '#9a9ab2',
      textFaint: '#64647f',
      textInverse: '#121218',
      accent: '#f25f5c',
      accentHover: '#ff7a77',
      accentText: '#ffffff',
      good: '#7bd389',
      warn: '#f7b32b',
      error: '#f25f5c',
      info: '#5bc0eb',
      callActive: '#f25f5c',
      logStream: '#5bc0eb',
      peerOnline: '#7bd389',
      peerOffline: '#67677f',
      tabActive: '#1d1d2a',
      tabInactive: '#15151e',
      tabHover: '#2a2a3b',
    },
  },
]

export const defaultThemeId = 'midnight'
