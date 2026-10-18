import { useMemo, useState } from 'react'
import { generateSalt, hashPin } from '@legacy/pin.js'
import { refreshKioskData } from '../../data/invalidate'
import { store } from '../../data/store'
import type { Employee, RecordRow } from '../../data/types'
import { useCachedQuery } from '../../data/useCachedQuery'
import { dateKey } from '../../format'
import { CameraDialog, type CapturePhoto } from '../../kiosk/CameraDialog'
import { useNow } from '../../kiosk/useNow'
import { Avatar } from '../../ui/Avatar'
import { useSheets } from '../../ui/Sheets'
import { rateForm } from '../forms'
import { buildLedger } from '../month/paymentsModel'
import { useMonthData } from '../month/useMonthData'
import { PersonPage } from './PersonPage'
import { countLine, hasPin, orderPeople, pinProblem, rowSub } from './peopleModel'

interface Props {
  onNotice: (msg: string) => void
  /** Back to the kiosk, locking admin again. */
  onLock: () => void
  /** Called after the owner confirms; the app signs the tablet out. */
  onSignOut: () => void
  /** Injected in tests. */
  nowOverride?: Date
  mediaDevices?: Pick<MediaDevices, 'getUserMedia'>
  capture?: CapturePhoto
}

export function PeopleScreen({ onNotice, onLock, onSignOut, nowOverride, mediaDevices, capture }: Props) {
  const sheets = useSheets()
  const tick = useNow(30000)
  const now = nowOverride ?? tick
  const today = dateKey(now)
  const ym = today.slice(0, 7)

  const data = useMonthData(ym, today)
  const openQ = useCachedQuery<Record<string, RecordRow>>('openSessions', () => store.listOpenSessions())
  const people = useMemo(() => orderPeople(data.employees ?? []), [data.employees])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [camera, setCamera] = useState<Employee | null>(null)
  const selected = people.find((e) => e.id === selectedId) ?? null

  const ledger = useMemo(() => (data.payments ? buildLedger(data.payments, data.resolutions, data.employees ?? []) : null), [data.payments, data.resolutions, data.employees])
  const monthLabel = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  /** Runs a write, then re-reads what it may have changed (and the kiosk's copy of the roster). */
  async function attempt(fn: () => Promise<void>, alsoRates = false) {
    try {
      await fn()
      await Promise.all([data.refetchEmployees(), alsoRates ? data.refetchAttendance() : Promise.resolve()])
      void refreshKioskData(now)
    } catch (err) {
      onNotice(`Failed: ${(err as Error).message}`)
    }
  }

  async function addPerson() {
    const v = await sheets.prompt({
      title: 'Add a person',
      submitLabel: 'Add',
      fields: [{ name: 'name', label: 'Employee name', help: 'After you add them the camera opens for their profile photo. You can skip it and add the photo later.' }],
    })
    if (!v) return
    const result: { emp?: Employee } = {}
    await attempt(async () => {
      result.emp = await store.addEmployee(v.name)
    })
    if (result.emp) {
      setSelectedId(result.emp.id)
      setCamera(result.emp)
    }
  }

  async function saveAvatar(emp: Employee, blob: Blob) {
    // A new file name per retake: the kiosk keeps a tile's picture for as long as the avatar path is
    // unchanged, so a changed path is how every device learns there is a new one.
    const path = `${emp.id}/avatar-${Date.now()}.jpg`
    await store.uploadPhoto(path, blob)
    await store.setEmployeeAvatar(emp.id, path)
    await data.refetchEmployees()
    void refreshKioskData(now)
    setCamera(null)
    onNotice(`Photo saved for ${emp.name}`)
  }

  async function rename(emp: Employee) {
    const v = await sheets.prompt({ title: 'Rename employee', fields: [{ name: 'name', label: 'Employee name', value: emp.name }] })
    if (v) await attempt(() => store.renameEmployee(emp.id, v.name))
  }

  async function setPin(emp: Employee) {
    const v = await sheets.prompt({
      title: `${hasPin(emp) ? 'Reset' : 'Set'} PIN for ${emp.name}`,
      fields: [{ name: 'pin', label: '4-digit PIN', type: 'text', inputMode: 'numeric', maxLength: 4, placeholder: 'e.g. 4821' }],
      validate: (vals) => {
        const problem = pinProblem(vals.pin)
        return problem ? { field: 'pin', message: problem } : null
      },
    })
    if (!v) return
    await attempt(async () => {
      const salt = generateSalt() as string
      await store.setEmployeePin(emp.id, (await hashPin(v.pin, salt)) as string, salt)
      onNotice(`PIN set for ${emp.name}.`)
    })
  }

  async function changeRate(emp: Employee) {
    const current = data.lines.find((l) => l.emp.id === emp.id)?.rate?.monthly ?? null
    const v = await sheets.prompt(rateForm(emp.name, current, today))
    if (!v) return
    await attempt(async () => {
      await store.setSalaryRate(emp.id, { monthlySalary: Number(v.amount), effectiveFrom: v.effectiveFrom })
      onNotice(`Salary updated for ${emp.name}`)
    }, true)
  }

  async function signOut() {
    const v = await sheets.prompt({
      title: 'Sign out?',
      note: ['The tablet will need the password to use the app again.'],
      submitLabel: 'Sign out',
      danger: true,
      fields: [],
    })
    if (v) onSignOut()
  }

  const clockedIn = (e: Employee) => !!openQ.data?.[e.id]

  return (
    <div className={`people${selected ? ' people--detail' : ''}`}>
      <header className="people__header">
        <h1 className="title-1" style={{ margin: 0 }}>People</h1>
        <div className="people__actions">
          <button type="button" className="tc-btn tc-btn--quiet" onClick={onLock}>Lock admin</button>
          <button type="button" className="tc-btn tc-btn--quiet" onClick={() => void signOut()}>Sign out</button>
          <span className="people__divider" aria-hidden="true" />
          <button type="button" className="tc-btn tc-btn--primary" onClick={() => void addPerson()}>Add a person</button>
        </div>
      </header>

      <div className="people__cols">
        <section className="people__list">
          <div className="caption app-muted">{countLine(people)}</div>
          {data.employees && people.length === 0 && <p className="body app-muted days__empty">No people yet. Add the first person.</p>}
          {!data.employees && <p className="body app-muted days__empty">Loading…</p>}
          {people.length > 0 && (
            <div className="tc-queue" role="list">
              {people.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  role="listitem"
                  className={`tc-queue__row${e.active ? '' : ' people__row--off'}`}
                  aria-pressed={e.id === selectedId}
                  onClick={() => setSelectedId(e.id)}
                >
                  <Avatar emp={e} />
                  <div>
                    <div className="tc-queue__title">{e.name}</div>
                    <div className="tc-queue__sub">{rowSub(e)}</div>
                  </div>
                  {!e.active ? <span className="tc-stamp tc-stamp--neutral">Inactive</span> : !hasPin(e) ? <span className="tc-stamp tc-stamp--attention">Set PIN</span> : <span />}
                  <span />
                </button>
              ))}
            </div>
          )}
        </section>

        {selected ? (
          <PersonPage
            emp={selected}
            month={data.model?.people.find((p) => p.emp.id === selected.id) ?? null}
            line={data.lines.find((l) => l.emp.id === selected.id) ?? null}
            payments={{ loaded: !!ledger, person: ledger?.people.find((p) => p.empId === selected.id) ?? null }}
            monthLabel={monthLabel}
            clockedIn={clockedIn(selected)}
            onBack={() => setSelectedId(null)}
            actions={{
              retakePhoto: () => setCamera(selected),
              rename: () => void rename(selected),
              setPin: () => void setPin(selected),
              changeRate: () => void changeRate(selected),
              toggleActive: () =>
                void attempt(async () => {
                  // Deactivating someone mid-shift would orphan their open session: the kiosk only shows active people.
                  if (selected.active && clockedIn(selected)) throw new Error(`${selected.name} is currently clocked in. Clock them out before deactivating.`)
                  await store.setEmployeeActive(selected.id, !selected.active)
                }),
            }}
          />
        ) : (
          <div className="days__none body app-muted people__none">Pick a person to see their details.</div>
        )}
      </div>

      {camera && (
        <CameraDialog
          key={camera.id}
          name={camera.name}
          action="avatar"
          onCapture={(blob) => saveAvatar(camera, blob)}
          onCancel={() => setCamera(null)}
          mediaDevices={mediaDevices}
          capture={capture}
        />
      )}
    </div>
  )
}
