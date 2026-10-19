import { useCallback, useMemo, useState } from 'react'
import { store } from '../../data/store'
import { refreshKioskData } from '../../data/invalidate'
import { dateKey, fmtTime } from '../../format'
import { useNow } from '../../kiosk/useNow'
import { useSheets } from '../../ui/Sheets'
import type { Employee, Payment } from '../../data/types'
import { confirmPaymentDeleteForm, markReviewedForm, missedPunchForm, paymentForm, rateForm } from '../forms'
import { fmtDayShort } from '../dayText'
import { Attendance, type AttendanceActions } from './Attendance'
import { downloadMonthXlsx } from './exportXlsx'
import { MonthPeriod } from './MonthPeriod'
import type { PayLine } from './monthModel'
import { DownloadMenu } from './DownloadMenu'
import { Pay } from './Pay'
import { Payments, type PaymentActions } from './Payments'
import { buildLedger } from './paymentsModel'
import { useMonthData } from './useMonthData'

type Section = 'attendance' | 'pay' | 'payments'
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'attendance', label: 'Attendance' },
  { id: 'pay', label: 'Pay' },
  { id: 'payments', label: 'Payments' },
]

interface Props {
  onNotice: (msg: string) => void
  onOpenDay: (date: string, empId: string) => void
  /** Injected in tests. */
  nowOverride?: Date
}

export function MonthScreen({ onNotice, onOpenDay, nowOverride }: Props) {
  const sheets = useSheets()
  const tick = useNow(30000)
  const now = nowOverride ?? tick
  const today = dateKey(now)
  const currentYm = today.slice(0, 7)
  const [ym, setYm] = useState(currentYm)
  const [section, setSection] = useState<Section>('attendance')
  const [busyExport, setBusyExport] = useState(false)

  const data = useMonthData(ym, today)
  const { model, lines, records, overtime, payments } = data
  const paidOut = payments ? payments.filter((p) => p.entered_by === 'owner').reduce((s, p) => s + Number(p.amount), 0) : null

  const attempt = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn()
        await data.refetchAttendance()
        void refreshKioskData(now)
      } catch (err) {
        onNotice(`Failed: ${(err as Error).message}`)
      }
    },
    [data, onNotice, now],
  )

  const actions: AttendanceActions = {
    openInDays: onOpenDay,
    addMissedPunch: async (p, date) => {
      const form = missedPunchForm(date, p.emp.name)
      const v = await sheets.prompt(form.config)
      if (!v) return
      const times = form.resolve(v)
      if (!times) return
      await attempt(() => store.addManualRecord(p.emp.id, date, times.inIso, times.outIso).then(() => undefined))
    },
    markReviewed: async (p, day) => {
      const last = day.sessions[day.sessions.length - 1]
      if (!last?.clock_out) return
      const v = await sheets.prompt(markReviewedForm(p.emp.name, fmtDayShort(day.date), fmtTime(last.clock_out)))
      if (!v) return
      await attempt(() => store.updateRecordTimes(last.id, last.clock_in, last.clock_out))
    },
    toggleHoliday: (p, date, docked) => void attempt(() => store.setDayOverride(p.emp.id, date, docked)), // flip: paid = currently docked
    listDates: async (p) => {
      const rows = p.days.filter((d) => d.kind === 'absent' || d.kind === 'half')
      const i = await sheets.choose({
        title: `${p.emp.name}, absences this month`,
        items: rows.map((d) => ({ label: `${fmtDayShort(d.date)} · ${d.kind === 'absent' ? 'absent' : 'half day'}` })),
      })
      if (i !== null) onOpenDay(rows[i].date, p.emp.id)
    },
  }

  const ledger = useMemo(
    () => (payments ? buildLedger(payments, data.resolutions, data.employees ?? []) : null),
    [payments, data.resolutions, data.employees],
  )

  /** A payment write, then a re-read; a failure is said out loud and nothing is assumed saved. */
  const attemptPayment = async (fn: () => Promise<void>) => {
    try {
      await fn()
      await data.refetchPayments()
    } catch (err) {
      onNotice(`Failed: ${(err as Error).message}`)
    }
  }

  const logPayment = async () => {
    const active = (data.employees ?? []).filter((e) => e.active)
    if (!active.length) return onNotice('Add an employee first.')
    const v = await sheets.prompt(paymentForm(null, active, today))
    if (!v) return
    await attemptPayment(async () => {
      await store.addPayment(v.empId, Number(v.amount), v.occurredOn, 'owner')
      onNotice('Payment logged.')
    })
  }

  const paymentActions: PaymentActions = {
    edit: async (p: Payment, emp: Employee | undefined) => {
      const v = await sheets.prompt(paymentForm(p, emp ? [emp] : [], today, emp?.name))
      if (v) await attemptPayment(() => store.updatePayment(p.id, Number(v.amount), v.occurredOn))
    },
    remove: async (p: Payment, emp: Employee | undefined) => {
      const v = await sheets.prompt(confirmPaymentDeleteForm(emp?.name ?? 'this employee'))
      if (v) await attemptPayment(() => store.deletePayment(p.id))
    },
    toggleResolved: (d) => void attemptPayment(() => store.setPaymentResolution(d.empId, d.date, !d.resolved, null)),
  }

  const changeRate = async (line: PayLine) => {
    const v = await sheets.prompt(rateForm(line.emp.name, line.rate?.monthly ?? null, today))
    if (!v) return
    await attempt(async () => {
      await store.setSalaryRate(line.emp.id, { monthlySalary: Number(v.amount), effectiveFrom: v.effectiveFrom })
      onNotice(`Salary updated for ${line.emp.name}`)
    })
  }

  const download = async () => {
    if (!model || busyExport) return
    setBusyExport(true)
    try {
      await downloadMonthXlsx(model)
    } catch (err) {
      onNotice((err as Error).message)
    } finally {
      setBusyExport(false)
    }
  }

  return (
    <div className="month">
      <header className="month__header">
        <h1 className="title-1" style={{ margin: 0 }}>Month</h1>
        <div className="month__header-actions">
          <MonthPeriod ym={ym} currentYm={currentYm} onChange={setYm} />
          {section === 'payments' && <button type="button" className="tc-btn tc-btn--secondary" onClick={() => void logPayment()}>Log a payment</button>}
          <DownloadMenu model={model} lines={lines} now={now} onExcel={() => void download()} onNotice={onNotice} />
        </div>
      </header>

      <div className="month-seg" role="group" aria-label="Month sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="tc-btn tc-btn--quiet"
            aria-pressed={section === s.id}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {!model ? (
        <p className="body app-muted days__empty">Loading the month…</p>
      ) : section === 'attendance' ? (
        <Attendance model={model} records={records ?? []} overtime={overtime} now={now} currentYm={currentYm} actions={actions} />
      ) : section === 'payments' ? (
        <Payments ledger={ledger} actions={paymentActions} />
      ) : (
        <Pay lines={lines} daysInMonth={model.daysInMonth} daysElapsed={model.daysElapsed} isCurrent={ym === currentYm} paidOut={paidOut} onChangeRate={(l) => void changeRate(l)} />
      )}
    </div>
  )
}
