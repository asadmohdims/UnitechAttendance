import { queryCache } from './queryCache'
import { store } from './store'
import { dateKey } from '../format'

/**
 * After an admin write, the kiosk's saved view of who is clocked in and today's punches may be
 * behind. Re-read both quietly so the next time the kiosk is shown it is right.
 */
export function refreshKioskData(now: Date = new Date()): Promise<void[]> {
  const today = dateKey(now)
  return Promise.all([
    queryCache.revalidate('openSessions', () => store.listOpenSessions()),
    queryCache.revalidate(`records:${today}`, () => store.listRecordsForDate(today)),
  ])
}

export const REFRESH_EVENT = 'tc2:refresh'

/** Ask every screen to re-read what it shows, e.g. when the tablet's sign-in has just been renewed. */
export const requestRefresh = () => window.dispatchEvent(new Event(REFRESH_EVENT))
