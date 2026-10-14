import { countedClockOut } from '@legacy/autoClosed.js'
import type { SessionView } from '../types'

// The board draws 8 AM to 8 PM; punches outside that are clipped to the track.
const FROM = 8
const SPAN = 12
/**
 * Position on the 8 AM to 8 PM track, in percent. Measured from midnight of the day the session
 * started, so a clock-out stamped at 12:00 AM the next day lands at the right-hand end instead of
 * wrapping round to hour 0 and vanishing.
 */
export function trackPercent(t: Date, dayStart: Date): number {
  const h = (t.getTime() - dayStart.getTime()) / 3600000
  return Math.min(100, Math.max(0, ((h - FROM) / SPAN) * 100))
}

export function Timeline({ sessions, now }: { sessions: SessionView[]; now: Date }) {
  const segs: { left: number; width: number; kind: 'ok' | 'auto' | 'owner' }[] = []
  const gaps: { left: number; width: number }[] = []
  sessions.forEach((s, i) => {
    const r = s.record
    const start = new Date(r.clock_in)
    const dayStart = new Date(start)
    dayStart.setHours(0, 0, 0, 0)
    const pct = (d: Date) => trackPercent(d, dayStart)
    // A session the kiosk closed at midnight is paid only to closing time (countedClockOut): solid
    // up to there, hatched for the stretch after.
    const counted = r.clock_out ? new Date(countedClockOut(r)) : now
    const real = r.clock_out ? new Date(r.clock_out) : now
    const added = s.mine.added
    const a = pct(start)
    const b = pct(counted)
    if (b > a) segs.push({ left: a, width: b - a, kind: added ? 'owner' : 'ok' })
    if (real.getTime() > counted.getTime() + 60000) {
      const c = pct(real)
      if (c > b) segs.push({ left: b, width: c - b, kind: 'auto' })
    }
    const prev = sessions[i - 1]?.record
    if (prev?.clock_out) {
      const g0 = pct(new Date(prev.clock_out))
      if (a > g0) gaps.push({ left: g0, width: a - g0 })
    }
  })
  return (
    <div>
      <div className="tc-tl" role="img" aria-label="Sessions across the day, 8 AM to 8 PM">
        {segs.map((s, i) => (
          <span key={i} className={`tc-tl__seg${s.kind === 'auto' ? ' tc-tl__seg--auto' : s.kind === 'owner' ? ' tc-tl__seg--owner' : ''}`} style={{ left: `${s.left}%`, width: `${s.width}%` }} />
        ))}
        {gaps.map((g, i) => (
          <span key={i} className="tc-tl__gap" style={{ left: `${g.left}%`, width: `${g.width}%` }} />
        ))}
      </div>
      <div className="tc-tl__axis" aria-hidden="true">
        <span>8 AM</span><span>11 AM</span><span>2 PM</span><span>5 PM</span><span>8 PM</span>
      </div>
    </div>
  )
}
