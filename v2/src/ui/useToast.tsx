import { useCallback, useEffect, useState } from 'react'

/** One short message at a time, bottom centre, gone after 3.2s. Returns [show, element]. */
export function useToast(): [(msg: string) => void, React.ReactNode] {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), 3200)
    return () => clearTimeout(t)
  }, [msg])
  const show = useCallback((m: string) => setMsg(m), [])
  return [show, msg ? <div className="tc-toast app-toast" role="status">{msg}</div> : null]
}

export const NOT_BUILT = (what: string) => `${what} isn't built in 2.0 yet.`
