import { useEffect, useState } from 'react'

/** True while the window is at least `px` wide. Screens that switch between two layouts (side by side, or one at a time) share it. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width:${px}px)`
  const [wide, setWide] = useState(() => window.matchMedia?.(query).matches ?? true)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return wide
}
