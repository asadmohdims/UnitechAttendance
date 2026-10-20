import { useState } from 'react'
import { fmtCurrency, fmtRate } from '@legacy/salary.js'
import { STANDARD_DAY_HOURS } from '@legacy/config.js'
import { fmtHours } from '../../format'
import { Avatar } from '../../ui/Avatar'
import { useMinWidth } from '../../ui/useMinWidth'
import { DayStrip } from './DayStrip'
import type { PayLine, PersonMonth } from './monthModel'
import { buildSettlement, type SettlementRow } from './payModel'
import type { Payment } from '../../data/types'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** A rate that is a whole number of rupees reads "₹75", otherwise "₹72.58": the cents only when they are there to multiply out. */
const rateText = (hourly: number | null) => (fmtRate(hourly) as string).replace(/\.00$/, '')
const shortDate = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** The list and the statement sit side by side from here up; below it they are two steps of one flow. */
const SPLIT_MIN_WIDTH = 900

type Filter = 'all' | 'to-pay'

interface Props {
  lines: PayLine[]
  people: PersonMonth[]
  payments: Payment[] | null
  /** Days the Days queue wants looked at, by person: the pay could still change. */
  checkDates: Record<string, string[]>
  monthName: string
  daysInMonth: number
  daysElapsed: number
  isCurrent: boolean
  onChangeRate: (line: PayLine) => void
  onLogPayment: (empId: string) => void
  onOpenPayments: () => void
  onOpenAttendance: () => void
  onOpenDay: (date: string, empId: string) => void
}

export function Pay({ lines, people, payments, checkDates, monthName, daysInMonth, daysElapsed, isCurrent, onChangeRate, onLogPayment, onOpenPayments, onOpenAttendance, onOpenDay }: Props) {
  const split = useMinWidth(SPLIT_MIN_WIDTH)
  const [filter, setFilter] = useState<Filter>('all')
  const [pickedId, setPickedId] = useState<string | null>(null)
  const s = buildSettlement(lines, people, payments)
  const shown = filter === 'to-pay' ? s.rows.filter((r) => r.status === 'to-pay') : s.rows
  // Side by side, something is always open (the first person still owed, else the first). On a phone nothing is until tapped.
  const fallback = shown.find((r) => r.status === 'to-pay') ?? shown[0]
  const selected = s.rows.find((r) => r.line.emp.id === pickedId && shown.includes(r)) ?? (split ? fallback : undefined)
  const so = isCurrent ? ' so far' : ''

  const statement = selected && (
    <Statement
      row={selected} monthName={monthName} daysInMonth={daysInMonth} paymentsKnown={payments !== null}
      checkDates={checkDates[selected.line.emp.id] ?? []}
      onBack={split ? null : () => setPickedId(null)}
      {...{ onChangeRate, onLogPayment, onOpenPayments, onOpenAttendance, onOpenDay }}
    />
  )

  return (
    <>
      {isCurrent && (
        <div className="tc-callout tc-callout--attention">
          <p><strong>{monthName} is not finished.</strong> Pay{so} covers days 1 to {daysElapsed} of {daysInMonth}.</p>
        </div>
      )}
      {(split || !selected) && (
        <div className="month-stats month-stats--3">
          <div className="tc-stat"><span className="tc-stat__label">{isCurrent ? 'Earned so far' : `Earned in ${monthName}`}</span><span className="stat">{fmtCurrency(s.earned)}</span><span className="tc-stat__sub">{plural(s.rows.filter((r) => r.pay !== null).length, 'person', 'people')} with a rate</span></div>
          <div className="tc-stat"><span className="tc-stat__label">Paid out</span><span className="stat">{s.paidOut === null ? '—' : fmtCurrency(s.paidOut)}</span><span className="tc-stat__sub">{s.paidOut === null ? 'Payments not available' : 'logged by you in Payments'}</span></div>
          <div className="tc-stat pay-key"><span className="tc-stat__label">Still to pay{so}</span><span className="stat">{s.toPay === null ? '—' : fmtCurrency(s.toPay)}</span><span className="tc-stat__sub">{s.toPay === null ? 'Needs the Payments list' : `${plural(s.toPayCount, 'person', 'people')}${s.ahead ? ` · ${fmtCurrency(s.ahead)} paid ahead` : ''}`}</span></div>
        </div>
      )}

      <div className={split ? 'pay-split' : undefined}>
        {(split || !selected) && (
          <div className="pay-list">
            <div className="pay-filters" role="group" aria-label="Show">
              <button type="button" className="tc-btn tc-btn--quiet" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Everyone {s.rows.length}</button>
              <button type="button" className="tc-btn tc-btn--quiet" aria-pressed={filter === 'to-pay'} onClick={() => setFilter('to-pay')}>To pay {s.toPayCount}</button>
            </div>
            {shown.length === 0 ? <p className="body app-muted">Nobody is owed anything{so}.</p> : shown.map((r) => (
              <PayRow key={r.line.emp.id} row={r} current={selected === r} checks={(checkDates[r.line.emp.id] ?? []).length} onPick={() => setPickedId(r.line.emp.id)} />
            ))}
          </div>
        )}
        {statement}
      </div>
    </>
  )
}

function PayRow({ row: r, current, checks, onPick }: { row: SettlementRow; current: boolean; checks: number; onPick: () => void }) {
  const name = r.line.emp.name
  const pct = r.pay && r.paidOut !== null ? Math.min(100, Math.round((r.paidOut / r.pay) * 100)) : 0
  const amount = r.status === 'no-rate' || r.status === 'unknown' ? '—' : r.status === 'settled' ? '✓' : fmtCurrency(Math.abs(r.left as number))
  const caption = r.status === 'to-pay' ? 'to pay' : r.status === 'settled' ? 'settled' : r.status === 'ahead' ? 'ahead' : r.status === 'unknown' ? fmtCurrency(r.pay) + ' earned' : ''
  const sub =
    r.status === 'no-rate' ? null
    : r.status === 'unknown' ? 'Payments not available'
    : r.status === 'settled' ? `${fmtCurrency(r.pay)} paid in full`
    : r.paidOut ? `${fmtCurrency(r.paidOut)} of ${fmtCurrency(r.pay)} paid`
    : `Not paid yet · ${fmtCurrency(r.pay)} earned`
  return (
    <button type="button" className="pay-row" aria-current={current} onClick={onPick}>
      <Avatar emp={r.line.emp} />
      <span className="heading">{name}</span>
      <span className="pay-row__amt"><span className="pay-row__num">{amount}</span><span className="caption app-muted">{caption}</span></span>
      <span className="pay-row__sub caption app-muted">
        {sub}
        {r.status === 'no-rate' && <span className="tc-stamp tc-stamp--alert">No rate set</span>}
        {r.status === 'ahead' && <span className="tc-stamp tc-stamp--attention">Paid ahead</span>}
        {checks > 0 && <span className="tc-stamp tc-stamp--attention">{plural(checks, 'day')} to check</span>}
      </span>
      {r.pay !== null && r.paidOut !== null && <span className={`pay-bar${r.status === 'ahead' ? ' pay-bar--ahead' : ''}`} aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>}
    </button>
  )
}

interface StatementProps {
  row: SettlementRow
  monthName: string
  daysInMonth: number
  paymentsKnown: boolean
  checkDates: string[]
  onBack: (() => void) | null
  onChangeRate: (line: PayLine) => void
  onLogPayment: (empId: string) => void
  onOpenPayments: () => void
  onOpenAttendance: () => void
  onOpenDay: (date: string, empId: string) => void
}

function Statement({ row: r, monthName, daysInMonth, paymentsKnown, checkDates, onBack, onChangeRate, onLogPayment, onOpenPayments, onOpenAttendance, onOpenDay }: StatementProps) {
  const l = r.line
  const rate = l.rate
  const looks = new Set(checkDates)
  return (
    <section className="pay-statement" aria-label={`${l.emp.name}, pay for ${monthName}`}>
      <div className="pay-statement__head">
        {onBack && <button type="button" className="tc-btn tc-btn--quiet" onClick={onBack}>‹ Back</button>}
        <Avatar emp={l.emp} large />
        <div className="pay-statement__who">
          <h2 className="title-2" style={{ margin: 0 }}>{l.emp.name}</h2>
          <p className="body app-muted" style={{ margin: 0 }}>{rate ? `${fmtCurrency(rate.monthly)} a month` : 'No rate set'}</p>
        </div>
        <button type="button" className="tc-btn tc-btn--secondary" onClick={() => onChangeRate(l)}>{rate ? 'Change rate' : 'Set rate'}</button>
      </div>

      {checkDates.length > 0 && (
        <div className="tc-callout tc-callout--attention month-callout">
          <p><strong>{plural(checkDates.length, 'day')} to check.</strong> Pay may change once {checkDates.length === 1 ? 'it is' : 'they are'} settled.</p>
          <button type="button" className="tc-btn tc-btn--secondary" onClick={() => onOpenDay(checkDates[0], l.emp.id)}>Review</button>
        </div>
      )}

      {!rate ? (
        <p className="body app-muted" style={{ margin: 0 }}>No salary rate has been set for {l.emp.name} yet. Use Set rate to add one. There is nothing to work out until then.</p>
      ) : (
        <>
          <div className="pay-lines">
            <Line label="Hours worked" value={fmtHours(l.punchedHours)} why="Punches counted to the nearest quarter hour" hours />
            <Line
              label="Paid Fridays" hours positive={l.creditedHours > 0}
              value={l.creditedHours ? `+ ${fmtHours(l.creditedHours)}` : '0:00'}
              why={l.totalFridays === 0 ? 'No Fridays yet' : l.dockedFridays ? `${l.paidFridays} of ${l.totalFridays} Fridays paid, ${l.dockedFridays} marked unpaid · ${l.paidFridays} × ${fmtHours(STANDARD_DAY_HOURS)}` : `${plural(l.paidFridays, 'Friday')} × ${fmtHours(STANDARD_DAY_HOURS)}`}
            />
            {l.overtime > 0 && <Line label="Overtime" value={`+ ${fmtHours(l.overtime)}`} why="Hours you added, paid at the normal rate" hours positive />}
            <Line label="Total hours" value={fmtHours(l.paidHours)} hours total />
            <Line label="Rate" value={`× ${rateText(l.hourly)} an hour`} why={`${fmtCurrency(rate.monthly)} a month ÷ ${fmtHours(l.standardHours)} (${daysInMonth} days × ${STANDARD_DAY_HOURS}h) · from ${rate.from}`} />
            <Line label={`Pay for ${monthName}`} value={fmtCurrency(r.pay)} total />
            <Line
              label="Already paid" value={r.paidOut === null ? '—' : r.paidOut ? `− ${fmtCurrency(r.paidOut)}` : fmtCurrency(0)}
              why={!paymentsKnown ? "Payments not available. Payments needs internet." : r.entries.length ? r.entries.map((e) => `${shortDate(e.date)} ${fmtCurrency(e.amount)}`).join(' · ') : 'Nothing logged yet'}
            />
            {r.status === 'to-pay' && <Line label="Still to pay" value={fmtCurrency(r.left)} tone="due" />}
            {r.status === 'settled' && <Line label="Settled" value={`✓ ${fmtCurrency(0)} left`} tone="settled" />}
            {r.status === 'ahead' && <Line label="Paid ahead" value={fmtCurrency(-(r.left as number))} why="More than this month's pay. Check the Payments list." tone="ahead" />}
          </div>

          <div>
            <p className="label" style={{ margin: '0 0 var(--space-2)' }}>Where the hours went</p>
            <DayStrip person={r.person} needsLook={(d) => looks.has(d)} />
          </div>

          <div className="pay-actions">
            <button type="button" className="tc-btn tc-btn--primary" onClick={() => onLogPayment(l.emp.id)}>Log a payment</button>
            <button type="button" className="tc-btn tc-btn--quiet" onClick={onOpenPayments}>Open in Payments</button>
            <button type="button" className="tc-btn tc-btn--quiet" onClick={onOpenAttendance}>Open in Attendance</button>
          </div>
        </>
      )}
    </section>
  )
}

function Line({ label, value, why, hours, positive, total, tone }: { label: string; value: string; why?: string; hours?: boolean; positive?: boolean; total?: boolean; tone?: 'due' | 'settled' | 'ahead' }) {
  return (
    <div className={['pay-line', total ? 'pay-line--total' : '', tone ? `pay-line--${tone}` : ''].filter(Boolean).join(' ')}>
      <span className={total || tone ? 'label' : 'body'}>{label}</span>
      <span className={['pay-line__v', hours ? 'time' : '', positive ? 'pay-line__v--pos' : ''].filter(Boolean).join(' ')}>{value}</span>
      {why && <span className="pay-line__why caption">{why}</span>}
    </div>
  )
}
