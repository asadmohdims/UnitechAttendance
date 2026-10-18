import { useEffect, useRef } from 'react'
import { fmtCurrency } from '@legacy/salary.js'
import { fmtDateLong } from '../../format'
import type { PaymentSaved } from './PaymentsFlow'

const SHOW_MS = 1800

/** Board "Payment saved". Tapping it, or waiting, dismisses it and the kiosk goes back to Attendance. */
export function PaymentConfirm({ saved, onDone }: { saved: PaymentSaved; onDone: () => void }) {
  // Same as PunchConfirm: the timer must survive the kiosk's once-a-second redraw.
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const t = setTimeout(() => done.current(), SHOW_MS)
    return () => clearTimeout(t)
  }, [saved])

  const [y, m, d] = saved.date.split('-').map(Number)
  return (
    <div className="kiosk-confirm" role="status" aria-live="polite" onClick={onDone}>
      <div className="tc-confirm">
        <span className="tc-confirm__check" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 12.5l5 5L19.5 6.5" /></svg>
        </span>
        <span className="tc-confirm__verb">Payment logged</span>
        <span className="title-1">{saved.name}</span>
        <span className="time-large">{fmtCurrency(saved.amount)}</span>
        <span className="body kiosk-muted" style={{ textAlign: 'center' }}>
          {fmtDateLong(new Date(y, m - 1, d))}
          <br />
          This will show in your payments this month
        </span>
      </div>
    </div>
  )
}
