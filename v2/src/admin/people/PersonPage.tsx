import { fmtCurrency } from '@legacy/salary.js'
import type { Employee } from '../../data/types'
import { fmtHours } from '../../format'
import { Avatar } from '../../ui/Avatar'
import type { LedgerPerson } from '../month/paymentsModel'
import { worstCase } from '../month/paymentsModel'
import type { PayLine, PersonMonth } from '../month/monthModel'
import { fmtDateYear, hasPin, plural } from './peopleModel'

export interface PersonActions {
  retakePhoto: () => void
  rename: () => void
  setPin: () => void
  changeRate: () => void
  toggleActive: () => void
}

interface Props {
  emp: Employee
  /** Null when the month has no row for them (inactive and no punches this month). */
  month: PersonMonth | null
  line: PayLine | null
  /** Null = not loaded (the read failed); a person with nothing logged has an entry-less ledger person. */
  payments: { loaded: boolean; person: LedgerPerson | null }
  monthLabel: string
  clockedIn: boolean
  actions: PersonActions
  onBack: () => void
}

const PAY_STAMP = {
  matched: { cls: 'in', text: 'Matched' },
  awaiting: { cls: 'attention', text: 'Awaiting' },
  mismatch: { cls: 'alert', text: 'Mismatch' },
} as const

export function PersonPage({ emp, month, line, payments, monthLabel, clockedIn, actions, onBack }: Props) {
  const absences = month ? `${plural(month.daysOff, 'absence')}, ${plural(month.halfDays, 'half day')}` : ''
  const stamp = payments.person ? PAY_STAMP[worstCase(payments.person)] : null

  return (
    <section className="person" aria-label={emp.name}>
      <button type="button" className="tc-btn tc-btn--quiet person__back" onClick={onBack}>‹ People</button>

      <div className="person__head">
        <Avatar emp={emp} large />
        <div className="person__who">
          <h2 className="title-1" style={{ margin: 0 }}>{emp.name}</h2>
          <div className="person__stamps">
            <span className={`tc-stamp ${emp.active ? 'tc-stamp--in' : 'tc-stamp--neutral'}`}>{emp.active ? 'Active' : 'Inactive'}</span>
            <span className="tc-stamp tc-stamp--neutral">{hasPin(emp) ? 'PIN set' : 'No PIN yet'}</span>
          </div>
        </div>
        <div className="person__actions">
          <button type="button" className="tc-btn tc-btn--secondary" onClick={actions.retakePhoto}>{emp.avatar ? 'Retake photo' : 'Add photo'}</button>
          <button type="button" className="tc-btn tc-btn--secondary" onClick={actions.rename}>Rename</button>
          <button type="button" className="tc-btn tc-btn--secondary" onClick={actions.setPin}>{hasPin(emp) ? 'Reset PIN' : 'Set PIN'}</button>
        </div>
      </div>

      <div>
        <h3 className="heading" style={{ margin: '0 0 var(--space-3)' }}>{monthLabel}</h3>
        <div className="person__stats">
          <div className="tc-stat">
            <span className="tc-stat__label">Attendance</span>
            <span className="stat">{month ? fmtHours(month.exactTotal) : '—'}</span>
            <span className="tc-stat__sub">{absences || 'No punches this month'}</span>
          </div>
          <div className="tc-stat">
            <span className="tc-stat__label">Estimated pay</span>
            <span className="stat">{line?.pay != null ? fmtCurrency(line.pay) : '—'}</span>
            <span className="tc-stat__sub">{line?.rate ? `${fmtCurrency(line.rate.monthly)} a month` : 'No rate set'}</span>
          </div>
          <div className="tc-stat">
            <span className="tc-stat__label">Payments</span>
            <span className="stat">{!payments.loaded ? '—' : fmtCurrency(payments.person?.total ?? 0)}</span>
            <span className="tc-stat__sub">
              {!payments.loaded ? 'Couldn’t load payments' : stamp ? <span className={`tc-stamp tc-stamp--${stamp.cls}`}>{stamp.text}</span> : 'None logged'}
            </span>
          </div>
        </div>
      </div>

      <div className="person__block">
        <h3 className="heading" style={{ margin: 0 }}>Rate</h3>
        <div className="person__rate">
          <div>
            {line?.rate ? (
              <>
                <div className="time">{fmtCurrency(line.rate.monthly)} a month</div>
                <div className="caption app-muted">From {fmtDateYear(line.rate.from)}. Earlier months keep their own rate.</div>
              </>
            ) : (
              <>
                <div className="time">No rate set</div>
                <div className="caption app-muted">Set a monthly salary to see an estimated pay.</div>
              </>
            )}
          </div>
          <button type="button" className="tc-btn tc-btn--secondary" onClick={actions.changeRate}>Change rate</button>
        </div>
      </div>

      {clockedIn && emp.active && (
        <div className="tc-callout tc-callout--attention">
          <span className="tc-stamp tc-stamp--attention">Can't deactivate yet</span>
          <p>{emp.name} is currently clocked in. Clock them out before deactivating, or today's clock-in would have no way to clock out.</p>
        </div>
      )}

      <div className="person__off">
        <div>
          <div className="body-strong">{emp.active ? `Stop ${emp.name} from appearing on the kiosk` : `${emp.name} is not on the kiosk`}</div>
          <div className="caption app-muted">{emp.active ? 'Their history stays. You can bring them back at any time.' : 'Activate them to put their tile back on the kiosk. Their history was never removed.'}</div>
        </div>
        {emp.active ? (
          <button type="button" className="tc-btn tc-btn--danger" disabled={clockedIn} onClick={actions.toggleActive}>Deactivate</button>
        ) : (
          <button type="button" className="tc-btn tc-btn--secondary" onClick={actions.toggleActive}>Activate</button>
        )}
      </div>
    </section>
  )
}
