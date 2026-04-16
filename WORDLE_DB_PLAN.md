# Wordle-with-DB Plan

Goal: migrate the Wordle sample's stats from client-side `localStorage` to a real server-side SQL-ish table so (a) the plat server owns the data, (b) the browserver "data" panel renders the live rows, and (c) users see how to define + query schemas from a plat controller.

## Prior art inventory

### browserver repo
- `packages/database/src/index.ts` — IndexedDB wrapper. Types: `DatabaseValue | Column | Row | Table | Snapshot`. Stores: `workspaceDatabases` (v4), `workspaceSnapshots`. No query layer; pure JSON row storage.
- `apps/studio/src/store/database.ts:1-269` — Zustand `useDatabaseStore` with CRUD + debounced IndexedDB persistence. Type-aware cell parsing.
- `apps/studio/src/shell/BottomPanel.tsx:10-40` — a `data` tab already exists wired to `useDatabaseStore` (table browser, filters, cell editing).
- Wordle sample today: `server.ts` keeps `Map<sessionId, ...>` in memory; `App.tsx` keeps stats in `localStorage`.

**Takeaway:** the IDE already has a "data" panel and a store, but it's a *client-local* table editor. There is no path from a running plat server's tables to that panel.

### plat framework (`/home/mod/Code/plat`)
- `typescript/src/client-side-server/server.ts` — `PLATClientSideServer`: auto-exposes controller methods as RPC endpoints. No model/schema decorators, no persistence.
- `authority/src/storage/adapter.ts` — abstract `StorageAdapter` (CRUD for authority ownership). Not table-aware; wrong abstraction for user tables.

**Takeaway:** plat has no DB layer. Whatever we pick has to be pulled in as a dependency of the server source.

### xpdb (`/home/mod/Code/xpdb`)
- `src/xp-schema/index.ts` — public API: `connect()`, `xpschema`, `XPSchemaPlus`, `XPDatabaseConnectionPlus`, `XPDatabaseTablePlus`. Drizzle-backed.
- `xp-plus/schema.ts:20-80` — `XPSchemaPlus extends Schema<Tables>` with codegen (`gen()`).
- `xp-plus/database.ts:1-100` — `connect(connInfo, schema)` → typed `db.<tableName>` accessors.
- Drivers: `drivers/implementations/{sqlite-mobile,postgres,pglite,indexeddb}.ts`. **`pglite`** is the browser driver we want (PG-WASM, OPFS-backed).
- `src/components/TableViewer/TableViewer.tsx` + `DatabaseBrowserLayout.tsx` — generic table browser with sort/filter/pagination/export. **Built on React Native (Expo)** — not web-ready.

**Takeaway:** xpdb gives us everything schema/query-wise (Drizzle + pglite). The UI pieces would need porting, but browserver already has a web data panel; we only need a new data source.

## Gaps

1. **No server-side schema in the sample.** Need a shared `schema.ts` (types-only consumable from both client and server, like we already split `types.ts`).
2. **No pglite dep in browserver's ESM CDN allow-list.** The bundler fetches from esm.sh; need to verify `@electric-sql/pglite` (xpdb's pglite driver) loads cleanly in the worker/runtime, and that OPFS is available in the site-viewer iframe.
3. **No bridge from server tables → studio data panel.** Today `useDatabaseStore` reads IndexedDB snapshots written by the studio itself. The server holds its tables inside its own runtime memory (or OPFS). Need either:
   - a `listTables` / `queryTable(name)` introspection RPC exposed by a **studio-only debug controller** that the data panel calls, or
   - a plat-level convention (all servers expose `/__db__/tables`, `/__db__/query`) so any server shows up in the panel.
4. **No query editor.** xpdb has a placeholder; browserver has none. MVP can skip this — show tables + rows only.
5. **Persistence scope unclear.** OPFS per-origin means all plat servers served from the site-viewer share an origin. Need to namespace the pglite dir by `serverName` so two samples don't stomp each other.
6. **Hot-reload of schemas.** `dev` rebuilds the server on file change; a schema change needs migrations, not a silent wipe. MVP: drop + recreate on dev; surface a warning.

## Proposed shape

### Files in the sample
```
samples/ts-react-wordle/
  types.ts         // GuessResult, LetterState, GameSession, StatsRow (shared)
  schema.ts        // xpschema tables — imported by server only (type-only re-export to client OK)
  server.ts        // WordleApi + StatsApi controllers, connects to pglite
  App.tsx          // reads stats via plat client from StatsApi.listStats()
  index.tsx, words.ts, package.json
```

### `schema.ts` sketch
```ts
import { xpschema, text, integer, timestamp } from '@modularizer/xpdb'

export const schema = xpschema({
  games: {
    id: text().primaryKey(),
    answer: text().notNull(),
    attemptsUsed: integer().notNull(),
    won: integer().notNull(), // 0/1
    playedAt: timestamp().notNull(),
  },
})
export type GameRow = typeof schema.games.$inferSelect
```

### `server.ts` sketch
```ts
import { connect } from '@modularizer/xpdb/pglite'
import { schema, type GameRow } from './schema'

const dbPromise = connect({ driver: 'pglite', dir: `opfs://${process.env.SERVER_NAME}` }, schema)

class StatsApi {
  async listGames(): Promise<GameRow[]> {
    const db = await dbPromise
    return db.games.select().orderBy(db.games.playedAt.desc()).limit(100)
  }
  async recordGame(row: GameRow): Promise<void> {
    const db = await dbPromise
    await db.games.insert(row)
  }
}

class WordleApi { /* startGame / submitGuess — on gameOver, call stats.recordGame */ }
```

Client uses the plat OpenAPIClient (same pattern we just landed) for both `WordleApi` and `StatsApi`. `localStorage` stats code is deleted.

### Studio integration
- Add a `__db__` convention to xpdb's `connect()`: expose `listTables()` and `query(name, { limit, offset })` as a synthetic controller, auto-registered alongside the user's controllers.
- In `apps/studio/src/store/serverDatabase.ts` (new): when `scriptRunner.phase === 'ok'`, poll `__db__/listTables` via the plat client. Feed results into `useDatabaseStore` with `source: 'server'`.
- `BottomPanel` "data" tab: if `source === 'server'`, disable cell editing (read-only) and add a refresh button.
- Long term: write-back (update/insert from the panel) sends mutations as `__db__/update` RPCs.

## Execution order

1. **Audit pglite in the runtime.** Small spike: load `@electric-sql/pglite` via esm.sh inside `startLocalTsRuntime`, open an OPFS db, insert + select a row. Confirms worker/OPFS viability before touching xpdb.
2. **Vendor or depend on xpdb.** Decide: publish an ESM build of xpdb's pglite slice that esm.sh can resolve, or copy the minimum (schema + pglite driver) into `packages/xpdb-browser` inside this repo.
3. **Land schema + recordGame.** Wordle writes to `games` on gameOver; frontend fetches via `listGames`. Keep `localStorage` code deleted — stats derive from rows.
4. **`__db__` introspection.** Add the synthetic controller in xpdb so *any* plat server exposing tables gets a browser panel for free.
5. **Wire data panel to server source.** New store slice, read-only first. Iterate on UI.
6. **Migrations / schema reload** — deferred; print a warning on schema hash change and drop/recreate in dev.

## Open questions for you

- OK to pull xpdb as a real dependency vs. vendoring a slim `packages/xpdb-browser`?
- Scope of the `__db__` convention — xpdb-level, or plat-level (upstream PR)?
- Do we want multi-user shards (playerId) or single-profile-per-browser for MVP?
