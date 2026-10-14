import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isMissedClockIn } from '@legacy/missedClockIn.js'
import { endOfDayFor, shouldAutoCloseStaleSession } from '@legacy/staleSession.js'
import { latestPunchByEmployee } from '@legacy/punchCooldown.js'
import { queryCache } from '../data/queryCache'
import { store } from '../data/store'
import type { Employee, RecordRow, SyncStatus } from '../data/types'
import { useCachedQuery } from '../data/useCachedQuery'
import { dateKey, fmtDateLong, fmtTime, initials } from '../format'
import { CameraDialog, type CapturePhoto } from './CameraDialog'
import { EmployeeTile } from './EmployeeTile'
import { performPunch, repeatTap } from './punch'
import { PunchConfirm, type Confirmation } from './PunchConfirm'
import { useNow } from './useNow'
import './kiosk.css'

const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev'

const SYNC_TEXT = (s: SyncStatus): { text: string; cls: string } => {
  if (!s.pending) return { text: 'All punches saved', cls: 'tc-sync' }
  const n = `${s.pending} punch${s.pending > 1 ? 'es' : ''}`
  if (s.stuck) return { text: s.signedOut ? `${n} waiting, the admin must sign in again` : `${n} pending, check Wi-Fi`, cls: 'tc-sync tc-sync--stuck' }
  return { text: `Syncing ${s.pending}…`, cls: 'tc-sync tc-sync--pending' }
}

interface Pending {
  emp: Employee
  action: 'in' | 'out'
  photoUrl: string | null
}

export interface KioskProps {
  /** The Admin access button. Without it the button says admin isn't built (used by tests). */
  onAdminAccess?: () => void
  /** Injected in tests. */
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>
  capture?: CapturePhoto
}

export function Kiosk({ mediaDevices, capture, onAdminAccess }: KioskProps) {
  const clock = useNow(1000)
  const tick = useNow(5000) // the 5s cadence the live kiosk uses for stale-close and missed-clock-in
  const today = dateKey(tick)
  const mountedAt = useRef(Date.now()).current

  // Each read draws from the saved copy on the first render and refreshes behind it.
  const employees = useCachedQuery<Employee[]>('employees', () => store.listEmployees())
  const openQ = useCachedQuery<Record<string, RecordRow>>('openSessions', () => store.listOpenSessions())
  const recordsKey = `records:${today}`
  const todaysQ = useCachedQuery<RecordRow[]>(recordsKey, () => store.listRecordsForDate(today))

  const active = useMemo(() => (employees.data ?? []).filter((e) => e.active), [employees.data])
  const open = useMemo(() => openQ.data ?? {}, [openQ.data])
  const todays = useMemo(() => todaysQ.data ?? [], [todaysQ.data])
  const punchedToday = useMemo(() => new Set(todays.map((r) => r.emp_id)), [todays])
  const lastPunchAt = useMemo(() => latestPunchByEmployee(todays) as Record<string, string>, [todays])

  const [pending, setPending] = useState<Pending | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sync, setSync] = useState<SyncStatus>({ pending: 0, stuck: false, signedOut: false })

  const announce = useCallback((msg: string) => setNotice(msg), [])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 3200)
    return () => clearTimeout(t)
  }, [notice])

  // Sync indicator: hidden state is "All punches saved", so it never distracts at a tap.
  useEffect(() => {
    let alive = true
    const poll = () =>
      store.getSyncStatus().then((s) => alive && setSync(s)).catch(() => {})
    void poll()
    const id = setInterval(poll, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  // The one automatic clock-out: a session left open from a previous day is closed at midnight.
  // Only acts on data fetched in this session, never on the saved copy alone, so a stale cache
  // from an earlier day cannot close anything.
  const closing = useRef(new Set<string>())
  const openFresh = openQ.updatedAt !== null && openQ.updatedAt >= mountedAt
  useEffect(() => {
    if (!openFresh) return
    for (const rec of Object.values(open)) {
      if (!shouldAutoCloseStaleSession(rec, tick) || closing.current.has(rec.id)) continue
      closing.current.add(rec.id)
      store
        .clockOut(rec, null, endOfDayFor(rec).toISOString())
        .then(() => {
          const next = { ...(queryCache.peek<Record<string, RecordRow>>('openSessions').data ?? {}) }
          delete next[rec.emp_id]
          queryCache.write('openSessions', next)
        })
        .catch((err) => {
          // Silent safety net: leave it open and retry on a later tick, no toast.
          closing.current.delete(rec.id)
          console.error('Stale-session auto-close failed for record', rec.id, err)
        })
    }
  }, [open, openFresh, tick])

  const onTapTile = useCallback(
    (emp: Employee, photoUrl: string | null) => {
      const o = open[emp.id]
      // A repeat tap inside the window never opens the camera: it is answered, nothing recorded.
      const repeat = repeatTap(o, lastPunchAt[emp.id], new Date())
      if (repeat) {
        setConfirmation({ kind: repeat.direction === 'in' ? 'repeat-in' : 'repeat-out', name: emp.name, at: repeat.at, photoUrl, initials: initials(emp.name) })
        return
      }
      setPending({ emp, action: o ? 'out' : 'in', photoUrl })
    },
    [open, lastPunchAt],
  )

  const onCapture = useCallback(
    async (photo: Blob) => {
      if (!pending) return
      const { emp, photoUrl } = pending
      const o = open[emp.id]
      let outcome
      try {
        outcome = await performPunch({ emp, photo, open: o, lastPunchIso: lastPunchAt[emp.id], store })
      } catch (err) {
        // The tile may have been showing stale data: resync quietly, then let the dialog show why.
        void openQ.refetch()
        void todaysQ.refetch()
        throw err
      }
      setPending(null)
      // The punch is saved. Nothing below may throw out of here: the dialog would read it as a
      // failed punch and a retry would record the opposite one.
      try {
        const photoObjectUrl = URL.createObjectURL(photo)
        if (outcome.kind === 'repeat') {
          setConfirmation({ kind: outcome.direction === 'in' ? 'repeat-in' : 'repeat-out', name: emp.name, at: outcome.at, photoUrl, initials: initials(emp.name) })
          return
        }
        const nextOpen = { ...(queryCache.peek<Record<string, RecordRow>>('openSessions').data ?? {}) }
        const nextToday = [...(queryCache.peek<RecordRow[]>(recordsKey).data ?? [])]
        if (outcome.kind === 'in') {
          nextOpen[emp.id] = outcome.record
          nextToday.push(outcome.record)
        } else {
          delete nextOpen[emp.id]
          const i = nextToday.findIndex((r) => r.id === outcome.closed.id)
          const closed = { ...outcome.closed, clock_out: outcome.at }
          if (i >= 0) nextToday[i] = closed
          else nextToday.push(closed)
        }
        queryCache.write('openSessions', nextOpen)
        queryCache.write(recordsKey, nextToday)
        setConfirmation({
          kind: outcome.kind,
          name: emp.name,
          at: outcome.at,
          worked: outcome.kind === 'out' ? (new Date(outcome.at).getTime() - new Date(outcome.closed.clock_in).getTime()) / 3600000 : undefined,
          photoUrl: photoObjectUrl,
          initials: initials(emp.name),
        })
        void openQ.refetch()
        void todaysQ.refetch()
      } catch (err) {
        console.error('Punch saved, but showing the confirmation failed', err)
      }
    },
    [pending, open, lastPunchAt, recordsKey, openQ, todaysQ],
  )

  const inCount = active.filter((e) => open[e.id]).length
  const missedCount = active.filter((e) => !open[e.id] && isMissedClockIn(punchedToday.has(e.id), tick)).length
  const syncView = SYNC_TEXT(sync)
  const theme = useMemo(() => {
    try {
      return localStorage.getItem('tc2:theme') === 'dark' ? 'dark' : 'light'
    } catch {
      return 'light'
    }
  }, [])

  return (
    <div className="kiosk" data-theme={theme}>
      <aside className="kiosk-side">
        <div className="kiosk-side__top">
          <div className="kiosk-side__id">
            <div className="title-2">Unitech Attendance</div>
            {active.length > 0 && (
              <div className="label kiosk-roster">
                <span className="kiosk-roster__dot" />
                {inCount} of {active.length} clocked in
                {missedCount > 0 && ` · ${missedCount} ${missedCount > 1 ? "haven't" : "hasn't"} shown up`}
              </div>
            )}
          </div>
          <div className="kiosk-clock">
            <div className="clock">{fmtTime(clock)}</div>
            <div className="body-strong kiosk-muted">{fmtDateLong(clock)}</div>
          </div>
        </div>

        <div className="kiosk-side__bottom">
          {/* Not built in 2.0 yet (plan step 2, payments flow). Says so on use rather than looking dead. */}
          <button type="button" className="tc-btn tc-btn--secondary tc-btn--kiosk" style={{ width: '100%' }} onClick={() => announce("Payments isn't built in 2.0 yet.")}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <circle cx="12" cy="12" r="2.5" />
              <path d="M6 12h.01M18 12h.01" />
            </svg>
            Payments
          </button>
          <div className="kiosk-side__meta">
            <button type="button" className="tc-btn tc-btn--quiet" style={{ padding: 0 }} onClick={() => (onAdminAccess ? onAdminAccess() : announce("Admin isn't built in 2.0 yet."))}>Admin access</button>
            <span className="caption kiosk-version">v {APP_VERSION}</span>
          </div>
          <div className={syncView.cls} role="status"><span className="tc-sync__dot" />{syncView.text}</div>
        </div>
      </aside>

      <main className="kiosk-main">
        <div className="heading kiosk-muted">Tap your name to clock in or out</div>
        <div className="kiosk-grid">
          {active.map((e) => (
            <EmployeeTile key={e.id} emp={e} open={open[e.id]} onTap={onTapTile} />
          ))}
        </div>
        {/* The design does not draw an empty roster; this is the live app's wording, pending a decision. */}
        {employees.data && active.length === 0 && <p className="kiosk-empty">No employees yet. Ask the admin to add them.</p>}
      </main>

      {pending && (
        <CameraDialog
          key={pending.emp.id}
          name={pending.emp.name}
          action={pending.action}
          onCapture={onCapture}
          onCancel={() => setPending(null)}
          mediaDevices={mediaDevices}
          capture={capture}
        />
      )}
      {confirmation && <PunchConfirm c={confirmation} onDone={() => setConfirmation(null)} />}
      {notice && <div className="tc-toast kiosk-toast" role="status">{notice}</div>}
    </div>
  )
}
