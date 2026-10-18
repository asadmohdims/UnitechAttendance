import { useCallback, useEffect, useRef, useState } from 'react'
import { verifyPin } from '@legacy/pin.js'
import { groupByEmployeeDate } from '@legacy/paymentsMath.js'
import { fmtCurrency } from '@legacy/salary.js'
import { store } from '../../data/store'
import type { Employee, Payment } from '../../data/types'
import { fmtDateLong } from '../../format'
import { hapticError, hapticSuccess } from '../../ui/haptics'
import { Avatar } from '../../ui/Avatar'
import { backspaceAmount, groupAmount, pressAmountDigit } from './amountPad'
import { applyCheck, backspace, isLocked, LOCKED, NO_PIN, OFFLINE, PIN_LENGTH, pressDigit, startPin, WRONG, MAX_ATTEMPTS, type PinCheck, type PinState } from './pinGate'

export interface PaymentSaved {
  name: string
  amount: number
  date: string
}

interface Props {
  emp: Employee
  /** Today as YYYY-MM-DD: picks the month shown and the default date. */
  today: string
  onClose: () => void
  onSaved: (saved: PaymentSaved) => void
}

type Screen = 'pin' | 'month' | 'add'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const longDate = (iso: string) => fmtDateLong(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))))

function Keypad({ onDigit, onBack, disabled, busy, size }: { onDigit: (d: string) => void; onBack: () => void; disabled?: boolean; busy?: boolean; size: number }) {
  const key = { height: size }
  return (
    <div className="tc-keypad" aria-busy={busy || undefined} style={{ gridTemplateColumns: `repeat(3,${size}px)`, opacity: disabled ? 0.45 : undefined }}>
      {KEYS.map((k) => <button key={k} type="button" className="tc-key" style={key} disabled={disabled} onClick={() => onDigit(k)}>{k}</button>)}
      <span />
      <button type="button" className="tc-key" style={key} disabled={disabled} onClick={() => onDigit('0')}>0</button>
      <button type="button" className="tc-key tc-key--ghost" style={{ ...key, fontSize: size > 60 ? 28 : 26 }} aria-label="Delete" disabled={disabled} onClick={onBack}>⌫</button>
    </div>
  )
}

/**
 * One continuous flow in a single dialog: PIN, then the employee's month, then the amount. Only the
 * employee's own entries are ever shown: the owner's side and whether the two agree belong to the
 * owner's reconciliation, not to a shared tablet.
 */
export function PaymentsFlow({ emp, today, onClose, onSaved }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [screen, setScreen] = useState<Screen>('pin')

  useEffect(() => {
    const el = dialogRef.current
    if (el && !el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '')
    }
  }, [])

  return (
    <dialog ref={dialogRef} className="kiosk-camera kiosk-pay" aria-label={`Payments, ${emp.name}`} onCancel={(e) => { e.preventDefault(); onClose() }}>
      <div className="kiosk-camera__card kiosk-pay__card">
        {screen === 'pin' && <PinScreen emp={emp} onCancel={onClose} onOk={() => setScreen('month')} />}
        {screen === 'month' && <MonthScreen emp={emp} today={today} onBack={onClose} onAdd={() => setScreen('add')} />}
        {screen === 'add' && <AddScreen emp={emp} today={today} onBack={() => setScreen('month')} onSaved={onSaved} />}
      </div>
    </dialog>
  )
}

function PinScreen({ emp, onCancel, onOk }: { emp: Employee; onCancel: () => void; onOk: () => void }) {
  const [pin, setPin] = useState<PinState>(startPin)
  const [checking, setChecking] = useState(false)
  const locked = isLocked(pin)

  const verify = useCallback(
    async (digits: string): Promise<PinCheck> => {
      try {
        const rec = await store.getEmployeePinRecord(emp.id)
        if (!rec) return 'no-pin'
        return (await verifyPin(digits, rec.salt, rec.hash)) ? 'ok' : 'wrong'
      } catch {
        // Not a wrong PIN: the check itself needs the server, so it does not count as an attempt.
        return 'offline'
      }
    },
    [emp.id],
  )

  async function press(d: string) {
    if (checking || locked) return
    const next = pressDigit(pin, d)
    setPin(next)
    if (next.digits.length < PIN_LENGTH) return
    setChecking(true)
    const result = await verify(next.digits)
    setChecking(false)
    if (result === 'ok') return onOk()
    if (result !== 'offline') hapticError()
    setPin(applyCheck(next, result))
  }

  const message =
    pin.problem === 'wrong' ? WRONG(MAX_ATTEMPTS - pin.attempts) : null
  const callout =
    pin.problem === 'locked' ? { tone: 'alert', stamp: 'Locked', text: LOCKED }
    : pin.problem === 'no-pin' ? { tone: 'attention', stamp: 'No PIN', text: NO_PIN }
    : pin.problem === 'offline' ? { tone: 'attention', stamp: 'Offline', text: OFFLINE }
    : null
  // The dots turn red only until the next digit; the message stays so the attempts left remain readable.
  const failed = pin.problem === 'wrong' && pin.digits.length === 0

  return (
    <div className="kiosk-pay__screen kiosk-pay__screen--center">
      <div className="kiosk-pay__avatar"><Avatar emp={emp} /></div>
      <div style={{ textAlign: 'center' }}>
        <h2 className="title-2" style={{ margin: 0 }}>Enter PIN for {emp.name}</h2>
        {!callout && <div className="caption kiosk-muted">4-digit PIN. Only you can see your payments.</div>}
      </div>
      {callout && (
        <div className={`tc-callout tc-callout--${callout.tone}`} style={{ width: '100%', boxSizing: 'border-box' }} role="alert">
          <span className={`tc-stamp tc-stamp--${callout.tone}`}>{callout.stamp}</span>
          <p>{callout.text}</p>
        </div>
      )}
      {!locked && (
        <div className={`tc-pin${failed ? ' kiosk-pin--error' : ''}`} aria-label={`${pin.digits.length} of ${PIN_LENGTH} digits entered`}>
          {Array.from({ length: PIN_LENGTH }, (_, i) => <span key={i} className={`tc-pin__dot${i < pin.digits.length || failed ? ' tc-pin__dot--on' : ''}`} />)}
        </div>
      )}
      {message && <div className="kiosk-pay__err" role="alert">{message}</div>}
      <Keypad size={56} disabled={locked || checking} busy={checking} onDigit={(d) => void press(d)} onBack={() => setPin(backspace(pin))} />
      <button type="button" className="tc-btn tc-btn--secondary" onClick={onCancel}>Cancel</button>
    </div>
  )
}

function MonthScreen({ emp, today, onBack, onAdd }: { emp: Employee; today: string; onBack: () => void; onAdd: () => void }) {
  const ym = today.slice(0, 7)
  const last = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()
  const [load, setLoad] = useState<{ status: 'loading' | 'ok' | 'failed'; payments: Payment[] }>({ status: 'loading', payments: [] })

  // Always read fresh, never from a saved copy: a stale total could invite logging a payment twice.
  useEffect(() => {
    let alive = true
    store
      .listPaymentsForEmployeeRange(emp.id, `${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`)
      .then((payments) => alive && setLoad({ status: 'ok', payments }))
      .catch(() => alive && setLoad({ status: 'failed', payments: [] }))
    return () => {
      alive = false
    }
  }, [emp.id, ym, last])

  const own = load.payments.filter((p) => p.entered_by === 'employee')
  const total = own.reduce((s, p) => s + Number(p.amount), 0)
  const days = (groupByEmployeeDate(load.payments) as { date: string; payments: Payment[] }[]).sort((a, b) => b.date.localeCompare(a.date))
  const monthLabel = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <div className="kiosk-pay__screen">
      <button type="button" className="tc-btn tc-btn--quiet" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={onBack}>‹ Back</button>
      <div className="kiosk-pay__who">
        <div className="kiosk-pay__avatar kiosk-pay__avatar--sm"><Avatar emp={emp} /></div>
        <div><div className="heading">{emp.name}</div><div className="caption kiosk-muted">{monthLabel}</div></div>
      </div>
      <div className="tc-stat" style={{ background: 'var(--sunken)', borderColor: 'transparent' }}>
        <span className="tc-stat__label">Logged this month</span>
        <span className="stat">{load.status === 'ok' ? fmtCurrency(total) : '—'}</span>
      </div>
      {load.status === 'failed' && (
        <div className="tc-callout tc-callout--alert" role="alert">
          <span className="tc-stamp tc-stamp--alert">Not loaded</span>
          <p>Couldn’t load your payments. Payments needs internet. Check the Wi-Fi.</p>
        </div>
      )}
      {load.status === 'ok' && (
        <>
          <div className="label kiosk-muted">This month's entries</div>
          {days.length === 0 ? (
            <p className="body kiosk-muted" style={{ margin: 0 }}>No payments logged yet this month.</p>
          ) : (
            <div className="kiosk-pay__list">
              {days.map((d) => {
                const mine = d.payments.filter((p) => p.entered_by === 'employee')
                return (
                  <div key={d.date} className="kiosk-pay__row">
                    <span className="body-strong">{longDate(d.date)}</span>
                    {mine.length ? <span className="time kiosk-muted">{mine.map((p) => fmtCurrency(p.amount)).join(' + ')}</span> : <span className="body kiosk-muted">Not yet logged by you</span>}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
      <button type="button" className="tc-btn tc-btn--primary tc-btn--kiosk" style={{ marginTop: 'auto' }} onClick={onAdd}>Add a payment</button>
    </div>
  )
}

function AddScreen({ emp, today, onBack, onSaved }: { emp: Employee; today: string; onBack: () => void; onSaved: (s: PaymentSaved) => void }) {
  const [digits, setDigits] = useState('')
  const [date, setDate] = useState(today)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  // The last Save. Retrying the same amount and date reuses its id, so a save whose answer was lost
  // cannot be recorded twice; a changed amount or date is a different payment and gets a new id.
  const attempt = useRef<{ id: string; amount: number; date: string } | null>(null)

  async function save() {
    if (saving) return
    const amount = Number(digits)
    if (!amount) return setError('Enter an amount.')
    if (!date) return setError('Pick a date.')
    if (attempt.current?.amount !== amount || attempt.current?.date !== date) attempt.current = { id: crypto.randomUUID(), amount, date }
    setSaving(true)
    setError('')
    try {
      await store.addPayment(emp.id, amount, date, 'employee', attempt.current.id)
      hapticSuccess()
      onSaved({ name: emp.name, amount, date })
    } catch {
      setError("Couldn't save. Check Wi-Fi and try again.")
      setSaving(false)
    }
  }

  return (
    <div className="kiosk-pay__screen kiosk-pay__screen--center">
      <button type="button" className="tc-btn tc-btn--quiet" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={onBack}>‹ Back</button>
      <h2 className="title-2" style={{ margin: 0, alignSelf: 'flex-start' }}>How much did you receive?</h2>
      <div className="tc-amount" aria-live="polite"><span style={{ color: 'var(--ink-muted)' }}>₹</span><span>{groupAmount(digits)}</span></div>
      <div className="tc-field" style={{ width: '100%' }}>
        <label className="tc-field__label" htmlFor="pay-date">Date</label>
        <input id="pay-date" className="tc-field__input tc-field__input--time" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <Keypad size={56} onDigit={(d) => { setDigits(pressAmountDigit(digits, d)); setError('') }} onBack={() => setDigits(backspaceAmount(digits))} />
      {error && <div className="kiosk-pay__err" role="alert">{error}</div>}
      <button type="button" className="tc-btn tc-btn--primary tc-btn--kiosk" style={{ width: '100%', marginTop: 'auto' }} disabled={saving} onClick={() => void save()}>Save payment</button>
    </div>
  )
}
