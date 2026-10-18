import { describe, expect, it, vi } from 'vitest'
import type { Employee, RecordRow } from '../data/types'
import { isInCooldown, performPunch } from './punch'

const emp: Employee = { id: 'e1', name: 'Faizan', active: true, avatar: null }
const photo = new Blob(['x'], { type: 'image/jpeg' })
const now = new Date('2026-10-13T09:00:00')
const iso = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60000).toISOString()
const open: RecordRow = {
  id: 'r1', emp_id: 'e1', date: '2026-10-13', clock_in: iso(300), clock_out: null,
  in_photo: null, out_photo: null, lunch_paid: false, created_at: iso(300),
  edited_at: null, orig_clock_in: null, orig_clock_out: null,
}

function fakeStore() {
  return {
    clockIn: vi.fn(async (): Promise<RecordRow> => ({ ...open, id: 'new', clock_in: now.toISOString() })),
    clockOut: vi.fn(async () => {}),
  }
}

describe('performPunch', () => {
  it('clocks in when there is no open session', async () => {
    const store = fakeStore()
    const out = await performPunch({ emp, photo, open: undefined, lastPunchIso: undefined, store, now })
    expect(out.kind).toBe('in')
    expect(store.clockIn).toHaveBeenCalledWith('e1', photo)
  })

  it('clocks out when a session is open', async () => {
    const store = fakeStore()
    const out = await performPunch({ emp, photo, open, lastPunchIso: iso(300), store, now })
    expect(out.kind).toBe('out')
    expect(store.clockOut).toHaveBeenCalledWith(open, photo)
  })

  it('answers a tap inside the 2-minute window instead of recording it (just clocked in)', async () => {
    const store = fakeStore()
    const out = await performPunch({ emp, photo, open, lastPunchIso: iso(1), store, now })
    expect(out).toEqual({ kind: 'repeat', direction: 'in', at: iso(1) })
    expect(store.clockIn).not.toHaveBeenCalled()
    expect(store.clockOut).not.toHaveBeenCalled()
  })

  it('answers a tap inside the window after a clock-out too (the costlier direction)', async () => {
    const store = fakeStore()
    const out = await performPunch({ emp, photo, open: undefined, lastPunchIso: iso(1), store, now })
    expect(out).toEqual({ kind: 'repeat', direction: 'out', at: iso(1) })
    expect(store.clockIn).not.toHaveBeenCalled()
  })

  it('records again once the window has passed', async () => {
    const store = fakeStore()
    const out = await performPunch({ emp, photo, open: undefined, lastPunchIso: iso(3), store, now })
    expect(out.kind).toBe('in')
  })

  it('lets the failure out so the camera dialog can show it and nothing is half-recorded', async () => {
    const store = fakeStore()
    store.clockOut.mockRejectedValueOnce(new Error('already closed'))
    await expect(performPunch({ emp, photo, open, lastPunchIso: undefined, store, now })).rejects.toThrow('already closed')
  })
})

describe('isInCooldown', () => {
  it('never locks on a punch dated in the future', () => {
    expect(isInCooldown(new Date(now.getTime() + 3600000).toISOString(), now)).toBe(false)
  })
  it('is false with no previous punch', () => {
    expect(isInCooldown(undefined, now)).toBe(false)
  })
})

describe('repeatTap', () => {
  it('is null for a real punch and answers a repeat in the right direction', async () => {
    const { repeatTap } = await import('./punch')
    expect(repeatTap(open, iso(300), now)).toBeNull()
    expect(repeatTap(open, iso(1), now)?.direction).toBe('in')
    expect(repeatTap(undefined, iso(1), now)?.direction).toBe('out')
  })
})
