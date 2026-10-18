import { useEffect, useRef } from 'react'
import { fmtHours, fmtTime } from '../format'
import { hapticSuccess } from '../ui/haptics'

export interface Confirmation {
  kind: 'in' | 'out' | 'repeat-in' | 'repeat-out'
  name: string
  /** ISO instant shown large: the punch, or for a repeat the punch already recorded. */
  at: string
  /** Hours worked, for a clock-out. */
  worked?: number
  /** Object URL of the photo just taken, or the picture the tile already shows. Null: initials. */
  photoUrl: string | null
  initials: string
}

const SHOW_MS = 1800

// Wording from the Kiosk · punch flow board, panels 2 to 4. Tapping it, or waiting, dismisses it.
export function PunchConfirm({ c, onDone }: { c: Confirmation; onDone: () => void }) {
  // The timer must outlive re-renders: the kiosk redraws every second for its clock, and an inline
  // onDone is a new function each time, which used to restart this timer before it could fire.
  const done = useRef(onDone)
  done.current = onDone
  // A short buzz where the device has one, so a punch is felt even if the screen is not looked at.
  useEffect(() => {
    if (c.kind === 'in' || c.kind === 'out') hapticSuccess()
  }, [c])
  useEffect(() => {
    const t = setTimeout(() => done.current(), SHOW_MS)
    return () => clearTimeout(t)
  }, [c])

  const repeat = c.kind === 'repeat-in' || c.kind === 'repeat-out'
  const verb = { in: 'Clocked in', out: 'Clocked out', 'repeat-in': 'Already clocked in', 'repeat-out': 'Already clocked out' }[c.kind]
  const detail = repeat
    ? 'No need to tap again'
    : c.kind === 'in'
      ? `Started at ${fmtTime(c.at)}`
      : `Worked ${fmtHours(c.worked ?? 0)} hrs today`

  return (
    <div className="kiosk-confirm" role="status" aria-live="polite" onClick={onDone}>
      <div className={`tc-confirm${repeat ? ' tc-confirm--repeat' : ''}`}>
        {c.photoUrl ? <img className="tc-confirm__photo" src={c.photoUrl} alt="" /> : <div className="tc-confirm__photo" aria-hidden="true">{c.initials}</div>}
        <span className="tc-confirm__verb" style={c.kind === 'out' ? { color: 'var(--ink)' } : undefined}>{verb}</span>
        <span className="title-1">{c.name}</span>
        <span className="time-large">{fmtTime(c.at)}</span>
        <span className="body kiosk-muted">{detail}</span>
      </div>
    </div>
  )
}
