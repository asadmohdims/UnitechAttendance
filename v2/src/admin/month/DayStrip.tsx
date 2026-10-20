import type { PersonMonth } from './monthModel'

/** One small square per day, so "where did the hours go" can be read without opening Attendance. */
export function DayStrip({ person, needsLook }: { person: PersonMonth; needsLook: (date: string) => boolean }) {
  const cells = person.days.map((d) => {
    const look = needsLook(d.date) || d.kind === 'open'
    const kind = look ? 'look' : d.kind === 'holiday' && d.docked ? 'docked' : d.kind === 'worked' ? 'worked' : d.kind === 'half' ? 'half' : d.kind === 'absent' ? 'absent' : d.kind === 'holiday' ? 'holiday' : d.isFuture ? 'future' : 'none'
    const label = { look: 'Needs a look', docked: 'Friday marked unpaid', worked: 'Worked', half: 'Half day', absent: 'Absent', holiday: 'Paid Friday', future: 'Not yet', none: 'Not employed' }[kind]
    return { d, kind, label }
  })
  const present = new Set(cells.map((c) => c.kind))
  const legend = [['worked', 'Worked'], ['half', 'Half day'], ['absent', 'Absent'], ['holiday', 'Paid Friday'], ['docked', 'Friday unpaid'], ['look', 'To check']] as const
  return (
    <div>
      <div className="pay-strip" role="img" aria-label="The month day by day">
        {cells.map(({ d, kind, label }) => <i key={d.date} className={`pay-strip__${kind}`} title={`${d.day} · ${label}`} />)}
      </div>
      <div className="pay-strip__legend caption app-muted">
        {legend.filter(([k]) => present.has(k)).map(([k, t]) => <span key={k} className={`pay-strip__key pay-strip__key--${k}`}>{t}</span>)}
      </div>
    </div>
  )
}
