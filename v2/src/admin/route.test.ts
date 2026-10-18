import { describe, expect, it } from 'vitest'
import { hashFor, parseHash } from './route'

describe('route', () => {
  it('parses admin tabs and a day', () => {
    expect(parseHash('#/admin')).toEqual({ view: 'admin', tab: 'days' })
    expect(parseHash('#/admin/month')).toEqual({ view: 'admin', tab: 'month' })
    expect(parseHash('#/admin/days/2026-10-12')).toEqual({ view: 'admin', tab: 'days', date: '2026-10-12' })
    expect(parseHash('#/admin/days/2026-10-12/abc-1')).toEqual({ view: 'admin', tab: 'days', date: '2026-10-12', emp: 'abc-1' })
  })
  it('treats anything else as the kiosk', () => {
    expect(parseHash('')).toEqual({ view: 'kiosk' })
    expect(parseHash('#/admin/payroll')).toEqual({ view: 'kiosk' })
    expect(parseHash('#/admin/days/not-a-date')).toEqual({ view: 'kiosk' })
  })
  it('round-trips', () => {
    for (const h of ['#/', '#/admin/days', '#/admin/people', '#/admin/days/2026-10-12', '#/admin/days/2026-10-12/abc-1']) expect(hashFor(parseHash(h))).toBe(h)
  })
})
