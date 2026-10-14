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
