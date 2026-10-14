import { describe, expect, it } from 'vitest'
import { defaultLunchWindow, MIN_SPLITTABLE_MS } from './lunchSplit'

const at = (h: number, m = 0) => new Date(2026, 9, 12, h, m)

describe('defaultLunchWindow', () => {
  it('centres an hour on the usual lunch time when it fits', () => {
    const { start, end } = defaultLunchWindow(at(9), at(18))
    expect(start).toEqual(at(12, 30))
    expect(end).toEqual(at(13, 30))
  })
  it('falls back to the midpoint for a shift that does not span lunch time', () => {
    const { start, end } = defaultLunchWindow(at(14), at(20))
    expect(start).toEqual(at(16, 30))
    expect(end).toEqual(at(17, 30))
  })
  it('needs more than an hour plus slivers to be splittable', () => {
    expect(MIN_SPLITTABLE_MS).toBe(70 * 60000)
  })
})
