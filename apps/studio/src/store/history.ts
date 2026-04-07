import { create } from 'zustand'
import type { WorkspaceSnapshot } from '@browserver/storage'
import { useWorkspaceStore, type WorkspaceEditorSession } from './workspace'
import { commitWorkspace, ensureRepo, getHeadOid } from './git'

interface TxRecord {
  id: string
  workspaceId: string
  label: string
  ts: number
  pre: { workspace: WorkspaceSnapshot; session: WorkspaceEditorSession }
  post: { workspace: WorkspaceSnapshot; session: WorkspaceEditorSession }
}

function fileContentAtPath(snapshot: WorkspaceSnapshot, path: string): string | null {
  const match = snapshot.files.find((file) => file.path === path)
  return match ? match.content : null
}

export function transactionTouchesFilePath(entry: TxRecord, path: string): boolean {
  const pre = fileContentAtPath(entry.pre.workspace, path)
  const post = fileContentAtPath(entry.post.workspace, path)
  if (pre === null && post === null) return false
  return pre !== post
}

interface HistoryState {
   hydratedWorkspaceId: string | null
   gitCommitRevision: number
   // per-workspace list
   items: TxRecord[]
   // pointer points to index of last-applied transaction; -1 means base state before any tx
   pointer: number
   reentrant: boolean
   pending: { label: string; pre: { workspace: WorkspaceSnapshot; session: WorkspaceEditorSession } } | null
   hydrate: (workspaceId: string) => Promise<void>
   begin: (label: string) => void
   commit: (workspaceId: string) => Promise<void>
   abort: () => void
   undo: () => Promise<void>
   redo: () => Promise<void>
   clear: () => Promise<void>
   squashTransactions: (ids: string[]) => Promise<boolean>
   renameTransaction: (id: string, newLabel: string) => Promise<boolean>
 }

// IndexedDB persistence (simple, single store)
const DB_NAME = 'browserver-history'
const DB_VERSION = 4
const TX_STORE = 'transactions'
const CHECKPOINTS_STORE = 'projectCheckpoints'

async function openDb(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(TX_STORE)) {
        const store = db.createObjectStore(TX_STORE, { keyPath: 'id' })
        store.createIndex('workspaceId_ts', ['workspaceId', 'ts'], { unique: false })
      } else {
        const tx = req.transaction
        if (tx) {
          const store = tx.objectStore(TX_STORE)
          if (!store.indexNames.contains('workspaceId_ts')) {
            store.createIndex('workspaceId_ts', ['workspaceId', 'ts'], { unique: false })
          }
        }
      }

      if (!db.objectStoreNames.contains(CHECKPOINTS_STORE)) {
        const checkpointsStore = db.createObjectStore(CHECKPOINTS_STORE, { keyPath: 'id' })
        checkpointsStore.createIndex('workspaceId', 'workspaceId', { unique: false })
        checkpointsStore.createIndex('createdAt', 'createdAt', { unique: false })
      }
    }
    req.onblocked = () => reject(new Error('History DB upgrade blocked. Close other browserver tabs and retry.'))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open history DB'))
  })
}

async function loadTransactions(workspaceId: string): Promise<TxRecord[]> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(TX_STORE, 'readonly')
    const store = tx.objectStore(TX_STORE)
    const index = store.index('workspaceId_ts')
    const req = index.getAll(IDBKeyRange.bound([workspaceId, -Infinity], [workspaceId, Infinity]))
    req.onsuccess = () => {
      const items = (req.result as TxRecord[]).sort((a, b) => a.ts - b.ts)
      resolve(items)
    }
    req.onerror = () => reject(req.error ?? new Error('Failed to read transactions'))
    tx.oncomplete = () => db.close()
    tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'))
  })
}

async function saveTransaction(rec: TxRecord): Promise<void> {
   const db = await openDb()
   await new Promise<void>((resolve, reject) => {
     const tx = db.transaction(TX_STORE, 'readwrite')
     tx.objectStore(TX_STORE).put(rec)
     tx.oncomplete = () => { db.close(); resolve() }
     tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'))
   })
 }

async function updateTransaction(id: string, updates: Partial<TxRecord>): Promise<void> {
   const db = await openDb()
   await new Promise<void>((resolve, reject) => {
     const tx = db.transaction(TX_STORE, 'readwrite')
     const store = tx.objectStore(TX_STORE)
     const getReq = store.get(id)
     getReq.onsuccess = () => {
       const record = getReq.result as TxRecord | undefined
       if (record) {
         store.put({ ...record, ...updates })
       }
     }
     tx.oncomplete = () => { db.close(); resolve() }
     tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'))
   })
 }

async function deleteTransactions(ids: string[]): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TX_STORE, 'readwrite')
    const store = tx.objectStore(TX_STORE)
    for (const id of ids) store.delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'))
  })
}

async function replaceTransactions(removeIds: string[], merged: TxRecord): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(TX_STORE, 'readwrite')
    const store = tx.objectStore(TX_STORE)
    for (const id of removeIds) store.delete(id)
    store.put(merged)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onabort = () => reject(tx.error ?? new Error('IDB tx aborted'))
  })
}

function capture(): { workspace: WorkspaceSnapshot; session: WorkspaceEditorSession } {
  const ws = useWorkspaceStore.getState()
  // currentSnapshot and buildEditorSessionSnapshot are internal; reconstruct from state
  const workspace: WorkspaceSnapshot = {
    id: ws.sample.id,
    name: ws.sample.name,
    serverLanguage: ws.sample.serverLanguage,
    files: ws.files.map(({ path, language, content, updatedAt }) => ({ path, language, content, updatedAt })),
    updatedAt: Date.now(),
  }
  const session: WorkspaceEditorSession = {
    folders: ws.folders,
    openFilePaths: ws.openFilePaths,
    paneTabs: ws.paneTabs,
    paneFiles: ws.paneFiles,
    activeEditorPane: ws.activeEditorPane,
    activeFilePath: ws.activeFilePath,
    activeBottomPanel: ws.activeBottomPanel,
    activeRightPanelTab: ws.activeRightPanelTab,
    viewTitles: ws.viewTitles,
  }
  return { workspace, session }
}

async function restore(state: { workspace: WorkspaceSnapshot; session: WorkspaceEditorSession }) {
  const api = useWorkspaceStore.getState()
  // Avoid recording while we restore
  useHistoryStore.setState({ reentrant: true })
  try {
    await api.importSnapshot(state.workspace)
    api.restoreEditorSession(state.session)
  } finally {
    // small timeout to let state settle before enabling recording again
    setTimeout(() => useHistoryStore.setState({ reentrant: false }), 0)
  }
}

export const useHistoryStore = create<HistoryState>()((set, get) => ({
  hydratedWorkspaceId: null,
  gitCommitRevision: 0,
  items: [],
  pointer: -1,
  reentrant: false,
  pending: null,
  hydrate: async (workspaceId: string) => {
    // Ensure a repo exists and seed an initial commit if HEAD is missing.
    await ensureRepo(workspaceId)
    const head = await getHeadOid(workspaceId)
    if (!head) {
      const ws = useWorkspaceStore.getState()
      if (ws.sample.id === workspaceId) {
        await commitWorkspace(workspaceId, ws.files.map(f => ({ path: f.path, content: f.content })), 'Initial commit')
      }
    }
    const items = await loadTransactions(workspaceId)
    const current = get()
    const merged = current.hydratedWorkspaceId === workspaceId
      ? Array.from(new Map([...items, ...current.items].map((entry) => [entry.id, entry])).values())
          .sort((a, b) => a.ts - b.ts)
      : items
    // pointer to end (assume latest applied)
    set({ hydratedWorkspaceId: workspaceId, items: merged, pointer: merged.length - 1 })
  },
  begin: (label: string) => {
    if (get().reentrant) return
    const pre = capture()
    set({ pending: { label, pre } })
  },
  commit: async (workspaceId: string) => {
    if (get().reentrant) return
    const pending = get().pending
    if (!pending) return
    const post = capture()

    const rec: TxRecord = {
      id: crypto.randomUUID(),
      workspaceId,
      label: pending.label,
      ts: Date.now(),
      pre: pending.pre,
      post,
    }
    // If we undid some items and then commit new, drop items after pointer
    const { items, pointer } = get()
    const kept = pointer < items.length - 1 ? items.slice(0, pointer + 1) : items
    const nextItems = [...kept, rec]
    set({ hydratedWorkspaceId: workspaceId, items: nextItems, pointer: nextItems.length - 1, pending: null })

    if (pending.label.toLowerCase().startsWith('save ')) {
      console.log('[history] added entry immediately', { workspaceId, label: pending.label, id: rec.id })
    }

    try {
      await saveTransaction(rec)
    } catch (error) {
      console.error('[history] failed to persist transaction', error)
    }

    // Git commit is secondary: keep UI/history responsive even if git is slow.
    const files = post.workspace.files.map(f => ({ path: f.path, content: f.content }))
    void commitWorkspace(workspaceId, files, pending.label).catch((err) => {
      console.warn('Git commit failed:', err)
    }).then(() => {
      set((state) => ({ gitCommitRevision: state.gitCommitRevision + 1 }))
    })
  },
  abort: () => set({ pending: null }),
  undo: async () => {
    const { pointer, items } = get()
    if (pointer < 0 || pointer >= items.length) return
    const rec = items[pointer]
    await restore(rec.pre)
    set({ pointer: pointer - 1 })
  },
  redo: async () => {
    const { pointer, items } = get()
    const nextIndex = pointer + 1
    if (nextIndex < 0 || nextIndex >= items.length) return
    const rec = items[nextIndex]
    await restore(rec.post)
    set({ pointer: nextIndex })
  },
  clear: async () => {
    const ids = get().items.map((i) => i.id)
    await deleteTransactions(ids)
    set({ items: [], pointer: -1, pending: null })
  },
   squashTransactions: async (ids) => {
     const uniqueIds = Array.from(new Set(ids))
     if (uniqueIds.length < 2) return false

     const state = get()
     if (state.pointer !== state.items.length - 1) {
       return false
     }

     const indexById = new Map(state.items.map((item, index) => [item.id, index]))
     const selectedIndexes = uniqueIds
       .map((id) => indexById.get(id))
       .filter((index): index is number => index !== undefined)
       .sort((a, b) => a - b)

     if (selectedIndexes.length < 2) return false

     for (let i = 1; i < selectedIndexes.length; i += 1) {
       if (selectedIndexes[i] !== selectedIndexes[i - 1] + 1) {
         return false
       }
     }

     const firstIndex = selectedIndexes[0]
     const lastIndex = selectedIndexes[selectedIndexes.length - 1]
     const selected = state.items.slice(firstIndex, lastIndex + 1)
     if (selected.some((entry) => entry.workspaceId !== selected[0].workspaceId)) {
       return false
     }

     const merged: TxRecord = {
       id: crypto.randomUUID(),
       workspaceId: selected[0].workspaceId,
       label: selected[selected.length - 1].label,
       ts: selected[selected.length - 1].ts,
       pre: selected[0].pre,
       post: selected[selected.length - 1].post,
     }

     const nextItems = [
       ...state.items.slice(0, firstIndex),
       merged,
       ...state.items.slice(lastIndex + 1),
     ]

     try {
       await replaceTransactions(selected.map((entry) => entry.id), merged)
     } catch (error) {
       console.error('[history] failed to persist squash', error)
       return false
     }

     set({
       hydratedWorkspaceId: merged.workspaceId,
       items: nextItems,
       pointer: nextItems.length - 1,
     })
     return true
   },
   renameTransaction: async (id, newLabel) => {
     const state = get()
     const itemIndex = state.items.findIndex((item) => item.id === id)
     if (itemIndex === -1) return false

     const record = state.items[itemIndex]
     const updated = { ...record, label: newLabel }
     const nextItems = [
       ...state.items.slice(0, itemIndex),
       updated,
       ...state.items.slice(itemIndex + 1),
     ]

     try {
       await updateTransaction(id, { label: newLabel })
     } catch (error) {
       console.error('[history] failed to persist rename', error)
       return false
     }

     set({ items: nextItems })
     return true
   },
 }))

export type { TxRecord }
