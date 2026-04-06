import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { themes, defaultThemeId, type ThemeDefinition } from './tokens'

interface ThemeState {
  themeId: string
  setTheme: (id: string) => void
  applyThemeId: (id: string) => void
  theme: () => ThemeDefinition
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      themeId: defaultThemeId,
      setTheme: (id: string) => set({ themeId: id }),
      applyThemeId: (id: string) =>
        set({ themeId: themes.some((theme) => theme.id === id) ? id : defaultThemeId }),
      theme: () => themes.find((t) => t.id === get().themeId) ?? themes[0],
    }),
    { name: 'browserver:theme' },
  ),
)
