// Minimal node-redis v4-compatible client backed by localStorage.
//
// Browserver samples get this automatically: the runtime rewrites bare
// `redis` imports to this shim so sample code can be written as if it were
// talking to a real server (`import { createClient } from 'redis'`). When the
// server moves off the browser the import stays the same — npm install redis
// and ship.
//
// Method signatures match node-redis v4+ (camelCase, Promise-returning).
// Values are stored as strings (Redis semantics); JSON-encode in callers.
// TTL is absolute (ms since epoch) and enforced lazily on read.
// Pub/Sub uses BroadcastChannel, so publishes reach other tabs on the same
// origin as well as in-process subscribers.

export type FakeRedisLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'
export type FakeRedisLogger = (level: FakeRedisLogLevel, text: string) => void

export interface FakeRedisOptions {
  /** Per-app key prefix — scope state so multiple servers don't collide. */
  prefix?: string
  /** Storage engine (defaults to window.localStorage). */
  storage?: Storage
  /**
   * Optional sink for diagnostic lines (key reads/writes, pub/sub). The
   * Browserver runtime wires this to the build-pane log view so the user can
   * see shim activity alongside request/response events; stays silent when
   * omitted so this module remains usable outside studio.
   */
  log?: FakeRedisLogger
  /** Any other node-redis options (url, socket, etc.) are accepted and ignored. */
  [key: string]: unknown
}

interface Entry {
  /** string for plain values, object for hashes. */
  v: string | Record<string, string>
  /** absolute expiry (ms since epoch); absent = no TTL. */
  x?: number
}

type SetOptions = { EX?: number; PX?: number; NX?: boolean; XX?: boolean }
type SubscribeListener = (message: string, channel: string) => void

export interface RedisClient {
  connect(): Promise<void>
  quit(): Promise<void>
  disconnect(): Promise<void>

  get(key: string): Promise<string | null>
  set(key: string, value: string, options?: SetOptions): Promise<'OK' | null>
  setEx(key: string, seconds: number, value: string): Promise<'OK'>
  pSetEx(key: string, ms: number, value: string): Promise<'OK'>
  del(keys: string | string[]): Promise<number>
  exists(keys: string | string[]): Promise<number>
  expire(key: string, seconds: number): Promise<boolean>
  ttl(key: string): Promise<number>
  keys(pattern: string): Promise<string[]>
  incr(key: string): Promise<number>
  decr(key: string): Promise<number>
  incrBy(key: string, by: number): Promise<number>
  decrBy(key: string, by: number): Promise<number>

  hSet(key: string, field: string | Record<string, string>, value?: string): Promise<number>
  hGet(key: string, field: string): Promise<string | undefined>
  hGetAll(key: string): Promise<Record<string, string>>
  hDel(key: string, fields: string | string[]): Promise<number>
  hKeys(key: string): Promise<string[]>
  hVals(key: string): Promise<string[]>
  hExists(key: string, field: string): Promise<boolean>

  publish(channel: string, message: string): Promise<number>
  subscribe(channel: string, listener: SubscribeListener): Promise<void>
  unsubscribe(channel?: string): Promise<void>

  flushDb(): Promise<'OK'>
  flushAll(): Promise<'OK'>
}

export function createClient(options: FakeRedisOptions = {}): RedisClient {
  const storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null)
  if (!storage) throw new Error('[fake-redis] localStorage unavailable; pass options.storage')

  const prefix = options.prefix ?? 'fake-redis:'
  const storageKey = (k: string) => prefix + k
  const log: FakeRedisLogger = options.log ?? (() => {})
  log('debug', `[redis] createClient prefix=${prefix}`)

  function readEntry(k: string): Entry | null {
    const raw = storage!.getItem(storageKey(k))
    if (raw == null) return null
    let entry: Entry
    try { entry = JSON.parse(raw) }
    catch { storage!.removeItem(storageKey(k)); return null }
    if (entry.x != null && entry.x <= Date.now()) {
      storage!.removeItem(storageKey(k))
      return null
    }
    return entry
  }

  function writeEntry(k: string, e: Entry): void {
    storage!.setItem(storageKey(k), JSON.stringify(e))
  }

  function readHash(k: string): { hash: Record<string, string>; ttl: number | undefined } | null {
    const e = readEntry(k)
    if (!e) return null
    if (typeof e.v !== 'object' || e.v === null) return null
    return { hash: e.v as Record<string, string>, ttl: e.x }
  }

  function matchGlob(key: string, pattern: string): boolean {
    const re = '^' + pattern
      .replace(/[\\^$+.()|{}[\]]/g, (c) => '\\' + c)
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.') + '$'
    return new RegExp(re).test(key)
  }

  function allPrefixedKeys(): string[] {
    const out: string[] = []
    for (let i = 0; i < storage!.length; i++) {
      const rawKey = storage!.key(i)
      if (rawKey && rawKey.startsWith(prefix)) out.push(rawKey.slice(prefix.length))
    }
    return out
  }

  function incrByImpl(key: string, by: number): number {
    const e = readEntry(key)
    if (e && typeof e.v !== 'string') throw new Error(`[fake-redis] value at '${key}' is not a string`)
    const prev = e ? Number(e.v) : 0
    if (Number.isNaN(prev)) throw new Error(`[fake-redis] value at '${key}' is not an integer`)
    const next = prev + by
    writeEntry(key, { v: String(next), x: e?.x })
    return next
  }

  interface ChannelEntry { bc: BroadcastChannel; listeners: Set<SubscribeListener> }
  const channels = new Map<string, ChannelEntry>()
  const channelTopic = (channel: string) => prefix + 'ch:' + channel

  return {
    async connect() { /* no-op */ },
    async disconnect() { await this.quit() },
    async quit() {
      for (const { bc } of channels.values()) bc.close()
      channels.clear()
    },

    async get(key) {
      const e = readEntry(key)
      const result = (!e || typeof e.v !== 'string') ? null : e.v
      log('debug', `[redis] GET ${storageKey(key)} — ${result === null ? 'miss' : `hit (${result.length}b)`}`)
      return result
    },

    async set(key, value, opts) {
      const existing = readEntry(key)
      if (opts?.NX && existing) return null
      if (opts?.XX && !existing) return null
      const entry: Entry = { v: value }
      if (opts?.EX != null) entry.x = Date.now() + opts.EX * 1000
      else if (opts?.PX != null) entry.x = Date.now() + opts.PX
      writeEntry(key, entry)
      log('debug', `[redis] SET ${storageKey(key)} (${value.length}b)${opts?.EX ? ` ex=${opts.EX}s` : ''}${opts?.PX ? ` px=${opts.PX}ms` : ''}`)
      return 'OK'
    },

    async setEx(key, seconds, value) {
      writeEntry(key, { v: value, x: Date.now() + seconds * 1000 })
      log('debug', `[redis] SETEX ${storageKey(key)} (${value.length}b) ex=${seconds}s`)
      return 'OK'
    },

    async pSetEx(key, ms, value) {
      writeEntry(key, { v: value, x: Date.now() + ms })
      return 'OK'
    },

    async del(keys) {
      const list = Array.isArray(keys) ? keys : [keys]
      let n = 0
      for (const k of list) {
        if (readEntry(k) != null) { storage.removeItem(storageKey(k)); n++ }
      }
      log('debug', `[redis] DEL ${list.map(storageKey).join(',')} — ${n} removed`)
      return n
    },

    async exists(keys) {
      const list = Array.isArray(keys) ? keys : [keys]
      let n = 0
      for (const k of list) if (readEntry(k) != null) n++
      return n
    },

    async expire(key, seconds) {
      const e = readEntry(key)
      if (!e) return false
      writeEntry(key, { ...e, x: Date.now() + seconds * 1000 })
      return true
    },

    async ttl(key) {
      const e = readEntry(key)
      if (!e) return -2
      if (e.x == null) return -1
      return Math.max(0, Math.ceil((e.x - Date.now()) / 1000))
    },

    async keys(pattern) {
      const out: string[] = []
      for (const key of allPrefixedKeys()) {
        if (readEntry(key) != null && matchGlob(key, pattern)) out.push(key)
      }
      return out
    },

    async incr(key) { return incrByImpl(key, 1) },
    async decr(key) { return incrByImpl(key, -1) },
    async incrBy(key, by) { return incrByImpl(key, by) },
    async decrBy(key, by) { return incrByImpl(key, -by) },

    async hSet(key, field, value) {
      const current = readHash(key)
      const hash: Record<string, string> = current ? { ...current.hash } : {}
      let added = 0
      if (typeof field === 'string') {
        if (!(field in hash)) added++
        hash[field] = String(value ?? '')
      } else {
        for (const [f, v] of Object.entries(field)) {
          if (!(f in hash)) added++
          hash[f] = String(v)
        }
      }
      writeEntry(key, { v: hash, x: current?.ttl })
      return added
    },

    async hGet(key, field) {
      const current = readHash(key)
      return current ? current.hash[field] : undefined
    },

    async hGetAll(key) {
      const current = readHash(key)
      return current ? { ...current.hash } : {}
    },

    async hDel(key, fields) {
      const current = readHash(key)
      if (!current) return 0
      const list = Array.isArray(fields) ? fields : [fields]
      const hash = { ...current.hash }
      let n = 0
      for (const f of list) if (f in hash) { delete hash[f]; n++ }
      if (Object.keys(hash).length === 0) storage.removeItem(storageKey(key))
      else writeEntry(key, { v: hash, x: current.ttl })
      return n
    },

    async hKeys(key) {
      const current = readHash(key)
      return current ? Object.keys(current.hash) : []
    },

    async hVals(key) {
      const current = readHash(key)
      return current ? Object.values(current.hash) : []
    },

    async hExists(key, field) {
      const current = readHash(key)
      return current ? field in current.hash : false
    },

    async publish(channel, message) {
      const entry = channels.get(channel)
      let localCount = 0
      if (entry) {
        for (const l of entry.listeners) {
          try { l(message, channel); localCount++ }
          catch (err) { console.warn('[fake-redis] subscriber threw', err) }
        }
      }
      // Fan out to other tabs even if nobody subscribed in this one.
      const bc = entry?.bc ?? new BroadcastChannel(channelTopic(channel))
      bc.postMessage(message)
      if (!entry) bc.close()
      return localCount
    },

    async subscribe(channel, listener) {
      let entry = channels.get(channel)
      if (!entry) {
        const bc = new BroadcastChannel(channelTopic(channel))
        const created: ChannelEntry = { bc, listeners: new Set() }
        bc.onmessage = (ev) => {
          for (const l of created.listeners) {
            try { l(String(ev.data), channel) }
            catch (err) { console.warn('[fake-redis] subscriber threw', err) }
          }
        }
        channels.set(channel, created)
        entry = created
      }
      entry.listeners.add(listener)
    },

    async unsubscribe(channel) {
      if (channel) {
        const entry = channels.get(channel)
        if (entry) { entry.bc.close(); channels.delete(channel) }
        return
      }
      for (const { bc } of channels.values()) bc.close()
      channels.clear()
    },

    async flushDb() {
      for (const key of allPrefixedKeys()) storage.removeItem(storageKey(key))
      return 'OK'
    },

    async flushAll() { return this.flushDb() },
  }
}

/**
 * Build a module-exports record suitable for use as a `redis` bare-specifier
 * shim. `defaultPrefix` is applied when the caller invokes `createClient()`
 * with no `prefix` — the runtime uses it to scope each sample's keys to its
 * server name so multiple samples don't collide in shared localStorage.
 */
export function createRedisShimModule(opts: { defaultPrefix?: string; log?: FakeRedisLogger } = {}): Record<string, unknown> {
  const { defaultPrefix, log } = opts
  const createScopedClient = (options: FakeRedisOptions = {}) => {
    const merged: FakeRedisOptions = { ...options }
    if (merged.prefix == null && defaultPrefix != null) merged.prefix = defaultPrefix
    if (merged.log == null && log != null) merged.log = log
    return createClient(merged)
  }
  return {
    createClient: createScopedClient,
    default: { createClient: createScopedClient },
  }
}
