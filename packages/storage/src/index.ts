export type StoredWorkspaceLanguage =
  | 'typescript'
  | 'python'
  | 'javascript'
  | 'json'
  | 'html'
  | 'css'
  | 'markdown'
  | 'yaml'
  | 'image'
  | 'video'
  | 'pdf'
  | 'csv'
  | 'xlsx'
  | 'archive'
  | 'plaintext'

export interface StoredWorkspaceFile {
  path: string
  language: StoredWorkspaceLanguage
  content: string
  updatedAt: number
}

export interface WorkspaceSnapshot {
  id: string
  name: string
  serverLanguage: 'typescript' | 'python'
  files: StoredWorkspaceFile[]
  updatedAt: number
}

const DB_NAME = 'browserver'
const DB_VERSION = 2
const SNAPSHOT_STORE = 'workspaceSnapshots'
const DATABASE_STORE = 'workspaceDatabases'

async function openDatabase(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(DATABASE_STORE)) {
        db.createObjectStore(DATABASE_STORE, { keyPath: 'workspaceId' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase()

  return await new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, mode)
    const store = tx.objectStore(SNAPSHOT_STORE)
    const request = run(store)

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    tx.oncomplete = () => db.close()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

async function withSnapshotStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase()

  return await new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, mode)
    const store = tx.objectStore(SNAPSHOT_STORE)
    const request = run(store)

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    tx.oncomplete = () => db.close()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export async function loadWorkspaceSnapshot(id: string): Promise<WorkspaceSnapshot | null> {
  const snapshot = await withSnapshotStore<WorkspaceSnapshot | undefined>('readonly', (store) => store.get(id))
  return snapshot ?? null
}

export async function saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  await withSnapshotStore<IDBValidKey>('readwrite', (store) => store.put(snapshot))
}

export async function listWorkspaceSnapshots(): Promise<WorkspaceSnapshot[]> {
  const snapshots = await withSnapshotStore<WorkspaceSnapshot[]>('readonly', (store) => store.getAll())
  return snapshots.sort((a, b) => b.updatedAt - a.updatedAt)
}
