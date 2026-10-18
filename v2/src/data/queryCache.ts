/**
 * Stale-while-revalidate cache for reads, persisted on the device.
 *
 * Why this exists: the legacy store asks the server first and falls back to its own saved copy
 * only after a failure or a 3s timeout, so a screen that awaits it waits on the network. Here the
 * screen draws from the last good result immediately and the fetch happens behind it. A failed
 * fetch leaves the stale data in place and only records the error. Nothing here ever blocks a
 * render on the network.
 */

export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

const PREFIX = 'tc2:q:'

export function localStorageKv(): KeyValueStore {
  return {
    get: (k) => {
      try {
        return localStorage.getItem(PREFIX + k)
      } catch {
        return null
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(PREFIX + k, v)
      } catch {
        /* quota or private mode: the cache is an optimisation, never a requirement */
      }
    },
    remove: (k) => {
      try {
        localStorage.removeItem(PREFIX + k)
      } catch {
        /* same */
      }
    },
  }
}

export function memoryKv(): KeyValueStore {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) }
}

export interface QuerySnapshot<T> {
  /** Last good value, from memory or from the device; undefined only on the very first run. */
  data: T | undefined
  /** When `data` was last confirmed by the server path (ms since epoch), or null. */
  updatedAt: number | null
  /** The most recent fetch failure, cleared by the next success. `data` is kept either way. */
  error: Error | null
  /** A fetch is in flight right now. Not a reason to show a spinner when `data` exists. */
  fetching: boolean
}

interface Entry<T> {
  snapshot: QuerySnapshot<T>
  inflight: Promise<void> | null
  listeners: Set<() => void>
}

interface Persisted<T> {
  v: T
  at: number
}

export class QueryCache {
  private entries = new Map<string, Entry<unknown>>()

  constructor(private kv: KeyValueStore) {}

  private entry<T>(key: string): Entry<T> {
    let e = this.entries.get(key) as Entry<T> | undefined
    if (!e) {
      let data: T | undefined
      let updatedAt: number | null = null
      const raw = this.kv.get(key)
      if (raw) {
        try {
          const p = JSON.parse(raw) as Persisted<T>
          data = p.v
          updatedAt = p.at
        } catch {
          this.kv.remove(key)
        }
      }
      e = { snapshot: { data, updatedAt, error: null, fetching: false }, inflight: null, listeners: new Set() }
      this.entries.set(key, e as Entry<unknown>)
    }
    return e
  }

  /** Synchronous: returns the saved value (if any) without touching the network. */
  peek<T>(key: string): QuerySnapshot<T> {
    return this.entry<T>(key).snapshot
  }

  subscribe(key: string, listener: () => void): () => void {
    const e = this.entry(key)
    e.listeners.add(listener)
    return () => void e.listeners.delete(listener)
  }

  /** Runs `fetcher` (deduplicated per key) and stores a good result. Never throws. */
  revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
    const e = this.entry<T>(key)
    if (e.inflight) return e.inflight
    this.set(e, { fetching: true })
    e.inflight = (async () => {
      try {
        const value = await fetcher()
        const at = Date.now()
        this.kv.set(key, JSON.stringify({ v: value, at } satisfies Persisted<T>))
        this.set(e, { data: value, updatedAt: at, error: null, fetching: false })
      } catch (err) {
        this.set(e, { error: err instanceof Error ? err : new Error(String(err)), fetching: false })
      } finally {
        e.inflight = null
      }
    })()
    return e.inflight
  }

  /** Replaces a cached value after a local write, so the screen reflects it before the refetch. */
  write<T>(key: string, value: T): void {
    const e = this.entry<T>(key)
    const at = Date.now()
    this.kv.set(key, JSON.stringify({ v: value, at } satisfies Persisted<T>))
    this.set(e, { data: value, updatedAt: at })
  }

  private set<T>(e: Entry<T>, patch: Partial<QuerySnapshot<T>>): void {
    e.snapshot = { ...e.snapshot, ...patch }
    e.listeners.forEach((l) => l())
  }
}

export const queryCache = new QueryCache(localStorageKv())
