import { createServer } from '@modularizer/plat-client'
import { StaticFolder } from '@modularizer/plat-client/static'
import { createClient } from 'fake-redis'
import { ANSWERS } from './words'
import { TABLES, type GameRow, type StatsSummary } from './schema'
import type { GameSession, GuessResult, LetterState } from './types'

const MAX_ATTEMPTS = 6
const SESSION_TTL_SECONDS = 60 * 60

// Sessions live in Redis so they survive dev-watch runtime reloads (which wipe
// module-level state). In the browser, `redis` is shimmed to a localStorage-
// backed implementation by the browserver runtime — same API, no code change.
// connect() is a no-op in the browser; real node-redis requires it, so the
// call stays here so porting off-browser needs zero edits.
const redis = createClient()
await redis.connect()
const sessionKey = (id: string) => `session:${id}`

interface SessionState { answer: string; attemptsUsed: number }
interface SubmitGuessInput { sessionId: string; guess: string }

async function loadSession(id: string): Promise<SessionState | null> {
    const raw = await redis.get(sessionKey(id))
    return raw ? JSON.parse(raw) as SessionState : null
}
async function saveSession(id: string, state: SessionState): Promise<void> {
    await redis.setEx(sessionKey(id), SESSION_TTL_SECONDS, JSON.stringify(state))
}

// ---------- tiny IndexedDB KV backing the 'games' table ----------
//
// We use raw IndexedDB so the sample has zero external db dependencies and
// runs inside the blob-module the runner imports. The database is namespaced
// per server so two plat servers never collide, and the store's keyPath is
// the row's `id` column (matching schema.TABLES.games.primaryKey).

const DB_NAME = `wordle:${process.env.SERVER_NAME}`
const DB_VERSION = 1
const STORE = TABLES.games.name

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION)
        req.onupgradeneeded = () => {
            const db = req.result
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: TABLES.games.primaryKey })
            }
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
    })
}

async function runStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb()
    return new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
        tx.oncomplete = () => db.close()
    })
}

async function insertGame(row: GameRow): Promise<void> {
    await runStore('readwrite', (s) => s.put(row))
}
async function allGames(): Promise<GameRow[]> {
    const rows = await runStore<GameRow[]>('readonly', (s) => s.getAll() as IDBRequest<GameRow[]>)
    return rows.sort((a, b) => a.playedAt - b.playedAt)
}
async function clearGames(): Promise<void> {
    await runStore('readwrite', (s) => s.clear())
}

// ---------- pure helpers ----------

function scoreGuess(guess: string, answer: string): LetterState[] {
    const out: LetterState[] = Array(guess.length).fill('absent')
    const counts: Record<string, number> = {}
    for (const ch of answer) counts[ch] = (counts[ch] ?? 0) + 1
    for (let i = 0; i < guess.length; i++) {
        if (guess[i] === answer[i]) { out[i] = 'correct'; counts[guess[i]]-- }
    }
    for (let i = 0; i < guess.length; i++) {
        if (out[i] === 'correct') continue
        if ((counts[guess[i]] ?? 0) > 0) { out[i] = 'present'; counts[guess[i]]-- }
    }
    return out
}

function summarize(rows: GameRow[]): StatsSummary {
    const distribution = Array(7).fill(0) as number[]
    let wins = 0
    let currentStreak = 0
    let maxStreak = 0
    for (const r of rows) {
        if (r.won) {
            wins += 1
            currentStreak += 1
            maxStreak = Math.max(maxStreak, currentStreak)
            const bucket = Math.min(6, Math.max(1, r.guesses))
            distribution[bucket] += 1
        } else {
            currentStreak = 0
        }
    }
    return { played: rows.length, wins, currentStreak, maxStreak, distribution }
}

// ---------- controllers ----------

class WordleApi {
    root = new StaticFolder(__workspaceFiles, {
        exclude: ['**/*.ts', '**/*.tsx'],
        index: 'index.html',
    })

    async startGame(): Promise<GameSession> {
        const id = crypto.randomUUID()
        const answer = ANSWERS[Math.floor(Math.random() * ANSWERS.length)]
        await saveSession(id, { answer, attemptsUsed: 0 })
        return { id, attemptsLeft: MAX_ATTEMPTS, wordLength: answer.length }
    }

    async submitGuess(input: SubmitGuessInput): Promise<GuessResult> {
        const { sessionId, guess } = input
        if (!sessionId) throw new Error('Missing sessionId. Start a new game.')
        const session = await loadSession(sessionId)
        if (!session) throw new Error('Unknown session. Start a new game.')
        const normalized = guess.toLowerCase()
        if (!/^[a-z]{5}$/.test(normalized)) throw new Error('Guess must be 5 letters.')
        session.attemptsUsed += 1
        const states = scoreGuess(normalized, session.answer)
        const won = states.every((s) => s === 'correct')
        const attemptsLeft = MAX_ATTEMPTS - session.attemptsUsed
        const gameOver = won || attemptsLeft === 0
        const answer = gameOver ? session.answer : undefined
        if (gameOver) {
            await insertGame({
                id: sessionId,
                answer: session.answer,
                guesses: session.attemptsUsed,
                won: won ? 1 : 0,
                playedAt: Date.now(),
            })
            await redis.del(sessionKey(sessionId))
        } else {
            await saveSession(sessionId, session)
        }
        return { guess: normalized, states, won, gameOver, attemptsUsed: session.attemptsUsed, attemptsLeft, answer }
    }
}

class StatsApi {
    /** Aggregated stats derived from the persisted `games` table. */
    async getStats(): Promise<StatsSummary> {
        return summarize(await allGames())
    }
    /** Full game log, oldest first. */
    async listGames(): Promise<GameRow[]> {
        return allGames()
    }
    async resetStats(): Promise<StatsSummary> {
        await clearGames()
        return summarize([])
    }
}

/**
 * Generic database introspection. The studio's data panel polls these methods
 * (when present) against the running server to render a live read-only view
 * of its tables — so *any* plat server can opt into the browser by including
 * a similar controller.
 */
class DbApi {
    async listTables(): Promise<Array<{ name: string; columns: { name: string; type: string }[] }>> {
        return Object.values(TABLES).map((t) => ({ name: t.name, columns: t.columns }))
    }
    async queryTable({ name, limit }: { name: string; limit?: number }): Promise<GameRow[]> {
        if (name !== TABLES.games.name) throw new Error(`Unknown table: ${name}`)
        const rows = await allGames()
        return typeof limit === 'number' ? rows.slice(-limit) : rows
    }
}

const server = createServer({name: process.env.SERVER_NAME!}, WordleApi, StatsApi, DbApi)
await server.listen()

export { WordleApi, StatsApi, DbApi }
export default server
