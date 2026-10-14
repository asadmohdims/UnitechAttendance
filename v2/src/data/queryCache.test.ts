import { describe, expect, it, vi } from 'vitest'
import { memoryKv, QueryCache } from './queryCache'

const seeded = (key: string, value: unknown) => {
  const kv = memoryKv()
  kv.set(key, JSON.stringify({ v: value, at: 1000 }))
  return kv
}

describe('QueryCache', () => {
  it('returns the saved value synchronously, before any fetch', () => {
    const cache = new QueryCache(seeded('employees', [{ id: 'a' }]))
    expect(cache.peek('employees').data).toEqual([{ id: 'a' }])
    expect(cache.peek('employees').updatedAt).toBe(1000)
  })

  it('keeps the stale value and records the error when the fetch fails (offline)', async () => {
    const cache = new QueryCache(seeded('employees', [{ id: 'a' }]))
    await cache.revalidate('employees', () => Promise.reject(new Error('No response from the server')))
    const snap = cache.peek<{ id: string }[]>('employees')
    expect(snap.data).toEqual([{ id: 'a' }])
    expect(snap.error?.message).toMatch('No response')
    expect(snap.fetching).toBe(false)
  })

  it('replaces the value, persists it and clears the error on success', async () => {
    const kv = seeded('employees', [{ id: 'a' }])
    const cache = new QueryCache(kv)
    await cache.revalidate('employees', () => Promise.reject(new Error('x')))
    await cache.revalidate('employees', async () => [{ id: 'b' }])
    expect(cache.peek('employees').data).toEqual([{ id: 'b' }])
    expect(cache.peek('employees').error).toBeNull()
    expect(JSON.parse(kv.get('employees')!).v).toEqual([{ id: 'b' }])
  })

  it('shares one in-flight fetch per key', async () => {
    const cache = new QueryCache(memoryKv())
    const fetcher = vi.fn(async () => 1)
    await Promise.all([cache.revalidate('k', fetcher), cache.revalidate('k', fetcher)])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('survives a corrupt saved value', () => {
    const kv = memoryKv()
    kv.set('k', '{not json')
    const cache = new QueryCache(kv)
    expect(cache.peek('k').data).toBeUndefined()
  })

  it('a second cache over the same storage (a reload) sees the last good value', async () => {
    const kv = memoryKv()
    await new QueryCache(kv).revalidate('roster', async () => ['Faizan'])
    expect(new QueryCache(kv).peek('roster').data).toEqual(['Faizan'])
  })
})
