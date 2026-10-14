import { describe, expect, it } from 'vitest'
import { trackPercent } from './Timeline'

const day = new Date(2026, 9, 13)
const at = (h: number, m = 0, plusDays = 0) => new Date(2026, 9, 13 + plusDays, h, m)

describe('trackPercent', () => {
  it('puts 8 AM at the left, 8 PM at the right and 2 PM in the middle', () => {
    expect(trackPercent(at(8), day)).toBe(0)
    expect(trackPercent(at(20), day)).toBe(100)
    expect(trackPercent(at(14), day)).toBe(50)
  })
  it('keeps a midnight close at the right-hand end, not back at the start', () => {
    expect(trackPercent(at(0, 0, 1), day)).toBe(100)
  })
  it('clips punches outside the track', () => {
    expect(trackPercent(at(6), day)).toBe(0)
    expect(trackPercent(at(22), day)).toBe(100)
  })
})
