import type { Employee } from '../../data/types'

export const PIN_PROBLEM = 'PIN must be exactly 4 digits.'

/** Typed as text, never a number input: a number field drops a leading zero, so "0192" could never be set. */
export const pinProblem = (pin: string): string | null => (/^\d{4}$/.test(pin) ? null : PIN_PROBLEM)

export const hasPin = (e: Pick<Employee, 'pin_hash'>) => !!e.pin_hash

/** Active people first, each group by name, so the kiosk's roster is the top of the list. */
export function orderPeople(list: Employee[]): Employee[] {
  const byName = (a: Employee, b: Employee) => a.name.localeCompare(b.name)
  return [...list.filter((e) => e.active).sort(byName), ...list.filter((e) => !e.active).sort(byName)]
}

export function countLine(list: Employee[]): string {
  if (!list.length) return ''
  const inactive = list.filter((e) => !e.active).length
  return `${list.length} total${inactive ? ` · ${inactive} inactive` : ''}`
}

export function rowSub(e: Employee): string {
  return !e.active ? 'Inactive · not on the kiosk · history kept' : hasPin(e) ? 'PIN set' : 'No PIN yet'
}

/** "1 Jan 2026" */
export function fmtDateYear(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
