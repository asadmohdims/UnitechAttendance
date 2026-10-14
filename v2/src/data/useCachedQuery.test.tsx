import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { memoryKv, QueryCache } from './queryCache'
import { useCachedQuery } from './useCachedQuery'

function Roster({ cache, fetcher }: { cache: QueryCache; fetcher: () => Promise<string[]> }) {
  const q = useCachedQuery('roster', fetcher, cache)
  return (
    <div>
      <ul>{q.data?.map((n) => <li key={n}>{n}</li>)}</ul>
      <span data-testid="state">{`${q.fetching ? 'fetching' : 'idle'}|${q.error ? 'error' : 'ok'}`}</span>
    </div>
  )
}

const seededCache = () => {
  const kv = memoryKv()
  kv.set('roster', JSON.stringify({ v: ['Faizan', 'Imran'], at: 1 }))
  return new QueryCache(kv)
}

describe('offline cold boot', () => {
  it('draws the saved roster on the first render while the network never answers', () => {
    const cache = seededCache()
    render(<Roster cache={cache} fetcher={() => new Promise<string[]>(() => {})} />)
    // synchronous: no await, no loading state in between
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Faizan', 'Imran'])
  })

  it('keeps the roster on screen when the fetch fails, and flags the error', async () => {
    const cache = seededCache()
    render(<Roster cache={cache} fetcher={() => Promise.reject(new Error('offline'))} />)
    await act(async () => {})
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByTestId('state').textContent).toBe('idle|error')
  })

  it('updates in place when the network answers', async () => {
    const cache = seededCache()
    render(<Roster cache={cache} fetcher={async () => ['Faizan', 'Imran', 'Jamshed']} />)
    await act(async () => {})
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByTestId('state').textContent).toBe('idle|ok')
  })

  it('first ever run with no saved data shows nothing until the fetch lands', async () => {
    const cache = new QueryCache(memoryKv())
    render(<Roster cache={cache} fetcher={async () => ['Raju']} />)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    await act(async () => {})
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('refetches quietly when the tablet wakes', async () => {
    const cache = seededCache()
    let calls = 0
    render(<Roster cache={cache} fetcher={async () => (++calls, ['Faizan'])} />)
    await act(async () => {})
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(calls).toBe(2)
  })
})
