import { create } from 'zustand'
import {
  loadWorkspaceDatabase,
  saveWorkspaceDatabase,
  type DatabaseSnapshot,
  type DatabaseColumn,
  type DatabaseTable,
} from '@browserver/database'
import type { Sample } from '../samples'

interface DatabaseState {
  hydratedWorkspaceId: string | null
  tables: DatabaseTable[]
  activeTableName: string | null
  saveState: 'idle' | 'saving' | 'saved'
  filter: string
  hydrate: (sample: Sample) => Promise<void>
  importSnapshot: (snapshot: DatabaseSnapshot) => Promise<void>
  setActiveTable: (name: string) => void
  setFilter: (value: string) => void
  updateCell: (tableName: string, rowId: string, columnName: string, rawValue: string) => void
  insertRow: (tableName: string) => void
  deleteRow: (tableName: string, rowId: string) => void
}

const saveTimers = new Map<string, number>()

function createSeedTables(sample: Sample): DatabaseTable[] {
  if (sample.serverLanguage === 'python') {
    return [
      {
        name: 'greetings',
        columns: [
          { name: 'name', type: 'text' },
          { name: 'language', type: 'text' },
          { name: 'active', type: 'boolean' },
        ],
        rows: [
          row({ name: 'world', language: 'python', active: true }),
          row({ name: 'browser', language: 'python', active: false }),
        ],
      },
      {
        name: 'sessions',
        columns: [
          { name: 'peer', type: 'text' },
          { name: 'status', type: 'text' },
          { name: 'requests', type: 'number' },
        ],
        rows: [
          row({ peer: 'local-tab', status: 'warm', requests: 1 }),
        ],
      },
    ]
  }

  if (sample.id.endsWith('/ts-math')) {
    return [
      {
        name: 'jobs',
        columns: [
          { name: 'operation', type: 'text' },
          { name: 'status', type: 'text' },
          { name: 'value', type: 'number' },
        ],
        rows: [
          row({ operation: 'add', status: 'complete', value: 42 }),
          row({ operation: 'factorial', status: 'queued', value: 10 }),
        ],
      },
      {
        name: 'metrics',
        columns: [
          { name: 'name', type: 'text' },
          { name: 'count', type: 'number' },
        ],
        rows: [
          row({ name: 'requests', count: 3 }),
          row({ name: 'errors', count: 0 }),
        ],
      },
    ]
  }

  return [
    {
      name: 'greetings',
      columns: [
        { name: 'name', type: 'text' },
        { name: 'message', type: 'text' },
        { name: 'seen', type: 'boolean' },
      ],
      rows: [
        row({ name: 'world', message: 'hello from browserver', seen: true }),
        row({ name: 'studio', message: 'live in-browser runtime', seen: false }),
      ],
    },
    {
      name: 'runtime_notes',
      columns: [
        { name: 'note', type: 'text' },
        { name: 'priority', type: 'number' },
      ],
      rows: [
        row({ note: 'watch calls in the inspector', priority: 1 }),
        row({ note: 'restart after edits', priority: 2 }),
      ],
    },
  ]
}

function row(values: Record<string, string | number | boolean | null>) {
  return {
    id: crypto.randomUUID(),
    values,
  }
}

function queueSave(snapshot: DatabaseSnapshot, onSaved: () => void) {
  const existing = saveTimers.get(snapshot.workspaceId)
  if (existing) window.clearTimeout(existing)

  const timeout = window.setTimeout(() => {
    void saveWorkspaceDatabase(snapshot).then(() => onSaved())
    saveTimers.delete(snapshot.workspaceId)
  }, 200)

  saveTimers.set(snapshot.workspaceId, timeout)
}

function normalizeSnapshot(sample: Sample, snapshot: DatabaseSnapshot | null): DatabaseSnapshot {
  return snapshot ?? {
    workspaceId: sample.id,
    tables: createSeedTables(sample),
    updatedAt: Date.now(),
  }
}

function parseValue(column: DatabaseColumn | undefined, rawValue: string) {
  if (!column) return rawValue
  if (column.type === 'number') {
    const value = Number(rawValue)
    return Number.isFinite(value) ? value : 0
  }
  if (column.type === 'boolean') {
    return rawValue === 'true'
  }
  return rawValue
}

export const useDatabaseStore = create<DatabaseState>()((set, get) => ({
  hydratedWorkspaceId: null,
  tables: [],
  activeTableName: null,
  saveState: 'idle',
  filter: '',
  hydrate: async (sample) => {
    const loaded = await loadWorkspaceDatabase(sample.id)
    const snapshot = normalizeSnapshot(sample, loaded)

    if (!loaded) {
      await saveWorkspaceDatabase(snapshot)
    }

    set({
      hydratedWorkspaceId: sample.id,
      tables: snapshot.tables,
      activeTableName: snapshot.tables[0]?.name ?? null,
      saveState: 'idle',
      filter: '',
    })
  },
  importSnapshot: async (snapshot) => {
    await saveWorkspaceDatabase(snapshot)
    set({
      hydratedWorkspaceId: snapshot.workspaceId,
      tables: snapshot.tables,
      activeTableName: snapshot.tables[0]?.name ?? null,
      saveState: 'saved',
      filter: '',
    })
  },
  setActiveTable: (name) => set({ activeTableName: name }),
  setFilter: (value) => set({ filter: value }),
  updateCell: (tableName, rowId, columnName, rawValue) =>
    set((state) => {
      const tables = state.tables.map((table) => {
        if (table.name !== tableName) return table

        const column = table.columns.find((entry) => entry.name === columnName)
        return {
          ...table,
          rows: table.rows.map((rowEntry) =>
            rowEntry.id === rowId
              ? {
                  ...rowEntry,
                  values: {
                    ...rowEntry.values,
                    [columnName]: parseValue(column, rawValue),
                  },
                }
              : rowEntry,
          ),
        }
      })

      const snapshot: DatabaseSnapshot = {
        workspaceId: state.hydratedWorkspaceId ?? 'workspace',
        tables,
        updatedAt: Date.now(),
      }

      queueSave(snapshot, () => {
        set({ saveState: 'saved' })
        window.setTimeout(() => {
          if (get().saveState === 'saved') {
            set({ saveState: 'idle' })
          }
        }, 1000)
      })

      return { tables, saveState: 'saving' }
    }),
  insertRow: (tableName) =>
    set((state) => {
      const tables = state.tables.map((table) => {
        if (table.name !== tableName) return table

        const values = Object.fromEntries(
          table.columns.map((column) => [
            column.name,
            column.type === 'number' ? 0 : column.type === 'boolean' ? false : '',
          ]),
        )

        return {
          ...table,
          rows: [...table.rows, row(values)],
        }
      })

      const snapshot: DatabaseSnapshot = {
        workspaceId: state.hydratedWorkspaceId ?? 'workspace',
        tables,
        updatedAt: Date.now(),
      }

      queueSave(snapshot, () => set({ saveState: 'saved' }))
      return { tables, saveState: 'saving' }
    }),
  deleteRow: (tableName, rowId) =>
    set((state) => {
      const tables = state.tables.map((table) =>
        table.name === tableName
          ? { ...table, rows: table.rows.filter((rowEntry) => rowEntry.id !== rowId) }
          : table,
      )

      const snapshot: DatabaseSnapshot = {
        workspaceId: state.hydratedWorkspaceId ?? 'workspace',
        tables,
        updatedAt: Date.now(),
      }

      queueSave(snapshot, () => set({ saveState: 'saved' }))
      return { tables, saveState: 'saving' }
    }),
}))
