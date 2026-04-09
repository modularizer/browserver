/**
 * Browser data deletion utilities.
 * Handles the two IndexedDB databases ("browserver" + "browserver-history")
 * and all localStorage keys prefixed with "browserver:".
 */

const IDB_NAMES = ['browserver', 'browserver-history']

function deleteIdb(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve() // best-effort
    req.onblocked = () => resolve()
  })
}

/** Wipe every browserver: localStorage key. */
function clearLocalStorage() {
  const toRemove = Object.keys(window.localStorage).filter((k) => k.startsWith('browserver:'))
  for (const key of toRemove) {
    window.localStorage.removeItem(key)
  }
}

/** Delete all browseer-related storage and reload. The page will feel like a first visit. */
export async function deleteAllBrowserData(): Promise<void> {
  clearLocalStorage()
  await Promise.all(IDB_NAMES.map(deleteIdb))
  window.location.reload()
}

/**
 * Delete data for a single project and return the user to the default state.
 * Does NOT reload the page — the caller is expected to reset in-memory state.
 */
export async function deleteProjectData(workspaceId: string): Promise<void> {
  // localStorage keys scoped to this workspace
  const prefixes = [
    `browserver:workspace-ui:${workspaceId}`,
    `browserver:trust:${workspaceId}:`,
  ]
  const toRemove = Object.keys(window.localStorage).filter((k) =>
    prefixes.some((prefix) => k.startsWith(prefix)),
  )
  // Also remove the active-workspace pointer if it points here
  const activeKey = 'browserver:active-workspace'
  try {
    const active = window.localStorage.getItem(activeKey)
    if (active && (JSON.parse(active) === workspaceId || active === workspaceId)) {
      toRemove.push(activeKey)
    }
  } catch {
    // ignore
  }
  for (const key of toRemove) {
    window.localStorage.removeItem(key)
  }

  // IndexedDB: delete from "browserver" (workspaceSnapshots + workspaceDatabases)
  await deleteFromBrowserIdb(workspaceId)
  // IndexedDB: delete from "browserver-history" (projectCheckpoints + transactions)
  await deleteFromHistoryIdb(workspaceId)
}

async function deleteFromBrowserIdb(workspaceId: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.open('browserver', 4)
    req.onsuccess = () => {
      const db = req.result
      try {
        const stores = ['workspaceSnapshots', 'workspaceDatabases'].filter((s) =>
          db.objectStoreNames.contains(s),
        )
        if (stores.length === 0) { db.close(); resolve(); return }
        const tx = db.transaction(stores, 'readwrite')
        if (stores.includes('workspaceSnapshots')) tx.objectStore('workspaceSnapshots').delete(workspaceId)
        if (stores.includes('workspaceDatabases')) tx.objectStore('workspaceDatabases').delete(workspaceId)
        tx.oncomplete = () => { db.close(); resolve() }
        tx.onabort = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); resolve() }
      } catch { db.close(); resolve() }
    }
    req.onerror = () => resolve()
  })
}

async function deleteFromHistoryIdb(workspaceId: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const req = indexedDB.open('browserver-history', 4)
    req.onsuccess = () => {
      const db = req.result
      try {
        const checkpointStore = 'projectCheckpoints'
        const txStore = 'transactions'
        const available = [checkpointStore, txStore].filter((s) => db.objectStoreNames.contains(s))
        if (available.length === 0) { db.close(); resolve(); return }

        const tx = db.transaction(available, 'readwrite')

        // Delete checkpoints for this workspace
        if (available.includes(checkpointStore)) {
          const store = tx.objectStore(checkpointStore)
          // Scan all and delete matching
          const cursorReq = store.openCursor()
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result as IDBCursorWithValue | null
            if (!cursor) return
            const record = cursor.value as { workspaceId?: string }
            if (record.workspaceId === workspaceId) cursor.delete()
            cursor.continue()
          }
        }

        // Delete transactions for this workspace
        if (available.includes(txStore)) {
          const store = tx.objectStore(txStore)
          const cursorReq = store.openCursor()
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result as IDBCursorWithValue | null
            if (!cursor) return
            const record = cursor.value as { workspaceId?: string }
            if (record.workspaceId === workspaceId) cursor.delete()
            cursor.continue()
          }
        }

        tx.oncomplete = () => { db.close(); resolve() }
        tx.onabort = () => { db.close(); resolve() }
        tx.onerror = () => { db.close(); resolve() }
      } catch { db.close(); resolve() }
    }
    req.onerror = () => resolve()
  })
}

