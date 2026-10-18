import { describe, expect, it } from 'vitest'
import { promisifyStore } from './store'

describe('promisifyStore', () => {
  it('turns a plain return value into a promise', async () => {
    const s = promisifyStore({ listEmployees: () => [{ id: '1' }] }) as unknown as { listEmployees(): Promise<unknown> }
    const p = s.listEmployees()
    expect(p).toBeInstanceOf(Promise)
    expect(await p).toEqual([{ id: '1' }])
  })

  it('turns a synchronous throw into a rejection, so there is one failure path', async () => {
    const s = promisifyStore({
      deleteRecord: () => {
        throw new Error('boom')
      },
    }) as unknown as { deleteRecord(): Promise<unknown> }
    await expect(s.deleteRecord()).rejects.toThrow('boom')
  })

  it('passes arguments through and keeps `this` on the source', async () => {
    const source = {
      tag: 'x',
      get(this: { tag: string }, a: number, b: number) {
        return `${this.tag}:${a + b}`
      },
    }
    const s = promisifyStore(source as never) as unknown as { get(a: number, b: number): Promise<string> }
    expect(await s.get(1, 2)).toBe('x:3')
  })
})

describe('read-only mode', () => {
  const source = { listEmployees: () => [{ id: '1' }], clockOut: () => 'wrote', setPaymentResolution: () => 'wrote', uploadPhoto: () => 'wrote' }
  it('refuses every write by name and lets reads through', async () => {
    const s = promisifyStore(source as never, { readOnly: true }) as unknown as Record<string, () => Promise<unknown>>
    await expect(s.listEmployees()).resolves.toEqual([{ id: '1' }])
    for (const name of ['clockOut', 'setPaymentResolution', 'uploadPhoto']) await expect(s[name]()).rejects.toThrow('Read-only mode: nothing was saved.')
  })
  it('lists every write the Store interface has, so a new one cannot slip past the guard', async () => {
    const { readFileSync } = await import('node:fs')
    const { WRITE_METHODS } = await import('./store')
    const src = readFileSync('src/data/store.ts', 'utf8')
    const iface = src.slice(src.indexOf('export interface Store'), src.indexOf('type LegacyMethods'))
    const names = [...iface.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1])
    const reads = names.filter((n) => /^(list|get)/.test(n))
    expect(names.filter((n) => !reads.includes(n)).sort()).toEqual([...WRITE_METHODS].sort())
  })
})
