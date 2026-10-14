import { store as legacyStore } from '@legacy/store/index.js'
import type {
  DayPayOverride,
  Employee,
  OvertimeRow,
  Payment,
  PaymentResolution,
  PinRecord,
  RecordRow,
  SalaryRate,
  SyncStatus,
} from './types'

/**
 * The one typed door to the legacy store. Every method returns a Promise, always: the demo store
 * returns plain values for most calls and the Supabase store returns promises, and calling
 * `.then` on the former throws. Wrapping each method in an async function also turns a
 * synchronous throw into a rejection, so callers have exactly one failure path.
 */
export interface Store {
  listEmployees(): Promise<Employee[]>
  addEmployee(name: string): Promise<Employee>
  renameEmployee(id: string, name: string): Promise<void>
  setEmployeeActive(id: string, active: boolean): Promise<void>
  setEmployeeAvatar(id: string, path: string): Promise<void>
  setEmployeePin(id: string, hash: string, salt: string): Promise<void>
  getEmployeePinRecord(id: string): Promise<PinRecord | null>

  listOpenSessions(): Promise<Record<string, RecordRow>>
  clockIn(empId: string, photo: Blob | null): Promise<RecordRow>
  clockOut(record: RecordRow, photo: Blob | null, atIso?: string): Promise<void>
  addManualRecord(empId: string, date: string, clockInIso: string, clockOutIso: string | null): Promise<RecordRow>
  listRecordsForDate(date: string): Promise<RecordRow[]>
  listRecordsForRange(startDate: string, endDate: string): Promise<RecordRow[]>
  updateRecordTimes(recordId: string, clockInIso: string, clockOutIsoOrNull: string | null): Promise<void>
  setLunchPaid(recordId: string, paid: boolean): Promise<void>
  splitSessionForLunch(recordId: string, lunchStartIso: string, lunchEndIso: string): Promise<void>
  deleteRecord(record: RecordRow): Promise<void>

  uploadPhoto(path: string, blob: Blob, opts?: { upsert?: boolean }): Promise<void>
  getPhotoUrl(path: string | null): Promise<string | null>
  getSyncStatus(): Promise<SyncStatus>

  listSalaryRates(empId: string): Promise<SalaryRate[]>
  setSalaryRate(empId: string, rate: { monthlySalary: number; effectiveFrom: string; note?: string }): Promise<void>
  listDayPayOverrides(fromDate: string, toDate: string): Promise<DayPayOverride[]>
  setDayOverride(empId: string, date: string, paid: boolean): Promise<void>
  listOvertimeForRange(fromDate: string, toDate: string): Promise<OvertimeRow[]>
  setOvertimeHours(empId: string, date: string, hours: number): Promise<void>
  deleteOvertimeHours(empId: string, date: string): Promise<void>

  addPayment(empId: string, amount: number, occurredOn: string, enteredBy: 'employee' | 'owner', id?: string): Promise<Payment>
  listPaymentsForRange(fromDate: string, toDate: string): Promise<Payment[]>
  listPaymentsForEmployeeRange(empId: string, fromDate: string, toDate: string): Promise<Payment[]>
  updatePayment(id: string, amount: number, occurredOn: string): Promise<void>
  deletePayment(id: string): Promise<void>
  listPaymentResolutions(fromDate: string, toDate: string): Promise<PaymentResolution[]>
  setPaymentResolution(empId: string, date: string, resolved: boolean, note?: string | null): Promise<void>
}

type LegacyMethods = Record<string, (...args: unknown[]) => unknown>

/** Wraps every method of `source` so it always returns a promise (and never throws synchronously). */
export function promisifyStore(source: LegacyMethods): Store {
  const wrapped: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const [name, fn] of Object.entries(source)) {
    if (typeof fn !== 'function') continue
    wrapped[name] = async (...args) => fn.apply(source, args)
  }
  return wrapped as unknown as Store
}

export const store: Store = promisifyStore(legacyStore as unknown as LegacyMethods)
