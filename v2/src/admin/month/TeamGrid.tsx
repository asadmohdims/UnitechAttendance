import { useEffect, useRef } from 'react'
import { fmtHours } from '../../format'
import { Avatar } from '../../ui/Avatar'
import { fmtDayShort } from '../dayText'
import { dayBase, dayText } from './dayCell'
import type { MonthModel, PersonMonth } from './monthModel'

const DOW = 'SMTWTFS'

interface Props {
  model: MonthModel
  /** `empId:date` of every day on the one attention list; those get the "!" mark. */
  attention: Set<string>
  /** A name was tapped: open that person in the one-person view. */
  onPick: (empId: string) => void
  /** A day was tapped: go straight to that person's day in Days. */
  onOpenDay: (date: string, empId: string) => void
}

/** What sits under a name: days off, then the review state, so the owner sees who still needs a look. */
function sub(p: PersonMonth, attention: Set<string>): { text: string; tone: 'look' | 'done' | 'plain' } {
  const toReview = p.days.filter((d) => attention.has(`${p.emp.id}:${d.date}`)).length
  const reviewed = p.days.filter((d) => d.reviewed && !attention.has(`${p.emp.id}:${d.date}`)).length
  const off = p.absentEq > 0 ? `${p.absentEq} ${p.absentEq === 1 ? 'day' : 'days'} off` : ''
  if (toReview) return { text: [off, `● ${toReview} to review`].filter(Boolean).join(' · '), tone: 'look' }
  if (reviewed) return { text: [off, '✓ reviewed'].filter(Boolean).join(' · '), tone: 'done' }
  return { text: off, tone: 'plain' }
}

/** Everyone, every day: the v1 calendar, rebuilt from the same per-person days the one-person view uses. */
export function TeamGrid({ model, attention, onPick, onOpenDay }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  // Open scrolled so today is in view; the name and total columns are pinned and stay put.
  useEffect(() => {
    const el = scroller.current
    const today = el?.querySelector<HTMLElement>('[data-today]')
    if (el && today) el.scrollLeft = Math.max(0, today.offsetLeft - el.clientWidth / 2)
  }, [model.ym])

  const first = model.people[0]
  return (
    <div className="tg" ref={scroller}>
      <table className="tg__table">
        <caption className="tg__caption">Attendance by person and day, {model.ym}</caption>
        <thead>
          <tr>
            <th scope="col" className="tg__name tg__head">Employee</th>
            {first?.days.map((d) => (
              <th key={d.day} scope="col" className="tg__head tg__dayhead" data-today={d.isToday ? '' : undefined} aria-current={d.isToday ? 'date' : undefined}>
                <span className={`tg__n${d.isToday ? ' tg__n--today' : ''}${dayBase(d) === 'holiday' ? ' tg__n--holiday' : ''}`}>{d.day}</span>
                <span className="tg__dow">{DOW[new Date(`${d.date}T12:00:00`).getDay()]}</span>
              </th>
            ))}
            <th scope="col" className="tg__head tg__tot tg__tot--days">Days</th>
            <th scope="col" className="tg__head tg__tot tg__tot--abs">Absent</th>
            <th scope="col" className="tg__head tg__tot tg__tot--hrs">Total hrs</th>
          </tr>
        </thead>
        <tbody>
          {model.people.map((p) => {
            const s = sub(p, attention)
            return (
              <tr key={p.emp.id}>
                <th scope="row" className="tg__name">
                  <button type="button" className="tg__who" onClick={() => onPick(p.emp.id)}>
                    <Avatar emp={p.emp} />
                    <span className="tg__who-text">
                      <span className="tg__who-name">{p.emp.name}</span>
                      <span className={`tg__who-sub tg__who-sub--${s.tone}`}>{s.text || ' '}</span>
                    </span>
                  </button>
                </th>
                {p.days.map((d) => {
                  const clickable = d.sessions.length > 0 || d.kind === 'holiday' || d.kind === 'absent'
                  const cls = `tg__cell tg__cell--${dayBase(d)}${d.isToday ? ' tg__cell--today' : ''}`
                  const look = attention.has(`${p.emp.id}:${d.date}`)
                  const mark = look ? '!' : d.reviewed ? '✓' : ''
                  const text = dayText(d)
                  const label = `${p.emp.name}, ${fmtDayShort(d.date)}${text ? `, ${text}` : ''}${look ? ', needs review' : d.reviewed ? ', reviewed' : ''}`
                  const inner = (
                    <>
                      {text}
                      {mark && <b className={`tg__mark tg__mark--${look ? 'look' : 'done'}`} aria-hidden="true">{mark}</b>}
                    </>
                  )
                  return (
                    <td key={d.day} className="tg__slot">
                      {clickable ? (
                        <button type="button" className={cls} aria-label={label} onClick={() => onOpenDay(d.date, p.emp.id)}>{inner}</button>
                      ) : (
                        <span className={cls}>{inner}</span>
                      )}
                    </td>
                  )
                })}
                <td className="tg__tot tg__tot--days time">{p.daysWorked}</td>
                <td className={`tg__tot tg__tot--abs time${p.absentEq ? ' tg__tot--alert' : ''}`}>{p.absentEq}</td>
                <td className="tg__tot tg__tot--hrs time">{fmtHours(p.exactTotal)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
