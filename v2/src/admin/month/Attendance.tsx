import { useMemo, useState } from 'react'
import { dayModel, emptyDayModel } from '@legacy/dayStatus.js'
import type { RecordRow } from '../../data/types'
import { dateKey, fmtHours, fmtTime } from '../../format'
import { Avatar } from '../../ui/Avatar'
import { useMinWidth } from '../../ui/useMinWidth'
import { buildAttentionQueue, type QueueItem } from '../dayEntries'
import { withReview } from '../review'
import { calloutStamp, calloutText, fmtDayShort } from '../dayText'
import type { DayModel } from '../types'
import { dayBase, dayText } from './dayCell'
import { statsFor, type MonthDay, type MonthModel, type PersonMonth } from './monthModel'
import { TeamGrid } from './TeamGrid'

const STAMP = { amber: 'attention', green: 'in', pink: 'neutral', blue: 'owner', yellow: 'neutral', grey: 'neutral', red: 'alert', violet: 'holiday' } as const
const CALLOUT = { amber: 'attention', red: 'alert', blue: 'owner', green: 'in', violet: 'holiday', pink: '', yellow: '', grey: '' } as const
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const stripColor = (d: MonthDay) =>
  d.kind === 'worked' ? 'var(--in)' : d.kind === 'half' || d.kind === 'open' ? 'var(--attention)' : d.kind === 'absent' ? 'var(--alert)' : d.kind === 'holiday' ? 'var(--holiday)' : d.isFuture ? 'var(--sunken)' : 'var(--line)'

function strip(p: PersonMonth): string {
  const w = 100 / p.days.length
  return `linear-gradient(to right,${p.days.map((d, i) => `${stripColor(d)} ${(i * w).toFixed(2)}% ${((i + 1) * w).toFixed(2)}%`).join(',')})`
}

function cellClass(d: MonthDay): string {
  return ['tc-day', `tc-day--${dayBase(d)}`, d.isToday ? 'tc-day--today' : ''].filter(Boolean).join(' ')
}

export interface AttendanceActions {
  openInDays: (date: string, empId: string) => void
  addMissedPunch: (p: PersonMonth, date: string) => void
  toggleHoliday: (p: PersonMonth, date: string, docked: boolean) => void
  listDates: (p: PersonMonth) => void
  markReviewed: (p: PersonMonth, day: MonthDay) => void
}

interface Props {
  model: MonthModel
  records: RecordRow[]
  overtime: { emp_id: string; date: string; hours: number }[]
  now: Date
  currentYm: string
  actions: AttendanceActions
}

type View = 'team' | 'person'

/** The team grid needs width; below this the one-person view is the only one (as v1's phone view was). */
const GRID_MIN_WIDTH = 900

export function Attendance({ model, records, overtime, now, currentYm, actions }: Props) {
  const today = dateKey(now)
  const wide = useMinWidth(GRID_MIN_WIDTH)
  const [viewChoice, setView] = useState<View>('team')
  const view: View = wide ? viewChoice : 'person'
  const [pickedEmp, setPickedEmp] = useState<string | null>(null)
  const [pickedDay, setPickedDay] = useState<{ emp: string; day: number } | null>(null)

  const queue = useMemo(() => buildAttentionQueue(model.people.map((p) => p.emp), records, overtime, now), [model.people, records, overtime, now])
  // The one list: the banner, the tile and the marks on every calendar all read it.
  const attentionKeys = useMemo(() => new Set(queue.map((q) => `${q.emp.id}:${q.date}`)), [queue])
  const needsLook = (p: PersonMonth, d: MonthDay) => attentionKeys.has(`${p.emp.id}:${d.date}`)

  const person = model.people.find((p) => p.emp.id === pickedEmp) ?? model.people.find((p) => p.emp.id === queue[0]?.emp.id) ?? model.people[0]
  // Open on the first day of that person that needs a look, so the callout is already there.
  const defaultDay = person?.days.find((d) => needsLook(person, d) || d.kind === 'open')
  const day = pickedDay && person && pickedDay.emp === person.emp.id ? person.days[pickedDay.day - 1] : defaultDay

  if (!model.hasData) return <p className="days__empty body app-muted">No completed attendance for this month.</p>

  const scoped = view === 'person' && person ? person : null
  const stats = statsFor(model, scoped)

  // The banner follows the view: one person's entries, with the rest of the team counted quietly.
  const reviewRows = scoped ? queue.filter((q) => q.emp.id === scoped.emp.id) : queue
  const othersCount = queue.length - reviewRows.length
  const names = (id: QueueItem['chipId']) => [...new Set(reviewRows.filter((q) => q.chipId === id).map((q) => q.emp.name))]
  const notOut = names('needs-clock-out')
  const noPhoto = names('no-photo')
  const check = names('check-punches')
  const verb = (n: string[], one: string, many: string) => (n.length === 1 ? one : many)
  const parts = [
    notOut.length ? `${notOut.join(', ')} ${verb(notOut, 'has', 'have')} not clocked out yet` : '',
    noPhoto.length ? `${noPhoto.join(', ')} ${verb(noPhoto, 'has', 'have')} a day closed without a clock-out photo` : '',
    check.length ? `${check.join(', ')} ${verb(check, 'has', 'have')} punches to check` : '',
  ].filter(Boolean)
  const reviewCount = reviewRows.length
  const attention = reviewCount
  const first = reviewRows[0]
  const anyReviewed = model.people.some((p) => p.days.some((d) => d.reviewed))

  const isCurrent = model.ym === currentYm
  const pick = (empId: string, dayNumber: number | null) => {
    setPickedEmp(empId)
    setPickedDay(dayNumber === null ? null : { emp: empId, day: dayNumber })
    setView('person')
  }
  const scopeName = scoped ? scoped.emp.name : 'Whole team'

  return (
    <>
      {wide && (
        <div className="month-viewbar">
          <span className="caption app-muted">View</span>
          <div className="month-seg" role="group" aria-label="Attendance view">
            <button type="button" className="tc-btn tc-btn--quiet" aria-pressed={view === 'team'} onClick={() => setView('team')}>Whole team</button>
            <button type="button" className="tc-btn tc-btn--quiet" aria-pressed={view === 'person'} onClick={() => setView('person')}>One person</button>
          </div>
        </div>
      )}

      {reviewCount > 0 ? (
        <div className="tc-callout tc-callout--attention month-callout">
          <div style={{ minWidth: 240, flex: 1 }}>
            <span className="tc-stamp tc-stamp--attention">{reviewCount} {reviewCount === 1 ? 'entry needs' : 'entries need'} review</span>
            <p style={{ marginTop: 8 }}>
              {parts.join('. ')}.
              {othersCount > 0 && <span className="app-muted"> {othersCount} more {othersCount === 1 ? 'entry needs' : 'entries need'} review for other people.</span>}
            </p>
          </div>
          <button type="button" className="tc-btn tc-btn--primary" onClick={() => actions.openInDays(first.date, first.emp.id)}>Review entries</button>
        </div>
      ) : (
        anyReviewed && (
          <div className="tc-callout tc-callout--in month-callout" style={{ alignItems: 'center', justifyContent: 'flex-start', gap: 'var(--space-3)' }}>
            <span className="tc-stamp tc-stamp--in">All reviewed</span>
            <p>{scoped ? `Nothing left to review for ${scoped.emp.name}.` : `Nothing left to review in ${new Date(`${model.ym}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long' })}.`}</p>
          </div>
        )
      )}

      <div className="month-scope">
        <span className={`tc-stamp ${scoped ? 'tc-stamp--owner' : 'tc-stamp--neutral'}`}>{scopeName}</span>
        <span className="caption app-muted">{new Date(`${model.ym}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</span>
        {scoped && wide && <button type="button" className="tc-btn tc-btn--quiet month-scope__back" onClick={() => setView('team')}>‹ Back to whole team</button>}
      </div>
      <div className="month-stats">
        <div className="tc-stat"><span className="tc-stat__label">Hours recorded</span><span className="stat">{fmtHours(stats.hours)}</span><span className="tc-stat__sub">{scoped ? `${model.daysElapsed} days` : `${model.people.length} ${model.people.length === 1 ? 'person' : 'people'}, ${model.daysElapsed} days`}</span></div>
        <div className="tc-stat"><span className="tc-stat__label">Days worked</span><span className="stat">{stats.daysWorked}</span><span className="tc-stat__sub">of {stats.expectedDays}{isCurrent ? ' so far' : ''}</span></div>
        <div className="tc-stat"><span className="tc-stat__label">Absences</span><span className="stat" style={{ color: stats.absences ? 'var(--alert-ink)' : undefined }}>{stats.absences}</span><span className="tc-stat__sub">plus {stats.halfDays} half {stats.halfDays === 1 ? 'day' : 'days'}</span></div>
        <div className="tc-stat"><span className="tc-stat__label">Needs attention</span><span className="stat" style={{ color: attention ? 'var(--attention-ink)' : undefined }}>{attention}</span><span className="tc-stat__sub">open in Days</span></div>
      </div>

      {view === 'team' ? (
        <section className="month-team" aria-label="Whole team">
          <div className="month-team__head">
            <h2 className="heading" style={{ margin: 0 }}>Everyone, every day</h2>
            <span className="caption app-muted">Tap a name or a day to open that person. Scrolls sideways; names and totals stay put.</span>
          </div>
          <TeamGrid model={model} attention={attentionKeys} onPick={(id) => pick(id, null)} onOpenDay={actions.openInDays} />
          <div className="month-legend caption">
            <span><i className="month-dot" style={{ background: 'var(--in-tint)' }} />Full day</span>
            <span><i className="month-dot" style={{ background: 'var(--attention-tint)' }} />Half day</span>
            <span><i className="month-dot" style={{ background: 'var(--alert-wash)', border: '1.5px solid var(--alert)', boxSizing: 'border-box' }} />Absent</span>
            <span><i className="month-dot" style={{ background: 'var(--holiday-tint)' }} />Paid holiday</span>
            <span><b className="tg__mark tg__mark--look tg__mark--legend">!</b>Needs review</span>
            <span><b className="tg__mark tg__mark--done tg__mark--legend">✓</b>Reviewed (you set it)</span>
            <span><b className="time">In</b>Still clocked in</span>
          </div>
        </section>
      ) : (
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
                    <span className="tc-day__v">{dayText(d)}</span>
                    {d.reviewed && !needsLook(person, d) && <b className="tg__mark tg__mark--done tg__mark--cal" aria-hidden="true">✓</b>}
                    {(needsLook(person, d) || d.autoInfo || d.unbroken || d.docked) && (
                      <span className="mday-dots" aria-hidden="true">
                        {needsLook(person, d) && <i className="m-look" />}
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
              <span><b className="tg__mark tg__mark--done tg__mark--legend">✓</b>Reviewed (you set it)</span>
              <span><b className="time">!</b>Still open</span>
            </div>

            {day && <DayCard person={person} day={day} today={today} now={now} actions={actions} />}
          </section>
        )}
      </div>
      )}
    </>
  )
}

function DayCard({ person, day, today, now, actions }: { person: PersonMonth; day: MonthDay; today: string; now: Date; actions: AttendanceActions }) {
  const { emp } = person
  const since = emp.created_at ? dateKey(new Date(emp.created_at)) : undefined
  const model = withReview((
    day.sessions.length
      ? dayModel({ sessions: day.sessions, date: day.date, today, now, overtimeHours: day.overtime })
      : emptyDayModel({ date: day.date, today, weekday: new Date(`${day.date}T12:00:00`).getDay(), employeeSince: since, now, docked: day.docked })
  ) as unknown as DayModel | null, day.sessions)
  if (!model) return null
  const c = model.callout
  const [lead, rest] = c ? calloutText(model, emp.name, day.date) : ['', '']
  const tone = c?.tone
  const calloutClass = tone && CALLOUT[tone] ? ` tc-callout--${CALLOUT[tone]}` : ''
  const stampText = c ? calloutStamp(c.id) : day.reviewed ? 'Reviewed' : model.chip ? model.chip.text : null
  const stampTone = c?.tone ?? (day.reviewed ? 'blue' : model.chip?.tone)

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
        {c?.id === 'no-photo' && <button type="button" className="tc-btn tc-btn--primary" onClick={() => actions.markReviewed(person, day)}>Mark as reviewed</button>}
        {day.kind === 'absent' && <button type="button" className="tc-btn tc-btn--primary" onClick={() => actions.addMissedPunch(person, day.date)}>Add missed punch</button>}
        {day.kind === 'holiday' && <button type="button" className="tc-btn tc-btn--secondary" onClick={() => actions.toggleHoliday(person, day.date, day.docked)}>{day.docked ? 'Restore as paid' : 'Mark unpaid'}</button>}
        {(day.sessions.length > 0 || day.kind === 'holiday') && <button type="button" className="tc-btn tc-btn--secondary" onClick={() => actions.openInDays(day.date, emp.id)}>Open in Days</button>}
      </div>
    </div>
  )
}
