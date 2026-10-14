import { useCallback, useEffect, useMemo, useState } from 'react'
import { queryCache } from '../../data/queryCache'
import { store } from '../../data/store'
import { useCachedQuery } from '../../data/useCachedQuery'
import { usePhotoUrl } from '../../data/usePhotoUrl'
import type { DayPayOverride, Employee, OvertimeRow, RecordRow } from '../../data/types'
import { dateKey, fmtHours, initials } from '../../format'
import { NOT_BUILT } from '../../ui/useToast'
import { useNow } from '../../kiosk/useNow'
import { buildAttentionQueue, buildDayEntries } from '../dayEntries'
import { calloutStamp, chipText, fmtDayShort } from '../dayText'
import { defaultLunchWindow, MIN_SPLITTABLE_MS } from '../lunchSplit'
import type { CalloutAction, DayEntry, SessionView, Tone } from '../types'
import { PeriodControl } from './PeriodControl'
import { PersonDay, type PersonActions } from './PersonDay'

const STAMP: Record<Tone, string> = { amber: 'attention', green: 'in', pink: 'neutral', blue: 'owner', yellow: 'neutral', grey: 'neutral', red: 'alert', violet: 'holiday' }

function Avatar({ emp }: { emp: Employee }) {
  const url = usePhotoUrl(emp.avatar)
  const [broken, setBroken] = useState<string | null>(null)
  return (
    <span className="tc-avatar" style={{ overflow: 'hidden', padding: 0 }}>
      {url && broken !== url ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setBroken(url)} /> : <span aria-hidden="true">{initials(emp.name)}</span>}
    </span>
  )
}

function monthBounds(date: string, today: string) {
  const [y, m] = date.split('-').map(Number)
  const last = new Date(y, m, 0)
  const end = dateKey(last) > today ? today : dateKey(last)
  return { ym: date.slice(0, 7), start: `${date.slice(0, 7)}-01`, end }
}

interface Props {
  onNotice: (msg: string) => void
  /** A day to open on (from a link such as #/admin/days/2026-10-12). Defaults to today. */
  initialDate?: string
  /** Injected in tests. */
  nowOverride?: Date
}

export function DaysScreen({ onNotice, initialDate, nowOverride }: Props) {
  const tick = useNow(30000)
  const now = nowOverride ?? tick
  const today = dateKey(now)
  const [date, setDateState] = useState(initialDate ?? today)
  // Keeps the address in step with the day shown, so a reload or a copied link lands on the same day.
  const setDate = useCallback((d: string) => {
    setDateState(d)
    window.history.replaceState(null, '', `#/admin/days/${d}`)
  }, [])
  const [selected, setSelected] = useState<string | null>(null)
  const [viewer, setViewer] = useState<{ url: string; caption: string } | null>(null)

  const employeesQ = useCachedQuery<Employee[]>('employees', () => store.listEmployees())
  const recordsQ = useCachedQuery<RecordRow[]>(`records:${date}`, () => store.listRecordsForDate(date))
  // These two are best-effort: a project that has not run the migration, or a flaky read, must
  // not take the rest of the day down with it.
  const overtimeQ = useCachedQuery<OvertimeRow[]>(`overtime:${date}`, () => store.listOvertimeForRange(date, date).catch(() => []))
  const overridesQ = useCachedQuery<DayPayOverride[]>(`overrides:${date}`, () => store.listDayPayOverrides(date, date).catch(() => []))
  const month = monthBounds(date, today)
  const monthQ = useCachedQuery<RecordRow[]>(`month:${month.ym}:${month.end}`, () => store.listRecordsForRange(month.start, month.end))
  const monthOvertimeQ = useCachedQuery<OvertimeRow[]>(`overtime:${month.ym}:${month.end}`, () => store.listOvertimeForRange(month.start, month.end).catch(() => []))

  const employees = employeesQ.data ?? []
  const entries = useMemo(
    () => buildDayEntries({ employees, records: recordsQ.data ?? [], overtime: overtimeQ.data ?? [], overrides: overridesQ.data ?? [], date, now }),
    [employees, recordsQ.data, overtimeQ.data, overridesQ.data, date, now],
  )
  const queue = useMemo(() => buildAttentionQueue(employees, monthQ.data ?? [], monthOvertimeQ.data ?? [], now), [employees, monthQ.data, monthOvertimeQ.data, now])

  // Open on the first item in the queue that belongs to this day, else the first that needs a look.
  const queuedForDay = queue.find((q) => q.date === date)
  const current =
    entries.find((e) => e.emp.id === selected) ??
    entries.find((e) => e.emp.id === queuedForDay?.emp.id) ??
    entries.find((e) => e.model.needsLook) ??
    entries[0]
  const needs = entries.filter((e) => e.model.needsLook)
  const rest = entries.filter((e) => !e.model.needsLook)
  const stillIn = entries.filter((e) => e.model.chip?.id === 'still-in').length
  const withEdits = entries.filter((e) => (e.model.ownerPunchCount ?? 0) > 0).length

  // Re-read the day after a write; the legacy store merges what this tablet has not synced yet.
  const reload = useCallback(async () => {
    await Promise.all([recordsQ.refetch(), overridesQ.refetch(), overtimeQ.refetch(), monthQ.refetch()])
  }, [recordsQ, overridesQ, overtimeQ, monthQ])

  const attempt = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn()
        await reload()
      } catch (err) {
        onNotice(`Failed: ${(err as Error).message}`)
      }
    },
    [reload, onNotice],
  )

  const actions: PersonActions = {
    toggleLunch: (gapSession: SessionView) => void attempt(() => store.setLunchPaid(gapSession.record.id, !gapSession.record.lunch_paid)),
    runAction: (a: CalloutAction, entry: DayEntry) => {
      const session = a.index != null ? entry.model.sessions[a.index] : null
      if (a.id === 'toggle-holiday') {
        const docked = !!entry.model.callout?.params.docked
        return void attempt(() => store.setDayOverride(entry.emp.id, date, docked))
      }
      if (a.id === 'split' && session) {
        const { clock_in, clock_out, id } = session.record
        if (!clock_out || new Date(clock_out).getTime() - new Date(clock_in).getTime() < MIN_SPLITTABLE_MS) {
          return onNotice('This session is too short to split off a 1-hour lunch.')
        }
        const { start, end } = defaultLunchWindow(new Date(clock_in), new Date(clock_out))
        return void attempt(() => store.splitSessionForLunch(id, start.toISOString(), end.toISOString()))
      }
      if (a.id === 'delete-session') return onNotice(NOT_BUILT('Deleting a session'))
      if (a.id === 'add-punch') return onNotice(NOT_BUILT('Adding a missed punch'))
      return onNotice(NOT_BUILT('Editing a session'))
    },
    addOvertime: () => onNotice(NOT_BUILT('Overtime')),
    editOvertime: () => onNotice(NOT_BUILT('Overtime')),
    removeOvertime: () => onNotice(NOT_BUILT('Overtime')),
    editSession: () => onNotice(NOT_BUILT('Editing a session')),
    sessionMenu: () => onNotice(NOT_BUILT('The session menu')),
  }

  useEffect(() => {
    if (!viewer) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setViewer(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewer])

  const stamp = (e: DayEntry) =>
    e.model.chip ? (
      <span className={`tc-stamp tc-stamp--${STAMP[e.model.chip.tone]}`}>
        {e.model.chip.id === 'still-in' && <span className="tc-stamp__dot" />}
        {chipText(e.model.chip.id, e.model.chip.text)}
      </span>
    ) : null

  const row = (e: DayEntry) => (
    <button key={e.emp.id} type="button" className="tc-queue__row days-row" aria-pressed={current?.emp.id === e.emp.id} onClick={() => setSelected(e.emp.id)}>
      <Avatar emp={e.emp} />
      <span className="tc-queue__title">{e.emp.name}</span>
      <span>{stamp(e)}</span>
      <span className="time days-row__paid">
        {(e.model.ownerPunchCount ?? 0) > 0 && <span aria-label="includes times you set" title="You set or changed a punch on this day">✎ </span>}
        {e.model.paidTotal === null ? '—' : fmtHours(e.model.paidTotal)}
      </span>
    </button>
  )

  return (
    <div className="days">
      <header className="days__header">
        <div>
          <h1 className="title-1" style={{ margin: 0 }}>Days</h1>
          <div className="body app-muted">Tap the date to pick any day</div>
        </div>
        <PeriodControl date={date} today={today} onChange={(d) => { setDate(d); setSelected(null) }} />
      </header>

      <div className="days__cols">
        <section className="days__left">
          <div className="days__block">
            <div className="days__blockhead">
              <h2 className="heading" style={{ margin: 0 }}>Needs attention</h2>
              <span className="caption app-muted">{queue.length} across the month</span>
            </div>
            {queue.length === 0 ? (
              <p className="body app-muted days__empty">Nothing needs a look this month.</p>
            ) : (
              <div className="tc-queue" role="list">
                {queue.map((q) => (
                  <button
                    key={`${q.date}-${q.emp.id}`}
                    type="button"
                    role="listitem"
                    className="tc-queue__row days-queue"
                    aria-pressed={q.date === date && current?.emp.id === q.emp.id}
                    onClick={() => { setDate(q.date); setSelected(q.emp.id) }}
                  >
                    <Avatar emp={q.emp} />
                    <div>
                      <div className="tc-queue__title">{q.emp.name}</div>
                      <div className="tc-queue__sub">{fmtDayShort(q.date)}</div>
                      <div style={{ marginTop: 6 }}><span className="tc-stamp tc-stamp--attention">{calloutStamp(q.chipId)}</span></div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="days__block">
            <h2 className="heading" style={{ margin: 0 }}>{fmtDayShort(date)}</h2>
            <p className="body app-muted" style={{ margin: 0 }}>
              <b style={{ color: 'var(--ink)' }}>{entries.length}</b> {entries.length === 1 ? 'person' : 'people'}
              {needs.length > 0 && <> · <b style={{ color: 'var(--attention-ink)' }}>{needs.length}</b> need a look</>}
              {stillIn > 0 && <> · <b style={{ color: 'var(--ink)' }}>{stillIn}</b> still in</>}
              {withEdits > 0 && <> · <span style={{ color: 'var(--brand-ink)' }}>✎ <b>{withEdits}</b> with your edits</span></>}
            </p>
            {entries.length === 0 && <p className="body app-muted days__empty">No one to show for this day.</p>}
            {needs.length > 0 && (
              <>
                <div className="stamp app-muted" style={{ textTransform: 'uppercase' }}>Needs a look</div>
                <div className="tc-queue" role="list">{needs.map(row)}</div>
              </>
            )}
            {rest.length > 0 && (
              <>
                <div className="stamp app-muted" style={{ textTransform: 'uppercase' }}>{needs.length > 0 ? 'Everyone else' : 'Everyone'}</div>
                <div className="tc-queue" role="list">{rest.map(row)}</div>
              </>
            )}
          </div>
        </section>

        {current ? (
          <PersonDay entry={current} date={date} now={now} actions={actions} onOpenPhoto={(url, caption) => setViewer({ url, caption })} />
        ) : (
          <div className="days__none body app-muted">Pick a person to see their day.</div>
        )}
      </div>

      {viewer && (
        <div className="tc-viewer photo-viewer" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setViewer(null)}>
          <img className="tc-viewer__img" src={viewer.url} alt={viewer.caption} />
          <div className="tc-viewer__cap">{viewer.caption}</div>
          <button type="button" className="tc-btn tc-btn--secondary" onClick={() => setViewer(null)}>Close</button>
        </div>
      )}
    </div>
  )
}

// Exposed so a later write elsewhere (the kiosk punch) shows up here without waiting for the refetch.
export const dayRecordsKey = (date: string) => `records:${date}`
export { queryCache }
