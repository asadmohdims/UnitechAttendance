import { useCallback, useMemo } from 'react'
import { store } from '../../data/store'
import { useCachedQuery } from '../../data/useCachedQuery'
import type { DayPayOverride, Employee, OvertimeRow, Payment, PaymentResolution, RecordRow } from '../../data/types'
import { buildMonthModel, buildPayLines, type RateRow } from './monthModel'

/** The month's payments and the owner's "resolved" marks, shared by Month, People and the Days queue. */
export function usePaymentsMonth(ym: string) {
  const start = `${ym}-01`
  const end = `${ym}-${String(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()).padStart(2, '0')}`
  // null = the read failed, which is not the same as "nothing logged".
  const paymentsQ = useCachedQuery<Payment[] | null>(`month-payments:${ym}`, () => store.listPaymentsForRange(start, end).catch(() => null))
  const resolutionsQ = useCachedQuery<PaymentResolution[]>(`month-resolutions:${ym}`, () => store.listPaymentResolutions(start, end).catch(() => []))
  return { payments: paymentsQ.data, resolutions: resolutionsQ.data ?? [], refetch: useCallback(async () => void (await Promise.all([paymentsQ.refetch(), resolutionsQ.refetch()])), [paymentsQ, resolutionsQ]) }
}

/**
 * Everything one month's screens are drawn from, read once. Month (Attendance, Pay, Payments) and
 * the People page all use it, so a number shown on one cannot disagree with another. Reads are
 * best-effort where the live app's are: a project that has not run a migration must not blank the month.
 */
export function useMonthData(ym: string, today: string) {
  const start = `${ym}-01`
  const end = `${ym}-${String(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()).padStart(2, '0')}`

  const employeesQ = useCachedQuery<Employee[]>('employees', () => store.listEmployees())
  const recordsQ = useCachedQuery<RecordRow[]>(`month-records:${ym}`, () => store.listRecordsForRange(start, end))
  const overtimeQ = useCachedQuery<OvertimeRow[]>(`month-overtime:${ym}`, () => store.listOvertimeForRange(start, end).catch(() => []))
  const overridesQ = useCachedQuery<DayPayOverride[]>(`month-overrides:${ym}`, () => store.listDayPayOverrides(start, end).catch(() => []))

  const employees = employeesQ.data
  const records = recordsQ.data
  const model = useMemo(
    () => (employees && records ? buildMonthModel({ ym, employees, records, overrides: overridesQ.data ?? [], overtime: overtimeQ.data ?? [], today }) : null),
    [ym, employees, records, overridesQ.data, overtimeQ.data, today],
  )

  const ids = model?.people.map((p) => p.emp.id).join(',') ?? ''
  const ratesQ = useCachedQuery<Record<string, RateRow[]>>(`month-rates:${ids}`, async () => {
    const out: Record<string, RateRow[]> = {}
    await Promise.all((model?.people ?? []).map(async (p) => { out[p.emp.id] = await store.listSalaryRates(p.emp.id) }))
    return out
  })
  const pay = usePaymentsMonth(ym)

  const lines = useMemo(() => (model ? buildPayLines(model, ratesQ.data ?? {}, today) : []), [model, ratesQ.data, today])

  /** After an attendance, pay-rate, overtime or holiday write. */
  const refetchAttendance = useCallback(
    async () => void (await Promise.all([recordsQ.refetch(), overridesQ.refetch(), overtimeQ.refetch(), ratesQ.refetch()])),
    [recordsQ, overridesQ, overtimeQ, ratesQ],
  )

  return {
    start, end, employees, records, model, lines,
    overtime: overtimeQ.data ?? [],
    payments: pay.payments,
    resolutions: pay.resolutions,
    refetchEmployees: employeesQ.refetch,
    refetchAttendance,
    /** After a payment write or a resolve toggle. */
    refetchPayments: pay.refetch,
  }
}
