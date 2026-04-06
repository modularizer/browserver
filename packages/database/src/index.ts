export type DatabaseValue = string | number | boolean | null

export interface DatabaseColumn {
  name: string
  type: 'text' | 'number' | 'boolean'
}

export interface DatabaseRow {
  id: string
  values: Record<string, DatabaseValue>
}

export interface DatabaseTable {
  name: string
  columns: DatabaseColumn[]
  rows: DatabaseRow[]
}

export interface DatabaseSnapshot {
  workspaceId: string
  tables: DatabaseTable[]
  updatedAt: number
}

const DB_NAME = 'browserver'
const DB_VERSION = 2
const DATABASE_STORE = 'workspaceDatabases'
const SNAPSHOT_STORE = 'workspaceSnapshots'

async function openDatabase(): Promise<IDBDatabase> {
  return await new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(DATABASE_STORE)) {
        db.createObjectStore(DATABASE_STORE, { keyPath: 'workspaceId' })
      }
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' })
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
    const tx = db.transaction(DATABASE_STORE, mode)
    const store = tx.objectStore(DATABASE_STORE)
    const request = run(store)

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
    tx.oncomplete = () => db.close()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

export async function loadWorkspaceDatabase(workspaceId: string): Promise<DatabaseSnapshot | null> {
  const snapshot = await withStore<DatabaseSnapshot | undefined>('readonly', (store) => store.get(workspaceId))
  return snapshot ?? null
}

export async function saveWorkspaceDatabase(snapshot: DatabaseSnapshot): Promise<void> {
  await withStore<IDBValidKey>('readwrite', (store) => store.put(snapshot))
}
