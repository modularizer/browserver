// Shared schema — imported by both server and client. Describes the persistent
// game-log table: one row per completed Wordle game.
//
// Kept minimal and declarative so the studio's data panel (see BottomPanel /
// useDatabaseStore) and the server's __db__ introspection controller agree on
// column names and types without either side importing the other's code.

export interface GameRow {
  id: string
  answer: string
  guesses: number
  won: 0 | 1
  playedAt: number
}

export const gameColumns = [
  { name: 'id', type: 'text' as const },
  { name: 'answer', type: 'text' as const },
  { name: 'guesses', type: 'number' as const },
  { name: 'won', type: 'number' as const },
  { name: 'playedAt', type: 'number' as const },
]

export const TABLES = {
  games: { name: 'games', columns: gameColumns, primaryKey: 'id' as const },
}

export interface StatsSummary {
  played: number
  wins: number
  currentStreak: number
  maxStreak: number
  /** histogram — distribution[i] = games won in exactly i attempts. Index 0 is unused. */
  distribution: number[]
}
