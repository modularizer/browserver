import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { BottomPanelId, RightPanelTabId } from './workspace'

export type LayoutPresetId = 'code' | 'observe' | 'client' | 'data' | 'trust' | 'wide' | 'custom'

export interface LayoutSnapshot {
  sidebarWidth: number
  bottomHeight: number
  rightWidth: number
  showSidebar: boolean
  showBottom: boolean
  showRight: boolean
}

export interface LayoutPresetConfig {
  label: string
  snapshot: LayoutSnapshot
  bottomPanel: BottomPanelId
  rightPanelTab: RightPanelTabId
}

export const layoutPresets: Record<Exclude<LayoutPresetId, 'custom'>, LayoutPresetConfig> = {
  code: {
    label: 'Code',
    snapshot: {
      sidebarWidth: 190,
      bottomHeight: 180,
      rightWidth: 300,
      showSidebar: true,
      showBottom: true,
      showRight: false,
    },
    bottomPanel: 'logs',
    rightPanelTab: 'inspector',
  },
  observe: {
    label: 'Observe',
    snapshot: {
      sidebarWidth: 150,
      bottomHeight: 300,
      rightWidth: 360,
      showSidebar: true,
      showBottom: true,
      showRight: true,
    },
    bottomPanel: 'calls',
    rightPanelTab: 'inspector',
  },
  client: {
    label: 'Client',
    snapshot: {
      sidebarWidth: 170,
      bottomHeight: 220,
      rightWidth: 420,
      showSidebar: true,
      showBottom: true,
      showRight: true,
    },
    bottomPanel: 'client',
    rightPanelTab: 'client',
  },
  data: {
    label: 'Data',
    snapshot: {
      sidebarWidth: 190,
      bottomHeight: 320,
      rightWidth: 320,
      showSidebar: true,
      showBottom: true,
      showRight: true,
    },
    bottomPanel: 'data',
    rightPanelTab: 'inspector',
  },
  trust: {
    label: 'Trust',
    snapshot: {
      sidebarWidth: 170,
      bottomHeight: 300,
      rightWidth: 360,
      showSidebar: true,
      showBottom: true,
      showRight: true,
    },
    bottomPanel: 'trust',
    rightPanelTab: 'trust',
  },
  wide: {
    label: 'Wide',
    snapshot: {
      sidebarWidth: 140,
      bottomHeight: 180,
      rightWidth: 460,
      showSidebar: true,
      showBottom: false,
      showRight: true,
    },
    bottomPanel: 'history',
    rightPanelTab: 'client',
  },
}

interface LayoutState {
  presetId: LayoutPresetId
  sidebarWidth: number
  bottomHeight: number
  rightWidth: number
  showSidebar: boolean
  showBottom: boolean
  showRight: boolean
  setSidebarWidth: (w: number) => void
  setBottomHeight: (h: number) => void
  setRightWidth: (w: number) => void
  resizeSidebarBy: (delta: number) => void
  resizeBottomBy: (delta: number) => void
  resizeRightBy: (delta: number) => void
  toggleSidebar: () => void
  toggleBottom: () => void
  toggleRight: () => void
  applyPreset: (presetId: Exclude<LayoutPresetId, 'custom'>) => void
  applySnapshot: (snapshot: LayoutSnapshot, presetId?: LayoutPresetId) => void
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      presetId: 'code',
      sidebarWidth: 170,
      bottomHeight: 200,
      rightWidth: 280,
      showSidebar: true,
      showBottom: true,
      showRight: false,
      setSidebarWidth: (w) => set({ sidebarWidth: Math.max(140, Math.min(560, w)), presetId: 'custom' }),
      setBottomHeight: (h) => set({ bottomHeight: Math.max(80, Math.min(720, h)), presetId: 'custom' }),
      setRightWidth: (w) => set({ rightWidth: Math.max(180, Math.min(720, w)), presetId: 'custom' }),
      resizeSidebarBy: (delta) =>
        set((state) => ({
          sidebarWidth: Math.max(140, Math.min(560, state.sidebarWidth + delta)),
          presetId: 'custom',
        })),
      resizeBottomBy: (delta) =>
        set((state) => ({
          bottomHeight: Math.max(80, Math.min(720, state.bottomHeight + delta)),
          presetId: 'custom',
        })),
      resizeRightBy: (delta) =>
        set((state) => ({
          rightWidth: Math.max(180, Math.min(720, state.rightWidth + delta)),
          presetId: 'custom',
        })),
      toggleSidebar: () => set((s) => ({ showSidebar: !s.showSidebar, presetId: 'custom' })),
      toggleBottom: () => set((s) => ({ showBottom: !s.showBottom, presetId: 'custom' })),
      toggleRight: () => set((s) => ({ showRight: !s.showRight, presetId: 'custom' })),
      applyPreset: (presetId) =>
        set({
          presetId,
          ...layoutPresets[presetId].snapshot,
        }),
      applySnapshot: (snapshot, presetId = 'custom') =>
        set({
          presetId,
          sidebarWidth: Math.max(140, Math.min(560, snapshot.sidebarWidth)),
          bottomHeight: Math.max(80, Math.min(720, snapshot.bottomHeight)),
          rightWidth: Math.max(180, Math.min(720, snapshot.rightWidth)),
          showSidebar: snapshot.showSidebar,
          showBottom: snapshot.showBottom,
          showRight: snapshot.showRight,
        }),
    }),
    { name: 'browserver:layout' },
  ),
)
