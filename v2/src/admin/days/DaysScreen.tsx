import { useCallback, useEffect, useMemo, useState } from 'react'
import { queryCache } from '../../data/queryCache'
import { store } from '../../data/store'
import { useCachedQuery } from '../../data/useCachedQuery'
import type { DayPayOverride, Employee, OvertimeRow, RecordRow } from '../../data/types'
import { dateKey, fmtHours, fmtTime } from '../../format'
import { Avatar } from '../../ui/Avatar'
import { refreshKioskData } from '../../data/invalidate'
import { useSheets } from '../../ui/Sheets'
import { useNow } from '../../kiosk/useNow'
import { buildAttentionQueue, buildDayEntries } from '../dayEntries'
import { buildLedger, paymentQueueItems } from '../month/paymentsModel'
import { revalidateMonthAttendance, usePaymentsMonth } from '../month/useMonthData'
import { WEEKLY_HOLIDAY_DAY } from '@legacy/config.js'
import { sessionEditForm, missedPunchForm, overtimeForm, confirmDeleteForm, markReviewedForm, markHolidayForm, removeHolidayForm } from '../forms'
import { declaredHolidays } from '../holidays'
import { calloutStamp, chipText, fmtDayShort, rowTimes } from '../dayText'
import { defaultLunchWindow, MIN_SPLITTABLE_MS } from '../lunchSplit'
import type { CalloutAction, DayEntry, SessionView, Tone } from '../types'
import { PeriodControl } from './PeriodControl'
import { PersonDay, type PersonActions } from './PersonDay'

const STAMP: Record<Tone, string> = { amber: 'attention', green: 'in', pink: 'neutral', blue: 'owner', yellow: 'neutral', grey: 'neutral', red: 'alert', violet: 'holiday' }

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
  /** A person to open on (from a link such as #/admin/days/2026-10-12/<employee id>). */
  initialEmp?: string
  /** Injected in tests. */
  nowOverride?: Date
}

export function DaysScreen({ onNotice, initialDate, initialEmp, nowOverride }: Props) {
  const sheets = useSheets()
  const tick = useNow(30000)
  const now = nowOverride ?? tick
  const today = dateKey(now)
  const [date, setDateState] = useState(initialDate ?? today)
  // Keeps the address in step with the day shown, so a reload or a copied link lands on the same day.
  const setDate = useCallback((d: string) => {
    setDateState(d)
    window.history.replaceState(null, '', `#/admin/days/${d}`)
  }, [])
  const [selected, setSelected] = useState<string | null>(initialEmp ?? null)
  // Phone: the list and one person's day are two screens. `opened` is true once a person was chosen on purpose.
  const [opened, setOpened] = useState(!!initialEmp)
  const open = (empId: string) => { setSelected(empId); setOpened(true) }
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
  // Payment mismatches join the queue: the Days board lists them beside the attendance items.
  const pay = usePaymentsMonth(month.ym)
  const queue = useMemo(() => {
    const attendance = buildAttentionQueue(employees, monthQ.data ?? [], monthOvertimeQ.data ?? [], now)
    const payments = pay.payments ? paymentQueueItems(buildLedger(pay.payments, pay.resolutions, employees)) : []
    return [...attendance, ...payments].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.emp.name.localeCompare(b.emp.name)))
  }, [employees, monthQ.data, monthOvertimeQ.data, now, pay.payments, pay.resolutions])

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
    await Promise.all([recordsQ.refetch(), overridesQ.refetch(), overtimeQ.refetch(), monthQ.refetch(), revalidateMonthAttendance(month.ym)])
  }, [recordsQ, overridesQ, overtimeQ, monthQ, month.ym])

  const attempt = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn()
        await reload()
        void refreshKioskData(now)
      } catch (err) {
        onNotice(`Failed: ${(err as Error).message}`)
      }
    },
    [reload, onNotice, now],
  )

  const editSession = async (session: SessionView, entry: DayEntry) => {
    const form = sessionEditForm(session.record, entry.emp.name)
    const v = await sheets.prompt(form.config)
    if (!v) return
    const times = form.resolve(v)
    if (!times || !times.changed) return onNotice('No changes to save.') // nothing moved: write nothing, keep the exact seconds
    await attempt(() => store.updateRecordTimes(session.record.id, times.inIso, times.outIso))
  }

  /** Confirms the times as they are: writes the edit marker without moving a punch. */
  const markReviewed = async (session: SessionView, entry: DayEntry) => {
    const { clock_in, clock_out, id } = session.record
    if (!clock_out) return
    const v = await sheets.prompt(markReviewedForm(entry.emp.name, fmtDayShort(date), fmtTime(clock_out)))
    if (!v) return
    await attempt(() => store.updateRecordTimes(id, clock_in, clock_out))
  }

  const addMissedPunch = async (entry: DayEntry) => {
    const form = missedPunchForm(date, entry.emp.name)
    const v = await sheets.prompt(form.config)
    if (!v) return
    const times = form.resolve(v)
    if (!times) return
    await attempt(() => store.addManualRecord(entry.emp.id, date, times.inIso, times.outIso).then(() => undefined))
  }

  const deleteSession = async (session: SessionView, entry: DayEntry) => {
    const v = await sheets.prompt(confirmDeleteForm(entry.emp.name))
    if (!v) return
    await attempt(() => store.deleteRecord(session.record))
  }

  const setOvertime = async (entry: DayEntry) => {
    const v = await sheets.prompt(overtimeForm(entry.emp.name, entry.overtimeHours))
    if (!v) return
    await attempt(() => store.setOvertimeHours(entry.emp.id, date, Number(v.hours)))
  }

  const splitSession = (session: SessionView) => {
    const { clock_in, clock_out, id } = session.record
    if (!clock_out || new Date(clock_out).getTime() - new Date(clock_in).getTime() < MIN_SPLITTABLE_MS) {
      return onNotice('This session is too short to split off a 1-hour lunch.')
    }
    const { start, end } = defaultLunchWindow(new Date(clock_in), new Date(clock_out))
    return void attempt(() => store.splitSessionForLunch(id, start.toISOString(), end.toISOString()))
  }

  // A paid holiday is a date every active person is paid a standard day for (see holidays.ts). Fridays already are one.
  const declaredHere = declaredHolidays(overridesQ.data ?? []).has(date)
  const canDeclare = date <= today && new Date(`${date}T12:00:00`).getDay() !== WEEKLY_HOLIDAY_DAY
  const markHoliday = async () => {
    const people = employees.filter((e) => e.active)
    const v = await sheets.prompt(markHolidayForm(fmtDayShort(date), people.length))
    if (!v) return
    await attempt(async () => { await Promise.all(people.map((e) => store.setDayOverride(e.id, date, true))) })
  }
  const removeHoliday = async () => {
    const v = await sheets.prompt(removeHolidayForm(fmtDayShort(date)))
    if (!v) return
    const rows = (overridesQ.data ?? []).filter((o) => o.date === date && o.paid)
    await attempt(async () => { await Promise.all(rows.map((o) => store.setDayOverride(o.emp_id, date, false))) })
  }

  const actions: PersonActions = {
    toggleLunch: (gapSession: SessionView) => void attempt(() => store.setLunchPaid(gapSession.record.id, !gapSession.record.lunch_paid)),
    runAction: (a: CalloutAction, entry: DayEntry) => {
      const session = a.index != null ? entry.model.sessions[a.index] : null
      if (a.id === 'toggle-holiday') {
        const docked = entry.model.holiday?.docked ?? !!entry.model.callout?.params.docked
        return void attempt(() => store.setDayOverride(entry.emp.id, date, docked))
      }
      if (a.id === 'split' && session) return splitSession(session)
      if (a.id === 'delete-session' && session) return void deleteSession(session, entry)
      if (a.id === 'add-punch') return void addMissedPunch(entry)
      if (a.id === 'mark-reviewed' && session) return void markReviewed(session, entry)
      if (session) return void editSession(session, entry)
    },
    addOvertime: (entry) => void setOvertime(entry),
    editOvertime: (entry) => void setOvertime(entry),
    removeOvertime: (entry) => void attempt(() => store.deleteOvertimeHours(entry.emp.id, date)),
    editSession: (session, entry) => void editSession(session, entry),
    sessionMenu: async (session, entry) => {
      const items: { label: string; danger?: boolean; run: () => void }[] = []
      if (entry.model.sessions.length === 1 && session.record.clock_out) items.push({ label: 'Split for lunch', run: () => splitSession(session) })
      items.push({ label: 'Delete session…', danger: true, run: () => void deleteSession(session, entry) })
      const i = await sheets.choose({ title: `${entry.emp.name}, ${session.label[0] + session.label.slice(1).toLowerCase()}`, items })
      if (i !== null) items[i].run()
    },
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

  const times = (e: DayEntry) => rowTimes(e.model)

  const row = (e: DayEntry) => (
    <button key={e.emp.id} type="button" className="tc-queue__row days-row" aria-pressed={current?.emp.id === e.emp.id} onClick={() => open(e.emp.id)}>
      <Avatar emp={e.emp} />
      <span className="days-row__who">
        <span className="tc-queue__title">{e.emp.name}</span>
        <span className={`days-row__times days-row__times--${times(e).tone}`}>{times(e).text}</span>
      </span>
      <span className="days-row__stamp">{stamp(e)}</span>
      <span className="time days-row__paid">
        {(e.model.ownerPunchCount ?? 0) > 0 && <span aria-label="includes times you set" title="You set or changed a punch on this day">✎ </span>}
        {e.model.paidTotal === null ? '—' : fmtHours(e.model.paidTotal)}
      </span>
    </button>
  )

  return (
    <div className={`days${opened ? ' days--detail' : ''}`}>
      <header className="days__header">
        <div>
          <h1 className="title-1" style={{ margin: 0 }}>Days</h1>
          <div className="body app-muted">Tap the date to pick any day</div>
        </div>
        <PeriodControl date={date} today={today} onChange={(d) => { setDate(d); setSelected(null) }} />
        {declaredHere ? (
          <button type="button" className="tc-btn tc-btn--quiet days__holiday" onClick={() => void removeHoliday()}>Remove the holiday</button>
        ) : canDeclare ? (
          <button type="button" className="tc-btn tc-btn--secondary days__holiday" onClick={() => void markHoliday()}>Mark as paid holiday</button>
        ) : null}
      </header>

      <div className="days__cols">
        <section className="days__left">
          <div className="days__block">
            <h2 className="heading" style={{ margin: 0 }}>{fmtDayShort(date)}</h2>
            <p className="body app-muted" style={{ margin: 0 }}>
              <b style={{ color: 'var(--ink)' }}>{entries.length}</b> {entries.length === 1 ? 'person' : 'people'}
              {needs.length > 0 && <> · <b style={{ color: 'var(--attention-ink)' }}>{needs.length}</b> need a look</>}
              {stillIn > 0 && <> · <b style={{ color: 'var(--ink)' }}>{stillIn}</b> still in</>}
              {withEdits > 0 && <> · <span style={{ color: 'var(--brand-ink)' }}>✎ <b>{withEdits}</b> with your edits</span></>}
            </p>
            {declaredHere && (
              <div className="tc-callout tc-callout--holiday" style={{ background: 'var(--holiday-tint)', border: '1.5px solid var(--holiday)' }}>
                <span className="tc-stamp tc-stamp--holiday">Paid holiday</span>
                <p><b>Everyone is paid 8:00 for today.</b> Hours worked are added on top. Take one person off it from their day.</p>
              </div>
            )}
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
                    onClick={() => { setDate(q.date); open(q.emp.id) }}
                  >
                    <Avatar emp={q.emp} />
                    <div>
                      <div className="tc-queue__title">{q.emp.name}</div>
                      <div className="tc-queue__sub">{fmtDayShort(q.date)}{q.sub ? ` · ${q.sub}` : ''}</div>
                      <div style={{ marginTop: 6 }}>
                        {q.chipId === 'payment-mismatch' ? <span className="tc-stamp tc-stamp--alert">{q.text}</span> : <span className="tc-stamp tc-stamp--attention">{calloutStamp(q.chipId)}</span>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {current ? (
          <PersonDay entry={current} date={date} now={now} actions={actions} onOpenPhoto={(url, caption) => setViewer({ url, caption })} onBack={() => setOpened(false)} />
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
