import { useState } from 'react'
import { fmtCurrency } from '@legacy/salary.js'
import type { Employee, Payment } from '../../data/types'
import { fmtDateLong } from '../../format'
import { Avatar } from '../../ui/Avatar'
import { fmtDateTime } from '../dayText'
import { plural } from '../people/peopleModel'
import { daySub, worstCase, type Ledger, type LedgerDay, type LedgerPerson } from './paymentsModel'

export interface PaymentActions {
  edit: (p: Payment, emp: Employee | undefined) => void
  remove: (p: Payment, emp: Employee | undefined) => void
  toggleResolved: (d: LedgerDay) => void
}

interface Props {
  ledger: Ledger | null
  actions: PaymentActions
}

const longDate = (iso: string) => fmtDateLong(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))))
const rupees = (n: number) => fmtCurrency(n)
const firstName = (e: Employee | undefined) => e?.name.split(' ')[0] ?? 'Employee'

function DayStamp({ d }: { d: LedgerDay }) {
  if (d.status === 'mismatch' && d.resolved) return <span className="tc-stamp tc-stamp--owner">✓ Resolved</span>
  if (d.status === 'matched') return <span className="tc-stamp tc-stamp--in">✓ Matched</span>
  if (d.status === 'mismatch') return <span className="tc-stamp tc-stamp--alert">Mismatch</span>
  return <span className="tc-stamp tc-stamp--attention">{d.status === 'awaiting-owner' ? 'Awaiting you' : 'Awaiting employee'}</span>
}

function PersonStamp({ p }: { p: LedgerPerson }) {
  const w = worstCase(p)
  if (w === 'mismatch') return <span className="tc-stamp tc-stamp--alert">! {plural(p.unresolved, 'mismatch', 'mismatches')}</span>
  if (w === 'awaiting') return <span className="tc-stamp tc-stamp--attention">… {p.awaiting} awaiting</span>
  return <span className="tc-stamp tc-stamp--in">✓ All matched</span>
}

function Side({ label, entries, emp, actions }: { label: string; entries: Payment[]; emp: Employee | undefined; actions: PaymentActions }) {
  return (
    <div className="led-card">
      <span className="lab">{label}</span>
      {entries.length === 0 && <span className="caption app-muted">Not logged yet</span>}
      {entries.map((p) => (
        <div key={p.id} className="led-card__entry">
          <span className="time-large">{rupees(p.amount)}</span>
          {p.created_at && <span className="caption app-muted">Logged {fmtDateTime(p.created_at)}</span>}
          <div className="led-card__actions">
            <button type="button" className="tc-btn tc-btn--secondary" onClick={() => actions.edit(p, emp)}>Edit</button>
            <button type="button" className="tc-btn tc-btn--danger" onClick={() => actions.remove(p, emp)}>Delete</button>
          </div>
        </div>
      ))}
    </div>
  )
}

export function Payments({ ledger, actions }: Props) {
  const [openEmp, setOpenEmp] = useState<string | null>(null)
  const [openDay, setOpenDay] = useState<string | null>(null)

  if (!ledger) return <p className="body app-muted days__empty">Couldn’t load payments. Check the Wi-Fi.</p>

  const first = ledger.firstMismatch
  const firstEmp = first ? ledger.people.find((p) => p.empId === first.empId)?.emp : undefined

  return (
    <>
      {first && (
        <div className="tc-callout tc-callout--alert">
          <span className="tc-stamp tc-stamp--alert">{ledger.mismatches} needs reconciliation</span>
          <p>{firstEmp ? `${firstName(firstEmp)}'s entry doesn't match yours for ${longDate(first.date)}. See below.` : 'See below.'}</p>
        </div>
      )}

      <div className="month-stats">
        <div className="tc-stat"><span className="tc-stat__label">Total logged</span><span className="stat">{rupees(ledger.totalLogged)}</span><span className="tc-stat__sub">{plural(ledger.entries, 'entry', 'entries')}</span></div>
        <div className="tc-stat"><span className="tc-stat__label">Matched</span><span className="stat" style={{ color: 'var(--in-ink)' }}>{ledger.matched}</span><span className="tc-stat__sub">both sides agree</span></div>
        <div className="tc-stat"><span className="tc-stat__label">Awaiting other side</span><span className="stat" style={{ color: 'var(--attention-ink)' }}>{ledger.awaiting}</span><span className="tc-stat__sub">one side logged</span></div>
        <div className="tc-stat"><span className="tc-stat__label">Mismatches</span><span className="stat" style={{ color: 'var(--alert-ink)' }}>{ledger.mismatches}</span><span className="tc-stat__sub">{ledger.mismatches ? `${rupees(ledger.mismatchGap)} apart` : 'nothing to reconcile'}</span></div>
      </div>

      <div className="led">
        <div className="led__head">
          <h2 className="heading" style={{ margin: 0 }}>Payment activity</h2>
          {ledger.entries > 0 && <span className="caption app-muted">{plural(ledger.entries, 'entry', 'entries')}</span>}
        </div>
        {ledger.entries === 0 ? (
          <p className="body app-muted days__empty">No payments logged this month.</p>
        ) : (
          <div className="tc-queue">
            {ledger.people.map((p) => {
              const expanded = openEmp === p.empId
              return (
                <div key={p.empId}>
                  <button
                    type="button"
                    className="led-emp"
                    aria-expanded={expanded}
                    onClick={() => { setOpenEmp(expanded ? null : p.empId); setOpenDay(null) }}
                  >
                    {p.emp ? <Avatar emp={p.emp} /> : <span className="tc-avatar">?</span>}
                    <span className="led-who"><span className="heading">{p.emp?.name ?? 'Unknown'}</span><span className="caption app-muted">{plural(p.days.length, 'day')} this month</span></span>
                    <span className="time" style={{ fontWeight: 600 }}>{rupees(p.total)}</span>
                    <PersonStamp p={p} />
                  </button>
                  {expanded && p.days.map((d) => {
                    const key = `${d.empId}:${d.date}`
                    const dayOpen = openDay === key
                    const flagged = d.status === 'mismatch' && !d.resolved
                    return (
                      <div key={key}>
                        <button
                          type="button"
                          className={`led-day${flagged ? ' led-day--flag' : ''}`}
                          aria-expanded={dayOpen}
                          onClick={() => setOpenDay(dayOpen ? null : key)}
                        >
                          <span className="led-who">
                            <span className="body-strong">{longDate(d.date)}</span>
                            <span className="caption" style={{ color: flagged ? 'var(--alert-ink)' : 'var(--ink-muted)' }}>{daySub(d)}</span>
                          </span>
                          <span className="time">{d.status === 'mismatch' ? `${rupees(d.employeeTotal)} vs ${rupees(d.ownerTotal)}` : rupees(d.employeeTotal || d.ownerTotal)}</span>
                          <DayStamp d={d} />
                        </button>
                        {dayOpen && (
                          <div className="led-side">
                            <Side label="Your entry (owner)" entries={d.ownerEntries} emp={p.emp} actions={actions} />
                            <Side label={`${firstName(p.emp)}'s entry`} entries={d.employeeEntries} emp={p.emp} actions={actions} />
                            {d.status === 'mismatch' && (
                              <div className="led-resolve">
                                <div>
                                  <div className="body-strong">{d.resolved ? 'Marked resolved' : 'Mark as resolved'}</div>
                                  <div className="caption app-muted">{d.resolved ? 'Tap to undo. The amounts stay as entered.' : "Use this once you've talked it through. The amounts stay as entered."}</div>
                                </div>
                                <button type="button" className="tc-btn tc-btn--secondary" onClick={() => actions.toggleResolved(d)}>{d.resolved ? '✓ Resolved, undo' : 'Mark resolved'}</button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
