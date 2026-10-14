import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryCache } from '../data/queryCache'
import { store } from '../data/store'
import type { Employee, RecordRow } from '../data/types'
import { dateKey } from '../format'
import { Kiosk } from './Kiosk'

const emps: Employee[] = [
  { id: 'e1', name: 'Faizan', active: true, avatar: null },
  { id: 'e2', name: 'Imran', active: true, avatar: null },
  { id: 'e3', name: 'Hamza', active: false, avatar: null },
]
const rec = (over: Partial<RecordRow>): RecordRow => ({
  id: 'r', emp_id: 'e1', date: dateKey(), clock_in: new Date().toISOString(), clock_out: null,
  in_photo: null, out_photo: null, lunch_paid: false, created_at: new Date().toISOString(),
  edited_at: null, orig_clock_in: null, orig_clock_out: null, ...over,
})

const fakeStream = () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream
const camera = { getUserMedia: vi.fn(async () => fakeStream()) }
const goodPhoto = async () => new Blob(['jpg'], { type: 'image/jpeg' })

function seed(key: string, value: unknown) {
  queryCache.write(key, value)
}

beforeEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})
afterEach(() => vi.restoreAllMocks())

function neverAnswering() {
  vi.spyOn(store, 'listEmployees').mockReturnValue(new Promise(() => {}))
  vi.spyOn(store, 'listOpenSessions').mockReturnValue(new Promise(() => {}))
  vi.spyOn(store, 'listRecordsForDate').mockReturnValue(new Promise(() => {}))
  vi.spyOn(store, 'getSyncStatus').mockResolvedValue({ pending: 0, stuck: false, signedOut: false })
}

describe('Kiosk · offline cold boot', () => {
  it('draws the roster and who is clocked in on the first paint with no network answer', () => {
    seed('employees', emps)
    seed('openSessions', { e1: rec({ id: 'r1', emp_id: 'e1', clock_in: new Date(2026, 9, 13, 9, 30).toISOString() }) })
    seed(`records:${dateKey()}`, [rec({ id: 'r1', emp_id: 'e1' })])
    neverAnswering()
    render(<Kiosk mediaDevices={camera} capture={goodPhoto} />)
    expect(screen.getByRole('button', { name: /Faizan/ })).toHaveTextContent('Working since 9:30 AM')
    expect(screen.getByRole('button', { name: /Imran/ })).toHaveTextContent('Tap to clock in')
    expect(screen.queryByText('Hamza')).toBeNull() // deactivated people are not on the kiosk
    expect(screen.getByText(/1 of 2 clocked in/)).toBeInTheDocument()
  })
})

describe('Kiosk · punch flow', () => {
  function bootWithImran() {
    seed('employees', emps)
    seed('openSessions', {})
    seed(`records:${dateKey()}`, [])
    vi.spyOn(store, 'listEmployees').mockResolvedValue(emps)
    vi.spyOn(store, 'listOpenSessions').mockResolvedValue({})
    vi.spyOn(store, 'listRecordsForDate').mockResolvedValue([])
    vi.spyOn(store, 'getSyncStatus').mockResolvedValue({ pending: 0, stuck: false, signedOut: false })
  }

  it('opens the camera, records a clock-in, shows the confirmation, and answers a second tap', async () => {
    bootWithImran()
    const clockIn = vi.spyOn(store, 'clockIn').mockImplementation(async (empId) => rec({ id: 'new', emp_id: empId }))
    render(<Kiosk mediaDevices={camera} capture={goodPhoto} />)
    await act(async () => {})

    fireEvent.click(screen.getByRole('button', { name: /Imran/ }))
    expect(await screen.findByText('Clock in, Imran?')).toBeInTheDocument()

    const shutter = screen.getByRole('button', { name: 'Take photo' })
    expect(shutter).toBeDisabled() // no frame decoded yet
    const video = document.querySelector('video')!
    await act(async () => { fireEvent.loadedData(video) })
    expect(shutter).toBeEnabled()

    await act(async () => { fireEvent.click(shutter) })
    expect(clockIn).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Clocked in')).toBeInTheDocument()
    expect(screen.queryByText('Clock in, Imran?')).toBeNull()

    // tap again inside the 2-minute window: answered, never recorded, no camera
    fireEvent.click(document.querySelector('.kiosk-confirm')!)
    expect(document.querySelector('.kiosk-confirm')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Imran/ }))
    expect(screen.getByText('Already clocked in')).toBeInTheDocument()
    expect(clockIn).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Clock in, Imran?')).toBeNull()
  })

  it('keeps the dialog open with the reason when the punch fails, and records nothing twice', async () => {
    bootWithImran()
    vi.spyOn(store, 'clockIn').mockRejectedValue(new Error('disk full'))
    render(<Kiosk mediaDevices={camera} capture={goodPhoto} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Faizan/ }))
    await act(async () => { fireEvent.loadedData(document.querySelector('video')!) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Take photo' })) })
    expect(screen.getByText('Failed: disk full — try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled()
  })

  it('refuses a photo that did not come out and writes no punch', async () => {
    bootWithImran()
    const clockIn = vi.spyOn(store, 'clockIn')
    render(<Kiosk mediaDevices={camera} capture={async () => null} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Faizan/ }))
    await act(async () => { fireEvent.loadedData(document.querySelector('video')!) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Take photo' })) })
    expect(screen.getByText("Photo didn't come out. Tap Take photo again.")).toBeInTheDocument()
    expect(clockIn).not.toHaveBeenCalled()
  })

  it('says so when the camera permission is denied', async () => {
    bootWithImran()
    const denied = { getUserMedia: vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' }))) }
    render(<Kiosk mediaDevices={denied} capture={goodPhoto} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Faizan/ }))
    expect(await screen.findByText('Camera unavailable: permission was denied.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled()
  })

  it('closes a clock-out with the worked time', async () => {
    seed('employees', emps)
    const started = new Date(Date.now() - (4 * 60 + 2) * 60000).toISOString()
    const open = rec({ id: 'r9', emp_id: 'e2', clock_in: started })
    seed('openSessions', { e2: open })
    seed(`records:${dateKey()}`, [open])
    vi.spyOn(store, 'listEmployees').mockResolvedValue(emps)
    vi.spyOn(store, 'listOpenSessions').mockResolvedValue({ e2: open })
    vi.spyOn(store, 'listRecordsForDate').mockResolvedValue([open])
    vi.spyOn(store, 'getSyncStatus').mockResolvedValue({ pending: 0, stuck: false, signedOut: false })
    const clockOut = vi.spyOn(store, 'clockOut').mockResolvedValue(undefined)
    render(<Kiosk mediaDevices={camera} capture={goodPhoto} />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: /Imran/ }))
    await act(async () => { fireEvent.loadedData(document.querySelector('video')!) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Take photo' })) })
    expect(clockOut).toHaveBeenCalledTimes(1)
    const card = screen.getByText('Clocked out').closest('.tc-confirm') as HTMLElement
    expect(within(card).getByText(/Worked 4:0[12] hrs today/)).toBeInTheDocument()
  })
})

describe('Kiosk · side panel', () => {
  it('says what is not built yet instead of looking dead', async () => {
    seed('employees', emps)
    neverAnswering()
    render(<Kiosk mediaDevices={camera} capture={goodPhoto} />)
    fireEvent.click(screen.getByRole('button', { name: 'Payments' }))
    expect(screen.getByText("Payments isn't built in 2.0 yet.")).toBeInTheDocument()
  })

  it('shows the sync state in the design wording', async () => {
    seed('employees', emps)
    neverAnswering()
    vi.spyOn(store, 'getSyncStatus').mockResolvedValue({ pending: 2, stuck: true, signedOut: false })
    render(<Kiosk mediaDevices={camera} capture={goodPhoto} />)
    expect(await screen.findByText('2 punches pending, check Wi-Fi')).toBeInTheDocument()
  })
})
