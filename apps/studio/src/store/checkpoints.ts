import { create } from 'zustand'
import type { ProjectBundle } from '../config/projectBundle'
import { layoutPresets, type LayoutPresetId, useLayoutStore } from './layout'
import { useDatabaseStore } from './database'
import { useThemeStore } from '../theme'
import { useTrustStore } from './trust'
import { useWorkspaceStore } from './workspace'

export interface ProjectCheckpointRecord {
  id: string
  workspaceId: string
  name: string
  note?: string
  createdAt: number
  bundle: ProjectBundle
}

interface CheckpointState {
  hydratedWorkspaceId: string | null
  items: ProjectCheckpointRecord[]
  saveState: 'idle' | 'saving' | 'saved'
  hydrate: (workspaceId: string) => Promise<void>
  createCheckpoint: (input: {
    workspaceId: string
    name: string
    note?: string
    bundle: ProjectBundle
  }) => Promise<void>
  deleteCheckpoint: (id: string) => Promise<void>
  restoreCheckpoint: (id: string) => Promise<void>
}

const DB_NAME = 'browserver-history'
const DB_VERSION = 4
const CHECKPOINTS_STORE = 'projectCheckpoints'
const TX_STORE = 'transactions'

async function openDatabase(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(TX_STORE)) {
        const txStore = db.createObjectStore(TX_STORE, { keyPath: 'id' })
        txStore.createIndex('workspaceId_ts', ['workspaceId', 'ts'], { unique: false })
      } else {
        const tx = request.transaction
        if (tx) {
          const txStore = tx.objectStore(TX_STORE)
          if (!txStore.indexNames.contains('workspaceId_ts')) {
            txStore.createIndex('workspaceId_ts', ['workspaceId', 'ts'], { unique: false })
          }
        }
      }

      if (!db.objectStoreNames.contains(CHECKPOINTS_STORE)) {
        const store = db.createObjectStore(CHECKPOINTS_STORE, { keyPath: 'id' })
        store.createIndex('workspaceId', 'workspaceId', { unique: false })
        store.createIndex('createdAt', 'createdAt', { unique: false })
      } else {
        const tx = request.transaction
        if (tx) {
          const store = tx.objectStore(CHECKPOINTS_STORE)
          if (!store.indexNames.contains('workspaceId')) {
            store.createIndex('workspaceId', 'workspaceId', { unique: false })
          }
          if (!store.indexNames.contains('createdAt')) {
            store.createIndex('createdAt', 'createdAt', { unique: false })
          }
        }
      }
    }

    request.onblocked = () => {
      reject(new Error('History DB upgrade blocked. Close other browserver tabs and retry.'))
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open checkpoints database'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => void,
  collect: (store: IDBObjectStore, resolve: (value: T) => void, reject: (error: Error) => void) => void,
): Promise<T> {
  const db = await openDatabase()

  return await new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKPOINTS_STORE, mode)
    const store = tx.objectStore(CHECKPOINTS_STORE)
    run(store)
    collect(store, resolve, reject)
    tx.oncomplete = () => db.close()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

async function listProjectCheckpoints(workspaceId: string): Promise<ProjectCheckpointRecord[]> {
  return await withStore<ProjectCheckpointRecord[]>(
    'readonly',
    () => {},
    (store, resolve, reject) => {
      const index = store.index('workspaceId')
      const request = index.getAll(IDBKeyRange.only(workspaceId))
      request.onsuccess = () => {
        const items = (request.result as ProjectCheckpointRecord[]).sort((a, b) => b.createdAt - a.createdAt)
        resolve(items)
      }
      request.onerror = () => reject(request.error ?? new Error('Failed to load project checkpoints'))
    },
  )
}

async function saveProjectCheckpoint(record: ProjectCheckpointRecord): Promise<void> {
  await withStore<void>(
    'readwrite',
    (store) => {
      store.put(record)
    },
    (_store, resolve, reject) => {
      resolve()
      void reject
    },
  )
}

async function removeProjectCheckpoint(id: string): Promise<void> {
  await withStore<void>(
    'readwrite',
    (store) => {
      store.delete(id)
    },
    (_store, resolve, reject) => {
      resolve()
      void reject
    },
  )
}

async function loadProjectCheckpoint(id: string): Promise<ProjectCheckpointRecord | null> {
  return await withStore<ProjectCheckpointRecord | null>(
    'readonly',
    () => {},
    (store, resolve, reject) => {
      const request = store.get(id)
      request.onsuccess = () => resolve((request.result as ProjectCheckpointRecord | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('Failed to load project checkpoint'))
    },
  )
}

function markSaved(set: (partial: Partial<CheckpointState>) => void) {
  set({ saveState: 'saved' })
  window.setTimeout(() => {
    set({ saveState: 'idle' })
  }, 1200)
}

export const useCheckpointStore = create<CheckpointState>()((set, get) => ({
  hydratedWorkspaceId: null,
  items: [],
  saveState: 'idle',
  hydrate: async (workspaceId) => {
    const items = await listProjectCheckpoints(workspaceId)
    set({
      hydratedWorkspaceId: workspaceId,
      items,
      saveState: 'idle',
    })
  },
  createCheckpoint: async ({ workspaceId, name, note, bundle }) => {
    set({ saveState: 'saving' })
    const record: ProjectCheckpointRecord = {
      id: crypto.randomUUID(),
      workspaceId,
      name,
      note,
      createdAt: Date.now(),
      bundle,
    }
    await saveProjectCheckpoint(record)
    const items = await listProjectCheckpoints(workspaceId)
    set({
      hydratedWorkspaceId: workspaceId,
      items,
    })
    markSaved(set)
  },
  deleteCheckpoint: async (id) => {
    const workspaceId = get().hydratedWorkspaceId
    if (!workspaceId) return
    set({ saveState: 'saving' })
    await removeProjectCheckpoint(id)
    const items = await listProjectCheckpoints(workspaceId)
    set({ items })
    markSaved(set)
  },
  restoreCheckpoint: async (id) => {
    const record = await loadProjectCheckpoint(id)
    if (!record) {
      throw new Error('Checkpoint not found')
    }

    await useWorkspaceStore.getState().importSnapshot(record.bundle.workspace)
    await useDatabaseStore.getState().importSnapshot(record.bundle.database)
    if (record.bundle.trust) {
      await useTrustStore.getState().importSnapshot(record.bundle.trust)
    }
    useThemeStore.getState().applyThemeId(record.bundle.ui.themeId)
    if (
      record.bundle.ui.presetId
      && record.bundle.ui.presetId !== 'custom'
      && record.bundle.ui.presetId in layoutPresets
    ) {
      const presetId = record.bundle.ui.presetId as Exclude<LayoutPresetId, 'custom'>
      useLayoutStore.getState().applyPreset(presetId)
      useWorkspaceStore.getState().setActiveBottomPanel(layoutPresets[presetId].bottomPanel)
      useWorkspaceStore.getState().setActiveRightPanelTab(layoutPresets[presetId].rightPanelTab)
    } else {
      useLayoutStore.getState().applySnapshot(record.bundle.ui.layout, record.bundle.ui.presetId ?? 'custom')
    }
    useWorkspaceStore.getState().setActiveBottomPanel('history')
  },
}))
