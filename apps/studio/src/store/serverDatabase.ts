import { create } from 'zustand'
import { connectClientSideServer, type OpenAPIClient } from '@modularizer/plat-client/client-server'
import type { DatabaseTable } from '@browserver/database'
import { useScriptRunnerStore } from './scriptRunner'

// Read-only mirror of the running plat server's tables, populated by polling
// its DbApi-style controller methods `listTables()` + `queryTable({ name })`.
// Servers opt in by exposing those two methods (see samples/ts-react-wordle).

interface ServerTableShape {
  name: string
  columns: { name: string; type: string }[]
}

type ServerRow = Record<string, string | number | boolean | null>

interface ServerDatabaseState {
  connectedServerName: string | null
  tables: DatabaseTable[]
  activeTableName: string | null
  error: string | null
  refreshedAt: number | null
  setActiveTable: (name: string) => void
  refresh: () => Promise<void>
}

let client: OpenAPIClient | null = null
let connectedName: string | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

function normalizeColumnType(raw: string): 'text' | 'number' | 'boolean' {
  const t = raw.toLowerCase()
  if (t.includes('int') || t.includes('num') || t.includes('float') || t.includes('real')) return 'number'
  if (t.includes('bool')) return 'boolean'
  return 'text'
}

function toTable(shape: ServerTableShape, rows: ServerRow[]): DatabaseTable {
  const columns = shape.columns.map((c) => ({ name: c.name, type: normalizeColumnType(c.type) }))
  return {
    name: shape.name,
    columns,
    rows: rows.map((r, i) => ({
      id: String(r.id ?? `${shape.name}-${i}`),
      values: Object.fromEntries(columns.map((c) => [c.name, (r[c.name] ?? null) as any])),
    })),
  }
}

async function poll(set: (p: Partial<ServerDatabaseState>) => void): Promise<void> {
  if (!client) return
  try {
    const shapes = await (client as any).listTables() as ServerTableShape[]
    const tables: DatabaseTable[] = []
    for (const shape of shapes) {
      try {
        const rows = await (client as any).queryTable({ name: shape.name, limit: 500 }) as ServerRow[]
        tables.push(toTable(shape, rows ?? []))
      } catch {
        tables.push(toTable(shape, []))
      }
    }
    set({ tables, error: null, refreshedAt: Date.now() })
  } catch (err: any) {
    set({ error: String(err?.message ?? err) })
  }
}

export const useServerDatabaseStore = create<ServerDatabaseState>((set, get) => ({
  connectedServerName: null,
  tables: [],
  activeTableName: null,
  error: null,
  refreshedAt: null,
  setActiveTable: (name) => set({ activeTableName: name }),
  refresh: () => poll(set),
}))

// Keep the client connected to whichever server the scriptRunner is serving.
// When phase flips off 'ok' we drop the client; when it flips back on we
// reconnect. Polling is a cheap 3s interval for now — good enough for a demo.
useScriptRunnerStore.subscribe((state) => {
  const name = state.phase === 'ok' ? state.serverName : null
  if (name === connectedName) return
  connectedName = name

  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  client = null
  useServerDatabaseStore.setState({ connectedServerName: name, tables: [], error: null })

  if (!name) return
  void connectClientSideServer({ baseUrl: `css://${name}` })
    .then(async (conn) => {
      if (connectedName !== name) return
      client = conn.client
      await poll(useServerDatabaseStore.setState)
      // Poll for updates — covers writes from the running server (gameOver inserts).
      pollTimer = setInterval(() => { void poll(useServerDatabaseStore.setState) }, 3000)
      // Pick a default active table if one isn't set.
      const state = useServerDatabaseStore.getState()
      if (!state.activeTableName && state.tables[0]) {
        useServerDatabaseStore.setState({ activeTableName: state.tables[0].name })
      }
    })
    .catch((err) => {
      useServerDatabaseStore.setState({ error: `connect failed: ${String(err?.message ?? err)}` })
    })
})
