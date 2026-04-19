import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@modularizer/plat-client'
import type { StatsSummary } from './schema'
import type { GuessResult, LetterState } from './types'

const MAX_ROWS = 6
const WORD_LEN = 5
const EMPTY_STATS: StatsSummary = { played: 0, wins: 0, currentStreak: 0, maxStreak: 0, distribution: Array(7).fill(0) }

function stateClass(state: LetterState | undefined, filled: boolean): string {
  if (state === 'correct') return 'bg-emerald-600 border-emerald-600 text-white'
  if (state === 'present') return 'bg-amber-500 border-amber-500 text-white'
  if (state === 'absent') return 'bg-slate-700 border-slate-700 text-slate-300'
  if (filled) return 'bg-slate-900 border-slate-500 text-slate-100'
  return 'bg-slate-900 border-slate-700 text-slate-400'
}

export function App() {
  const [client, setClient] = useState<any>(null)
  const sessionIdRef = useRef<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [guesses, setGuesses] = useState<GuessResult[]>([])
  const [current, setCurrent] = useState('')
  const [gameOver, setGameOver] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [stats, setStats] = useState<StatsSummary>(EMPTY_STATS)
  const isFirstClientSet = useRef(true)
  const [pendingGuess, setPendingGuess] = useState<string | null>(null)

  useEffect(() => {
    // Use window.baseUrl (must be set by index.html)
    const baseUrl = (window as any).baseUrl
    if (!baseUrl) throw new Error('window.baseUrl is not set')
    let cancelled = false
    void (async () => {
      try {
        const c = await createClient(baseUrl)
        if (cancelled) return
        
        if (typeof c?.getStats !== 'function') {
          throw new Error('Client initialized but server API is unreachable or invalid (getStats missing)')
        }

        setClient(() => c)
        const s = await c.getStats({}) as StatsSummary
        if (!cancelled) setStats(s)
      } catch (err: any) {
        if (!cancelled) setBanner(`connect failed: ${String(err?.message ?? err)}`)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const newGame = useCallback(async (preserveCurrent = false) => {
    if (!client) return
    if (typeof client?.startGame !== 'function') {
      setBanner('Error: startGame method missing on client')
      return
    }
    const session = await client.startGame({}) as { id: string }
    sessionIdRef.current = session.id
    setSessionId(session.id)
    setGuesses([])
    if (!preserveCurrent) setCurrent('')
    setGameOver(false)
    setAnswer(null)
    setBanner(null)
  }, [client])

  // On client set, start a new game, but preserve current guess if first time and user has typed
  useEffect(() => {
    if (client) {
      if (isFirstClientSet.current) {
        isFirstClientSet.current = false
        // Only preserve current if user has typed something
        void newGame(current.length > 0)
      } else {
        void newGame()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  // Modified onSubmit to accept an optional guess param (for queued guess)
  const onSubmit = useCallback(async (guessOverride?: string) => {
    const activeSessionId = sessionIdRef.current
    if (!client) {
      // Queue the guess for when client is ready
      if (guessOverride || current) {
        console.warn('[Wordle] Queuing guess before client:', guessOverride || current)
        setPendingGuess(guessOverride || current)
      }
      setBanner('Connecting... will submit when ready')
      return
    }
    if (!activeSessionId || gameOver) {
      console.warn('[Wordle] Not submitting: no session or game over', { activeSessionId, gameOver })
      return
    }
    const guessToSubmit = guessOverride ?? current
    if (guessToSubmit.length !== WORD_LEN) {
      console.warn('[Wordle] Not submitting: guess not 5 letters', guessToSubmit)
      setBanner('Need 5 letters'); return
    }
    try {
      console.warn('[Wordle] Submitting guess:', guessToSubmit)
      if (typeof client?.submitGuess !== 'function') {
        throw new Error('submitGuess method missing on client')
      }
      const res = await client.submitGuess({ sessionId: activeSessionId, guess: guessToSubmit }) as GuessResult
      setGuesses((g) => [...g, res])
      setCurrent('')
      setBanner(null)
      if (res.gameOver) {
        setGameOver(true)
        setAnswer(res.answer ?? null)
        setBanner(res.won ? `Solved in ${res.attemptsUsed}!` : `Answer: ${res.answer?.toUpperCase()}`)
        setStats(await client.getStats({}) as StatsSummary)
      }
    } catch (err: any) {
      console.warn('[Wordle] Error submitting guess:', err)
      setBanner(String(err?.message ?? err))
    }
  }, [client, current, gameOver])

  // Dedicated effect: submit pending guess after client connects and sessionId is set
  useEffect(() => {
    if (client && sessionId && pendingGuess) {
      console.warn('[Wordle] Detected pending guess after client+sessionId:', pendingGuess)
      setBanner(null)
      void onSubmit(pendingGuess)
      setPendingGuess(null)
    }
  }, [client, sessionId, pendingGuess, onSubmit])

  // Ref to always have the latest onSubmit
  const onSubmitRef = useRef(onSubmit)
  useEffect(() => { onSubmitRef.current = onSubmit }, [onSubmit])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (gameOver) return
      const k = e.key.toLowerCase()
      if (k === 'enter') { e.preventDefault(); void onSubmit() }
      else if (k === 'backspace') { e.preventDefault(); setCurrent((c) => c.slice(0, -1)); setBanner(null) }
      else if (/^[a-z]$/.test(k) && current.length < WORD_LEN) {
        e.preventDefault()
        setCurrent((c) => c + k)
        setBanner(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [current.length, gameOver, onSubmit])

  const rows = useMemo(() => Array.from({ length: MAX_ROWS }, (_, rowIdx) => {
    const guess = guesses[rowIdx]
    const isCurrent = !guess && rowIdx === guesses.length
    const text = guess ? guess.guess : isCurrent ? current : ''
    return Array.from({ length: WORD_LEN }, (_, colIdx) => {
      const ch = text[colIdx] ?? ''
      const state = guess?.states[colIdx]
      return { ch, state, filled: Boolean(ch) }
    })
  }), [guesses, current])

  const winRate = stats.played > 0 ? Math.round((stats.wins / stats.played) * 100) : 0
  const resetStats = useCallback(async () => {
    if (!client) return
    setStats(await client.resetStats({}) as StatsSummary)
  }, [client])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center px-4 py-6">
      <header className="w-full max-w-md flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold tracking-widest">WORDLE</h1>
        <button onClick={() => void newGame()} className="rounded bg-slate-800 hover:bg-slate-700 px-3 py-1 text-sm">
          New game
        </button>
      </header>

      {banner && (
        <div className="w-full max-w-md mb-3 rounded bg-slate-800 border border-slate-700 px-3 py-2 text-center text-sm">
          {banner}
        </div>
      )}

      <div className="grid grid-rows-6 gap-1.5 mb-6">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-5 gap-1.5">
            {row.map((cell, j) => (
              <div key={j} className={`h-14 w-14 border-2 flex items-center justify-center text-2xl font-bold uppercase rounded ${stateClass(cell.state, cell.filled)}`}> 
                {cell.ch}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Keyboard input only; input box and submit button removed as per original design */}

      <p className="text-xs text-slate-500 mb-4">type to guess · enter to submit · backspace to delete</p>

      <section className="w-full max-w-md rounded border border-slate-800 bg-slate-900 p-3">
        <div className="flex justify-between text-sm mb-2">
          <span>Played: <b>{stats.played}</b></span>
          <span>Win %: <b>{winRate}</b></span>
          <span>Streak: <b>{stats.currentStreak}</b></span>
          <span>Max: <b>{stats.maxStreak}</b></span>
          <button onClick={() => void resetStats()} className="text-slate-400 hover:text-slate-200 underline">reset</button>
        </div>
        <div className="flex flex-col gap-0.5">
          {stats.distribution.slice(1).map((count, i) => {
            const max = Math.max(1, ...stats.distribution.slice(1))
            const pct = Math.round((count / max) * 100)
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="w-4 text-slate-400">{i + 1}</span>
                <div className="bg-emerald-700 rounded px-2 py-0.5 text-right text-white" style={{ width: `${Math.max(8, pct)}%` }}>
                  {count}
                </div>
              </div>
            )
          })}
        </div>
        {gameOver && answer && (
          <div className="mt-3 text-center text-sm text-slate-300">
            Answer: <b className="tracking-widest uppercase">{answer}</b>
          </div>
        )}
      </section>
    </div>
  )
}
