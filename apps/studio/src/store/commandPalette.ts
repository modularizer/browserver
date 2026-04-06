import { create } from 'zustand'

interface CommandPaletteState {
  open: boolean
  query: string
  selectedIndex: number
  openPalette: () => void
  closePalette: () => void
  setQuery: (query: string) => void
  setSelectedIndex: (index: number) => void
  moveSelection: (delta: number, total: number) => void
}

export const useCommandPaletteStore = create<CommandPaletteState>()((set, get) => ({
  open: false,
  query: '',
  selectedIndex: 0,
  openPalette: () => set({ open: true, query: '', selectedIndex: 0 }),
  closePalette: () => set({ open: false, query: '', selectedIndex: 0 }),
  setQuery: (query) => set({ query, selectedIndex: 0 }),
  setSelectedIndex: (index) => set({ selectedIndex: index }),
  moveSelection: (delta, total) => {
    if (total <= 0) {
      set({ selectedIndex: 0 })
      return
    }

    const next = (get().selectedIndex + delta + total) % total
    set({ selectedIndex: next })
  },
}))
