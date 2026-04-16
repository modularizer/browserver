export type LetterState = 'correct' | 'present' | 'absent'

export interface GuessResult {
  guess: string
  states: LetterState[]
  won: boolean
  gameOver: boolean
  attemptsUsed: number
  attemptsLeft: number
  answer?: string
}

export interface GameSession {
  id: string
  attemptsLeft: number
  wordLength: number
}
