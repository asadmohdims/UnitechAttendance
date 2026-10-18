import { useState } from 'react'
import { isAutoClosedSession } from '@legacy/autoClosed.js'
import { paidPunchTime } from '@legacy/rounding.js'
import { usePhotoUrl } from '../../data/usePhotoUrl'
import { fmtHours, fmtTime, initials } from '../../format'
import { calloutStamp, calloutText, fmtDayShort, fmtDateTime, fmtGap, ownerLine } from '../dayText'
import type { CalloutAction, DayEntry, SessionView } from '../types'
import { PhotoSlot } from './PhotoSlot'
import { Timeline } from './Timeline'

export interface PersonActions {
  runAction: (a: CalloutAction, entry: DayEntry) => void
  toggleLunch: (session: SessionView) => void
  addOvertime: (entry: DayEntry) => void
  editSession: (session: SessionView, entry: DayEntry) => void
  sessionMenu: (session: SessionView, entry: DayEntry) => void
  editOvertime: (entry: DayEntry) => void
  removeOvertime: (entry: DayEntry) => void
}

const STAMP_BY_TONE = { amber: 'attention', green: 'in', pink: 'neutral', blue: 'owner', yellow: 'neutral', grey: 'neutral', red: 'alert', violet: 'holiday' } as const
const CALLOUT_BY_TONE = { amber: 'attention', red: 'alert', blue: 'owner', green: 'in', violet: 'holiday', pink: '', yellow: '', grey: '' } as const

function EndCaption({ view, side }: { view: SessionView; side: 'in' | 'out' }) {
  const r = view.record
  const iso = side === 'in' ? r.clock_in : r.clock_out
  const type = view.slots[side]
  if (type === 'not-yet') return <span className="time app-muted">—</span>
  if (type === 'auto') return <span className="time" style={{ color: 'var(--attention-ink)' }}>no tap</span>
  if (!iso) return <span className="time app-muted">—</span>
  const flagged = side === 'in' && view.flagIn
  const mine = view.mine[side]
  const counted = side === 'out' ? view.countedOut : iso
  const paid = paidPunchTime(iso, counted) as Date | null
  const orig = side === 'in' ? view.mine.wasIn : view.mine.wasOut
  let editLine: React.ReactNode = null
  if (mine) {
    if (view.mine.added) editLine = 'added by you'
    else if (!orig) editLine = 'kiosk had no clock-out'
    else if (side === 'out' && isAutoClosedSession({ ...r, clock_out: orig })) editLine = `kiosk closed it automatically ${fmtTime(orig)}`
    else editLine = <>kiosk recorded <s>{fmtTime(orig)}</s></>
  }
  return (
    <>
      <span className="time" style={mine ? { color: 'var(--brand-ink)' } : flagged ? { color: 'var(--attention-ink)' } : undefined} title={mine ? 'Set by you, not by the kiosk' : undefined}>
        {mine && <span aria-hidden="true">✎ </span>}
        {fmtTime(iso)}
      </span>
      {paid && <span className="caption app-muted">counts as {fmtTime(paid)}</span>}
      {flagged && <span className="caption" style={{ color: 'var(--attention-ink)' }}>after closing</span>}
      {editLine && <span className="caption" style={{ color: 'var(--brand-ink)' }}>{editLine}</span>}
    </>
  )
}

interface Props {
  entry: DayEntry
  date: string
  now: Date
  actions: PersonActions
  onOpenPhoto: (url: string, caption: string) => void
  /** Phone only: back to the day's list. Hidden from 900px up, where the list stays beside the person. */
  onBack: () => void
}

export function PersonDay({ entry, date, now, actions, onOpenPhoto, onBack }: Props) {
  const { emp, model, overtimeHours } = entry
  const avatar = usePhotoUrl(emp.avatar)
  const [broken, setBroken] = useState<string | null>(null)
  const c = model.callout
  const [lead, rest] = c ? calloutText(model, emp.name, date) : ['', '']
  const anyOpen = model.sessions.some((s) => s.record.clock_out === null)
  const rounded = model.sessions.some((v) => {
    if (v.paid === null || !v.record.clock_out) return false
    const exact = (new Date(v.record.clock_out).getTime() - new Date(v.record.clock_in).getTime()) / 3600000
    return Math.abs(v.paid - exact) > 0.001
  })
  const owner = (model.ownerPunchCount ?? 0) > 0
  const footnote = [
    rounded ? 'Pay counts each punch to the nearest quarter hour, with up to 10 minutes of grace.' : '',
    owner ? 'Times marked ✎ were set by you; the rest are what the kiosk recorded.' : rounded ? 'The exact times above are what the kiosk recorded.' : '',
  ].filter(Boolean).join(' ')

  return (
    <section className="day-detail" aria-label={`${emp.name}, ${fmtDayShort(date)}`}>
      <button type="button" className="tc-btn tc-btn--quiet day-back" onClick={onBack}>‹ Days</button>
      <div className="day-detail__head">
        <span className="tc-avatar" style={{ overflow: 'hidden', padding: 0 }}>
          {avatar && broken !== avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setBroken(avatar)} /> : <span aria-hidden="true">{initials(emp.name)}</span>}
        </span>
        <div style={{ flex: 1 }}>
          <div className="caption app-muted">{`${fmtDayShort(date).replace(' ', ', ')} ${date.slice(0, 4)}`}</div>
          <h2 className="title-2" style={{ margin: 0 }}>{emp.name}</h2>
          {owner && <div className="caption" style={{ color: 'var(--brand-ink)', marginTop: 2 }}><span aria-hidden="true">✎ </span>{ownerLine(model.ownerPunchCount!, model.punchCount!)}</div>}
        </div>
        {model.kind === 'worked' && !overtimeHours && <button type="button" className="tc-btn tc-btn--secondary" onClick={() => actions.addOvertime(entry)}>Add overtime</button>}
      </div>

      {c && (
        <div className={`tc-callout${CALLOUT_BY_TONE[c.tone] ? ` tc-callout--${CALLOUT_BY_TONE[c.tone]}` : ''}`} style={c.tone === 'violet' ? { background: 'var(--holiday-tint)' } : undefined}>
          <span className={`tc-stamp tc-stamp--${STAMP_BY_TONE[c.tone]}`}>{calloutStamp(c.id)}</span>
          <p><b>{lead}</b> {rest}</p>
          {c.actions.map((a) => (
            <button key={`${a.id}-${a.index ?? ''}`} type="button" className={`tc-btn ${a.primary ? 'tc-btn--primary' : 'tc-btn--secondary'}`} onClick={() => actions.runAction(a, entry)}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {model.kind === 'empty' ? (
        <p className="body app-muted">No sessions to show.</p>
      ) : (
        <>
          <div className="day-detail__strip">
            <div><div className="lab">{anyOpen ? 'Paid so far' : 'Paid today'}</div><div className="time-large">{model.paidTotal === null ? '—' : fmtHours(model.paidTotal)}</div></div>
            <div><div className="lab">{model.sessions.length === 1 ? 'Session' : 'Sessions'}</div><div className="time-large">{model.sessions.length}</div></div>
            <div><div className="lab">{model.lunch ? (model.lunch.paid ? 'Lunch, paid as work' : 'Lunch, unpaid') : 'Lunch'}</div><div className="time-large">{model.lunch ? fmtGap(model.lunch.hours).replace(' min', 'm').replace(' hr ', 'h ').replace(' hr', 'h') : '—'}</div></div>
          </div>

          <Timeline sessions={model.sessions} now={now} />

          <div className="day-detail__sessions">
            {model.sessions.map((s, i) => {
              const prev = model.sessions[i - 1]
              const gapHours = prev?.record.clock_out ? (new Date(s.record.clock_in).getTime() - new Date(prev.record.clock_out).getTime()) / 3600000 : null
              return (
                <div key={s.record.id} className="day-detail__block">
                  {prev && gapHours !== null && gapHours < 0 && (
                    <div className="gap gap--warn"><span><b>Overlap {fmtGap(-gapHours)}</b> · both sessions are paid for this time</span></div>
                  )}
                  {prev && gapHours !== null && gapHours >= 0 && (
                    <div className="gap">
                      <span className="caption app-muted">
                        {model.lunch?.index === i ? 'Lunch' : 'Break'} <b>{fmtGap(gapHours)}</b>{prev.record.lunch_paid ? ' · paid as work ✓' : ' · not paid'}
                      </span>
                      <button type="button" className="tc-btn tc-btn--quiet" onClick={() => actions.toggleLunch(prev)}>{prev.record.lunch_paid ? 'Undo' : 'Pay as work'}</button>
                    </div>
                  )}
                  <div className={`sess${s.edited ? ' sess--edited' : ''}`}>
                    <div className="sess__head">
                      <span className="heading">{model.sessions.length === 1 ? s.label[0] + s.label.slice(1).toLowerCase() : s.label.replace(/^SESSION (\d+) · (\w)(\w+)$/, (_m, n: string, a: string, b: string) => `Session ${n} · ${a}${b.toLowerCase()}`)}</span>
                      <span style={{ flex: 1 }} />
                      {s.edited && s.record.edited_at && <span className="tc-stamp tc-stamp--owner">Edited {fmtDateTime(s.record.edited_at)}</span>}
                      <button type="button" className="tc-btn tc-btn--quiet" onClick={() => actions.editSession(s, entry)}>Edit</button>
                      <button type="button" className="tc-btn tc-btn--quiet" aria-label="More for this session" onClick={() => actions.sessionMenu(s, entry)}>⋯</button>
                    </div>
                    <div className="sess__body">
                      <div className="end">
                        <span className="lab">Clocked in</span>
                        <PhotoSlot type={s.slots.in} path={s.record.in_photo} side="in" clockOut={null} onOpen={(u) => onOpenPhoto(u, `Clocked in ${fmtTime(s.record.clock_in)}`)} />
                        <EndCaption view={s} side="in" />
                      </div>
                      <div className="mid">
                        {s.paid !== null ? (
                          <><span className={`time-large${s.paid === 0 ? ' app-muted' : ''}`}>{fmtHours(s.paid)}</span><span className="lab">{s.slots.out === 'auto' ? 'Paid to closing' : 'Paid'}</span></>
                        ) : s.soFar !== null ? (
                          <><span className="time-large app-muted">{fmtHours(s.soFar)}</span><span className="lab">So far</span></>
                        ) : (
                          <><span className="time-large app-muted">—</span><span className="lab">Not counted</span></>
                        )}
                      </div>
                      <div className="end end--r">
                        <span className="lab">Clocked out</span>
                        <PhotoSlot type={s.slots.out} path={s.record.out_photo} side="out" clockOut={s.record.clock_out} onOpen={(u) => onOpenPhoto(u, `Clocked out ${s.record.clock_out ? fmtTime(s.record.clock_out) : ''}`)} />
                        <EndCaption view={s} side="out" />
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {overtimeHours > 0 && (
            <div className="day-detail__overtime">
              <span><b>Overtime {fmtHours(overtimeHours)}</b> <span className="caption app-muted">added by you, paid at the normal hourly rate</span></span>
              <span>
                <button type="button" className="tc-btn tc-btn--quiet" onClick={() => actions.editOvertime(entry)}>Edit</button>
                <button type="button" className="tc-btn tc-btn--quiet" style={{ color: 'var(--alert-ink)' }} onClick={() => actions.removeOvertime(entry)}>Remove</button>
              </span>
            </div>
          )}
          {footnote && <div className="caption app-muted">{footnote}</div>}
        </>
      )}
    </section>
  )
}
