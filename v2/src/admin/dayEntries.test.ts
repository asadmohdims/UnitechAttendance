import { describe, expect, it } from 'vitest'
import type { Employee, RecordRow } from '../data/types'
import { buildAttentionQueue, buildDayEntries } from './dayEntries'

const emp = (id: string, name: string, active = true): Employee => ({ id, name, active, avatar: null, created_at: '2026-01-01T00:00:00Z' })
const rec = (o: Partial<RecordRow> & Pick<RecordRow, 'id' | 'emp_id' | 'date' | 'clock_in'>): RecordRow => ({
  clock_out: null, in_photo: 'p', out_photo: 'p', lunch_paid: false, created_at: o.clock_in,
  edited_at: null, orig_clock_in: null, orig_clock_out: null, ...o,
})
const at = (date: string, h: number, m = 0) => new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString()
const now = new Date('2026-10-14T20:00:00')
const staff = [emp('a', 'Faizan'), emp('b', 'Imran'), emp('c', 'Hamza', false)]

describe('buildDayEntries', () => {
  it('gives a row to everyone active, and to an inactive person only if they have punches', () => {
    const records = [rec({ id: '1', emp_id: 'c', date: '2026-10-12', clock_in: at('2026-10-12', 9), clock_out: at('2026-10-12', 17) })]
    const names = buildDayEntries({ employees: staff, records, overtime: [], overrides: [], date: '2026-10-12', now }).map((e) => e.emp.name)
    expect(names.sort()).toEqual(['Faizan', 'Hamza', 'Imran'])
  })

  it('puts days that need a look first and keeps roster order within each group', () => {
    const d = '2026-10-12'
    const records = [
      rec({ id: '1', emp_id: 'a', date: d, clock_in: at(d, 9), clock_out: at(d, 13) }),
      rec({ id: '2', emp_id: 'a', date: d, clock_in: at(d, 14), clock_out: at(d, 18) }),
      // Imran: never clocked out on a past day
      rec({ id: '3', emp_id: 'b', date: d, clock_in: at(d, 9) }),
    ]
    const entries = buildDayEntries({ employees: staff, records, overtime: [], overrides: [], date: d, now })
    expect(entries[0].emp.name).toBe('Imran')
    expect(entries[0].model.chip?.id).toBe('needs-clock-out')
  })

  it('marks a day that has no punches as Absent once it is past', () => {
    const entries = buildDayEntries({ employees: [emp('a', 'Faizan')], records: [], overtime: [], overrides: [], date: '2026-10-12', now })
    expect(entries[0].model.chip?.id).toBe('absent')
  })

  it('leaves out a day that has not happened yet', () => {
    expect(buildDayEntries({ employees: [emp('a', 'Faizan')], records: [], overtime: [], overrides: [], date: '2026-10-20', now })).toEqual([])
  })
})

describe('buildAttentionQueue: one list for Month and Days', () => {
  it('lists a day closed without a clock-out photo, which has no chip of its own', () => {
    const records = [rec({ id: '1', emp_id: 'a', date: '2026-10-07', clock_in: at('2026-10-07', 9), clock_out: at('2026-10-07', 17), out_photo: null })]
    expect(buildAttentionQueue(staff, records, [], now).map((q) => [q.emp.name, q.chipId])).toEqual([['Faizan', 'no-photo']])
  })

  it('drops it once the owner has set the clock-out', () => {
    const records = [rec({ id: '1', emp_id: 'a', date: '2026-10-07', clock_in: at('2026-10-07', 9), clock_out: at('2026-10-07', 17), out_photo: null, edited_at: at('2026-10-14', 9), orig_clock_in: at('2026-10-07', 9), orig_clock_out: null })]
    expect(buildAttentionQueue(staff, records, [], now)).toEqual([])
  })

  it('does not list someone who is simply clocked in today', () => {
    const records = [rec({ id: '1', emp_id: 'a', date: '2026-10-14', clock_in: at('2026-10-14', 9), out_photo: null })]
    expect(buildAttentionQueue(staff, records, [], now)).toEqual([])
  })
})

describe('buildAttentionQueue', () => {
  it('lists missing clock-outs and punches to check, newest first, and nothing else', () => {
    const records = [
      rec({ id: '1', emp_id: 'a', date: '2026-10-09', clock_in: at('2026-10-09', 9), clock_out: at('2026-10-09', 9, 3) }), // 3-minute session
      rec({ id: '2', emp_id: 'b', date: '2026-10-12', clock_in: at('2026-10-12', 9) }), // never closed
      rec({ id: '3', emp_id: 'a', date: '2026-10-13', clock_in: at('2026-10-13', 9), clock_out: at('2026-10-13', 13) }),
      rec({ id: '4', emp_id: 'a', date: '2026-10-13', clock_in: at('2026-10-13', 14), clock_out: at('2026-10-13', 18) }), // fine
    ]
    const q = buildAttentionQueue(staff, records, [], now)
    expect(q.map((i) => `${i.date} ${i.emp.name} ${i.chipId}`)).toEqual([
      '2026-10-12 Imran needs-clock-out',
      '2026-10-09 Faizan check-punches',
    ])
  })
})
