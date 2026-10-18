import { useCallback, useEffect, useState } from 'react'

export type AdminTab = 'days' | 'month' | 'people'
export type Route = { view: 'kiosk' } | { view: 'admin'; tab: AdminTab; date?: string; emp?: string }

/** `#/admin/days`, `#/admin/days/2026-10-12`, `#/admin/days/2026-10-12/<employee id>`, `#/admin/month`, `#/admin/people`; anything else is the kiosk. */
export function parseHash(hash: string): Route {
  const m = /^#\/admin(?:\/(days|month|people)(?:\/(\d{4}-\d{2}-\d{2})(?:\/([\w-]+))?)?)?$/.exec(hash)
  if (!m) return { view: 'kiosk' }
  const tab = (m[1] as AdminTab | undefined) ?? 'days'
  if (m[2] && m[3]) return { view: 'admin', tab, date: m[2], emp: m[3] }
  return m[2] ? { view: 'admin', tab, date: m[2] } : { view: 'admin', tab }
}

export const hashFor = (r: Route) => (r.view === 'kiosk' ? '#/' : r.date ? `#/admin/${r.tab}/${r.date}${r.emp ? `/${r.emp}` : ''}` : `#/admin/${r.tab}`)

export function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const go = useCallback((r: Route) => {
    window.location.hash = hashFor(r)
  }, [])
  return [route, go]
}
