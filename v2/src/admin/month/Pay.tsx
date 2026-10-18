import { useState } from 'react'
import { fmtCurrency, fmtRate } from '@legacy/salary.js'
import { STANDARD_DAY_HOURS } from '@legacy/config.js'
import { fmtHours } from '../../format'
import { Avatar } from '../../ui/Avatar'
import type { PayLine } from './monthModel'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

interface Props {
  lines: PayLine[]
  daysInMonth: number
  daysElapsed: number
  isCurrent: boolean
  paidOut: number | null
  onChangeRate: (line: PayLine) => void
}

export function Pay({ lines, daysInMonth, daysElapsed, isCurrent, paidOut, onChangeRate }: Props) {
  const [openId, setOpenId] = useState<string | null>(null)
  const shown = lines.find((l) => l.emp.id === openId) ?? null
  const totalPay = lines.reduce((s, l) => s + Math.round(l.pay ?? 0), 0)
  const totalHours = lines.reduce((s, l) => s + (l.rate ? l.paidHours : 0), 0)

  return (
    <>
      <div className="month-stats month-stats--3">
        <div className="tc-stat"><span className="tc-stat__label">{isCurrent ? 'Estimated pay so far' : 'Estimated pay'}</span><span className="stat">{fmtCurrency(totalPay)}</span><span className="tc-stat__sub">{plural(lines.length, 'person', 'people')}, {isCurrent ? `${daysElapsed} days of ${daysInMonth}` : `${daysInMonth} days`}</span></div>
        <div className="tc-stat"><span className="tc-stat__label">Hours paid</span><span className="stat">{fmtHours(totalHours)}</span><span className="tc-stat__sub">includes paid holidays and overtime</span></div>
        <div className="tc-stat"><span className="tc-stat__label">Already paid out</span><span className="stat">{paidOut === null ? '—' : fmtCurrency(paidOut)}</span><span className="tc-stat__sub">from the Payments ledger</span></div>
      </div>

      <div className="pay-table-wrap">
        <table className="pay-table">
          <thead>
            <tr><th>Person</th><th className="num">Monthly rate</th><th className="num">Per hour</th><th className="num">Hours paid</th><th className="num">{isCurrent ? 'Est. pay so far' : 'Est. pay'}</th><th /></tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.emp.id}>
                <td><div className="pay-person"><Avatar emp={l.emp} /><span className="heading">{l.emp.name}</span></div></td>
                <td className="num"><span className="time">{l.rate ? fmtCurrency(l.rate.monthly) : 'No rate set'}</span></td>
                <td className="num"><span className="time">{l.hourly === null ? '—' : fmtRate(l.hourly)}</span></td>
                <td className="num"><span className="time">{fmtHours(l.paidHours)}</span></td>
                <td className="num"><span className="time" style={{ fontWeight: 600 }}>{l.pay === null ? '—' : fmtCurrency(l.pay)}</span></td>
                <td className="num">
                  <button type="button" className="tc-btn tc-btn--quiet" aria-expanded={openId === l.emp.id} onClick={() => setOpenId(openId === l.emp.id ? null : l.emp.id)}>
                    {openId === l.emp.id ? 'Hide calculation' : 'Show calculation'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {shown && (
        <section className="pay-calc" aria-label={`${shown.emp.name}, how this is worked out`}>
          <div className="pay-calc__head">
            <h2 className="title-2" style={{ margin: 0 }}>{shown.emp.name} · how this is worked out</h2>
            <button type="button" className="tc-btn tc-btn--secondary" onClick={() => onChangeRate(shown)}>Change rate</button>
          </div>
          {shown.rate ? <Calculation line={shown} daysInMonth={daysInMonth} /> : (
            <p className="body app-muted" style={{ margin: 0 }}>No salary rate has been set for {shown.emp.name} yet. Use Change rate to add one.</p>
          )}
        </section>
      )}
    </>
  )
}

function Calculation({ line: l, daysInMonth }: { line: PayLine; daysInMonth: number }) {
  const rate = l.rate!
  const hoursTerms = [
    l.creditedHours ? `${fmtHours(l.creditedHours)} (${plural(l.paidFridays, 'paid holiday')})` : '',
    l.overtime ? `${fmtHours(l.overtime)} overtime` : '',
  ].filter(Boolean)
  const fridayNote =
    l.totalFridays === 0 ? '' : l.dockedFridays === 0 ? ` (+ ${plural(l.paidFridays, 'paid Friday')})`
    : l.paidFridays === 0 ? ` (${plural(l.dockedFridays, 'Friday')} marked unpaid)`
    : ` (+ ${plural(l.paidFridays, 'paid Friday')}, ${l.dockedFridays} marked unpaid)`
  return (
    <dl>
      <dt className="label">Rate</dt><dd className="time">{fmtCurrency(rate.monthly)} a month, from {rate.from}</dd>
      <dt className="label">Per hour</dt><dd className="time">{fmtCurrency(rate.monthly)} ÷ {fmtHours(l.standardHours)} ({daysInMonth} days × {STANDARD_DAY_HOURS}h) = {fmtRate(l.hourly)}</dd>
      <dt className="label">Days worked</dt><dd className="time">{l.daysWorked}{fridayNote}</dd>
      <dt className="label">Hours</dt><dd className="time">{fmtHours(l.punchedHours)} worked{hoursTerms.map((t) => ` + ${t}`).join('')} = {fmtHours(l.paidHours)}</dd>
      {l.dockedFridays > 0 && (
        <><dt className="label">Docked</dt><dd className="time">{plural(l.dockedFridays, 'Friday')} not credited (−{fmtHours(l.dockedFridays * STANDARD_DAY_HOURS)} against a paid Friday)</dd></>
      )}
      <dt className="label">Pay</dt><dd className="time"><strong>{fmtRate(l.hourly)} × {fmtHours(l.paidHours)} = {fmtCurrency(l.pay)}</strong></dd>
    </dl>
  )
}
