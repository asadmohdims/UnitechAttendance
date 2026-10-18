import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { REFRESH_EVENT } from './invalidate'
import { queryCache, type QueryCache, type QuerySnapshot } from './queryCache'

export interface CachedQuery<T> extends QuerySnapshot<T> {
  refetch: () => Promise<void>
}

/**
 * Returns the last good value on the very first render (no spinner, no flash) and refreshes it
 * in the background: on mount, when the tablet wakes, and when the network comes back.
 * `fetcher` may change identity between renders; only `key` decides what is cached.
 */
export function useCachedQuery<T>(key: string, fetcher: () => Promise<T>, cache: QueryCache = queryCache): CachedQuery<T> {
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const snapshot = useSyncExternalStore(
    useCallback((onChange) => cache.subscribe(key, onChange), [cache, key]),
    () => cache.peek<T>(key),
  )

  const refetch = useCallback(() => cache.revalidate(key, () => fetcherRef.current()), [cache, key])

  useEffect(() => {
    void refetch()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetch()
    }
    const onOnline = () => void refetch()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    window.addEventListener(REFRESH_EVENT, onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      window.removeEventListener(REFRESH_EVENT, onOnline)
    }
  }, [refetch])

  return { ...snapshot, refetch }
}
