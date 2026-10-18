import { useMemo, useState } from 'react'
import { WEEKLY_HOLIDAY_DAY } from '@legacy/config.js'
import { dayModel, emptyDayModel } from '@legacy/dayStatus.js'
import type { RecordRow } from '../../data/types'
import { dateKey, fmtHours, fmtTime } from '../../format'
import { Avatar } from '../../ui/Avatar'
import { buildAttentionQueue } from '../dayEntries'
import { calloutStamp, calloutText, fmtDayShort } from '../dayText'
import type { DayModel } from '../types'
import type { MonthDay, MonthModel, PersonMonth } from './monthModel'

const STAMP = { amber: 'attention', green: 'in', pink: 'neutral', blue: 'owner', yellow: 'neutral', grey: 'neutral', red: 'alert', violet: 'holiday' } as const
const CALLOUT = { amber: 'attention', red: 'alert', blue: 'owner', green: 'in', violet: 'holiday', pink: '', yellow: '', grey: '' } as const
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const stripColor = (d: MonthDay) =>
  d.kind === 'worked' ? 'var(--in)' : d.kind === 'half' || d.kind === 'open' ? 'var(--attention)' : d.kind === 'absent' ? 'var(--alert)' : d.kind === 'holiday' ? 'var(--holiday)' : d.isFuture ? 'var(--sunken)' : 'var(--line)'

function strip(p: PersonMonth): string {
  const w = 100 / p.days.length
  return `linear-gradient(to right,${p.days.map((d, i) => `${stripColor(d)} ${(i * w).toFixed(2)}% ${((i + 1) * w).toFixed(2)}%`).join(',')})`
}

/** Design shows a future weekly holiday as a paid "F" too, since the weekday alone says so. */
const isFutureHoliday = (d: MonthDay) => d.kind === 'none' && d.isFuture && new Date(`${d.date}T12:00:00`).getDay() === WEEKLY_HOLIDAY_DAY

function cellClass(d: MonthDay): string {
  const base = d.kind === 'worked' ? 'full' : d.kind === 'half' ? 'half' : d.kind === 'absent' ? 'absent' : d.kind === 'holiday' || isFutureHoliday(d) ? 'holiday' : d.kind === 'open' ? (d.isToday ? 'full' : 'half') : 'future'
  return ['tc-day', `tc-day--${base}`, d.isToday ? 'tc-day--today' : ''].filter(Boolean).join(' ')
}

export interface AttendanceActions {
  openInDays: (date: string, empId: string) => void
  addMissedPunch: (p: PersonMonth, date: string) => void
  toggleHoliday: (p: PersonMonth, date: string, docked: boolean) => void
  listDates: (p: PersonMonth) => void
}

interface Props {
  model: MonthModel
  records: RecordRow[]
  overtime: { emp_id: string; date: string; hours: number }[]
  now: Date
  currentYm: string
  actions: AttendanceActions
}

export function Attendance({ model, records, overtime, now, currentYm, actions }: Props) {
  const today = dateKey(now)
  const [pickedEmp, setPickedEmp] = useState<string | null>(null)
  const [pickedDay, setPickedDay] = useState<{ emp: string; day: number } | null>(null)

  const person = model.people.find((p) => p.emp.id === pickedEmp) ?? model.people.find((p) => p.needsReview) ?? model.people[0]
  // Open on the first day of that person that needs a look, so the callout is already there.
  const defaultDay = person?.days.find((d) => d.kind === 'open' || d.flagged)
  const day = pickedDay && person && pickedDay.emp === person.emp.id ? person.days[pickedDay.day - 1] : defaultDay

  const queueCount = useMemo(() => buildAttentionQueue(model.people.map((p) => p.emp), records, overtime, now).length, [model.people, records, overtime, now])

  if (!model.hasData) return <p className="days__empty body app-muted">No completed attendance for this month.</p>

  const names = (rs: RecordRow[]) => [...new Set(rs.map((r) => model.people.find((p) => p.emp.id === r.emp_id)?.emp.name ?? 'An employee'))]
  const notOut = names(model.reviewRecords.filter((r) => !r.clock_out))
  const noPhoto = names(model.reviewRecords.filter((r) => r.clock_out))
  const verb = (n: string[], one: string, many: string) => (n.length === 1 ? one : many)
  const parts = [
    notOut.length ? `${notOut.join(', ')} ${verb(notOut, 'has', 'have')} not clocked out yet` : '',
    noPhoto.length ? `${noPhoto.join(', ')} ${verb(noPhoto, 'has', 'have')} a day closed without a clock-out photo` : '',
  ].filter(Boolean)
  const reviewCount = model.reviewRecords.length
  const first = model.reviewRecords[0]

  const isCurrent = model.ym === currentYm
  const t = model.totals

  return (
    <>
      {reviewCount > 0 && (
        <div className="tc-callout tc-callout--attention month-callout">
          <div style={{ minWidth: 240, flex: 1 }}>
            <span className="tc-stamp tc-stamp--attention">{reviewCount} {reviewCount === 1 ? 'entry needs' : 'entries need'} review</span>
            <p style={{ marginTop: 8 }}>{parts.join('. ')}.</p>
          </div>
          <button type="button" className="tc-btn tc-btn--primary" onClick={() => actions.openInDays(first.date, first.emp_id)}>Review entries</button>
        </div>
      )}

      <div className="month-stats">
        <div className="tc-stat"><span className="tc-stat__label">Hours recorded</span><span className="stat">{fmtHours(t.hours)}</span><span className="tc-stat__sub">{model.people.length} {model.people.length === 1 ? 'person' : 'people'}, {model.daysElapsed} days</span></div>
        <div className="tc-stat"><span className="tc-stat__label">Days worked</span><span className="stat">{t.daysWorked}</span><span className="tc-stat__sub">of {t.expectedDays}{isCurrent ? ' so far' : ''}</span></div>
        <div className="tc-stat"><span className="tc-stat__label">Absences</span><span className="stat" style={{ color: t.absences ? 'var(--alert-ink)' : undefined }}>{t.absences}</span><span className="tc-stat__sub">plus {t.halfDays} half {t.halfDays === 1 ? 'day' : 'days'}</span></div>
        <div className="tc-stat"><span className="tc-stat__label">Needs attention</span><span className="stat" style={{ color: queueCount ? 'var(--attention-ink)' : undefined }}>{queueCount}</span><span className="tc-stat__sub">open in Days</span></div>
      </div>

      <div className="month-cols">
        <section className="month-people">
          <h2 className="heading" style={{ margin: 0 }}>People</h2>
          <div className="tc-queue" role="list">
            {model.people.map((p) => (
              <button key={p.emp.id} type="button" role="listitem" className="tc-queue__row month-row" aria-pressed={p.emp.id === person?.emp.id} onClick={() => { setPickedEmp(p.emp.id); setPickedDay(null) }}>
                <Avatar emp={p.emp} />
                <span className="month-row__body">
                  <span className="month-row__top"><span className="tc-queue__title">{p.emp.name}</span><span className="time">{fmtHours(p.exactTotal)}</span></span>
                  <span className="month-strip" style={{ background: strip(p) }} aria-hidden="true" />
                </span>
                <span className="tc-queue__go" />
              </button>
            ))}
          </div>
          <div className="caption app-muted">Each strip is the month, one block per day.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <span className="tc-stamp tc-stamp--in">Worked</span>
            <span className="tc-stamp tc-stamp--attention">Half day</span>
            <span className="tc-stamp tc-stamp--alert">Absent</span>
            <span className="tc-stamp tc-stamp--holiday">Holiday</span>
          </div>
        </section>

        {person && (
          <section className="month-detail" aria-label={`${person.emp.name}, ${model.ym}`}>
            <div className="month-detail__head">
              <Avatar emp={person.emp} />
              <div>
                <div className="title-2">{person.emp.name}</div>
                <div className="caption app-muted">
                  {new Date(`${model.ym}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} · {fmtHours(person.paidTotal)} paid · {person.daysOff} {person.daysOff === 1 ? 'absence' : 'absences'} · {person.halfDays} half {person.halfDays === 1 ? 'day' : 'days'}
                </div>
              </div>
              {person.absentEq > 0 && <button type="button" className="tc-btn tc-btn--quiet" onClick={() => actions.listDates(person)}>See the exact dates</button>}
            </div>

            <div className="tc-cal">
              {DOW.map((d) => <span key={d} className="tc-cal__dow">{d}</span>)}
              {Array.from({ length: (new Date(`${model.ym}-01T12:00:00`).getDay() + 6) % 7 }, (_, i) => <span key={`b${i}`} className="tc-day tc-day--blank" />)}
              {person.days.map((d) => {
                const clickable = d.sessions.length > 0 || d.kind === 'holiday' || d.kind === 'absent'
                const inner = (
                  <>
                    <span className="tc-day__n">{d.day}</span>
                    <span className="tc-day__v">{d.text || (isFutureHoliday(d) ? 'F' : '')}</span>
                    {(d.flagged || d.autoInfo || d.unbroken || d.docked) && (
                      <span className="mday-dots" aria-hidden="true">
                        {d.flagged && <i className="m-look" />}
                        {d.autoInfo && <i className="m-auto" />}
                        {d.unbroken && <i className="m-ring" />}
                        {d.docked && <i className="m-docked" />}
                      </span>
                    )}
                  </>
                )
                return clickable ? (
                  <button key={d.day} type="button" className={cellClass(d)} aria-pressed={day?.day === d.day} aria-label={`${fmtDayShort(d.date)}${d.text ? `, ${d.text}` : ''}`} onClick={() => setPickedDay({ emp: person.emp.id, day: d.day })}>{inner}</button>
                ) : (
                  <div key={d.day} className={cellClass(d)} style={{ cursor: 'default' }}>{inner}</div>
                )
              })}
            </div>

            <div className="month-legend caption">
              <span><i className="month-dot" style={{ background: 'var(--attention)' }} />Needs a look</span>
              <span><i className="month-dot" style={{ background: 'var(--brand)' }} />Earlier session closed with no photo</span>
              <span><i className="month-dot month-dot--ring" />One session, no lunch punch</span>
              <span><i className="month-dot" style={{ background: 'var(--alert)' }} />Holiday marked unpaid</span>
              <span><b className="time">!</b>Still open</span>
            </div>

            {day && <DayCard person={person} day={day} today={today} now={now} actions={actions} />}
          </section>
        )}
      </div>
    </>
  )
}

function DayCard({ person, day, today, now, actions }: { person: PersonMonth; day: MonthDay; today: string; now: Date; actions: AttendanceActions }) {
  const { emp } = person
  const since = emp.created_at ? dateKey(new Date(emp.created_at)) : undefined
  const model = (
    day.sessions.length
      ? dayModel({ sessions: day.sessions, date: day.date, today, now, overtimeHours: day.overtime })
      : emptyDayModel({ date: day.date, today, weekday: new Date(`${day.date}T12:00:00`).getDay(), employeeSince: since, now, docked: day.docked })
  ) as unknown as DayModel | null
  if (!model) return null
  const c = model.callout
  const [lead, rest] = c ? calloutText(model, emp.name, day.date) : ['', '']
  const tone = c?.tone
  const calloutClass = tone && CALLOUT[tone] ? ` tc-callout--${CALLOUT[tone]}` : ''
  const stampText = c ? calloutStamp(c.id) : model.chip ? model.chip.text : null
  const stampTone = c?.tone ?? model.chip?.tone

  return (
    <div className={`tc-callout${calloutClass}`} style={tone === 'violet' ? { background: 'var(--holiday-tint)' } : undefined}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span className="body-strong">{fmtDayShort(day.date)}</span>
        {stampText && stampTone && <span className={`tc-stamp tc-stamp--${STAMP[stampTone]}`}>{stampText}</span>}
      </div>
      {c ? (
        <p><b>{lead}</b> {rest}</p>
      ) : model.paidTotal !== null ? (
        <p>{fmtHours(model.paidTotal)} paid.</p>
      ) : null}
      {model.sessions.map((s) => (
        <div key={s.record.id} className="month-sess" style={{ alignSelf: 'stretch' }}>
          <span className="time">{fmtTime(s.record.clock_in)} → {s.record.clock_out ? fmtTime(s.record.clock_out) : 'still in'}</span>
          <span className="time app-muted">{s.paid !== null ? `${fmtHours(s.paid)} paid` : ''}</span>
        </div>
      ))}
      {day.overtime > 0 && (
        <div className="month-sess" style={{ alignSelf: 'stretch' }}><span>Overtime</span><span className="time app-muted">{fmtHours(day.overtime)} paid</span></div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        {day.kind === 'absent' && <button type="button" className="tc-btn tc-btn--primary" onClick={() => actions.addMissedPunch(person, day.date)}>Add missed punch</button>}
        {day.kind === 'holiday' && <button type="button" className="tc-btn tc-btn--secondary" onClick={() => actions.toggleHoliday(person, day.date, day.docked)}>{day.docked ? 'Restore as paid' : 'Mark unpaid'}</button>}
        {(day.sessions.length > 0 || day.kind === 'holiday') && <button type="button" className="tc-btn tc-btn--secondary" onClick={() => actions.openInDays(day.date, emp.id)}>Open in Days</button>}
      </div>
    </div>
  )
}
