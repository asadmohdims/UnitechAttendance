import { useEffect, useState } from 'react'

/** Re-renders on an interval with the current time; the kiosk clock and the 5s checks use it. */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
