import xlsxUrl from '../../../../vendor/xlsx-0.18.5.full.min.js?url'
import type { MonthModel } from './monthModel'

type Cell = string | number
export interface ExportSheet {
  header: string[]
  rows: Cell[][]
}

/**
 * The same sheet the live app exports (js/ui/report.js): one row per person, one column per day
 * with exact punched hours, then Days worked and Total hours. Exact punches only, as live: overtime
 * is not in these numbers.
 */
export function buildExportSheet(model: MonthModel): ExportSheet {
  const dates = Array.from({ length: model.daysInMonth }, (_, i) => `${model.ym}-${String(i + 1).padStart(2, '0')}`)
  const header = ['Employee', ...dates, 'Days worked', 'Total hours']
  const rows = model.people.map((p) => {
    let total = 0
    let worked = 0
    const cells: Cell[] = p.days.map((d) => {
      if (d.exactHours !== null) {
        total += d.exactHours
        worked++
      }
      if (d.kind === 'open') return 'IN (no out)'
      return d.exactHours === null ? '' : Number(d.exactHours.toFixed(2))
    })
    return [p.emp.name, ...cells, worked, Number(total.toFixed(2))]
  })
  return { header, rows }
}

interface XlsxLib {
  utils: { aoa_to_sheet: (a: Cell[][]) => Record<string, unknown>; book_new: () => unknown; book_append_sheet: (wb: unknown, ws: unknown, name: string) => void }
  writeFile: (wb: unknown, name: string) => void
}

// SheetJS is ~900KB and only this button uses it, so it loads on the first tap (as the live app does).
let loading: Promise<XlsxLib> | null = null
function loadXlsx(): Promise<XlsxLib> {
  const w = window as unknown as { XLSX?: XlsxLib }
  if (w.XLSX) return Promise.resolve(w.XLSX)
  loading ??= new Promise<XlsxLib>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = xlsxUrl
    script.onload = () => resolve(w.XLSX as XlsxLib)
    script.onerror = () => {
      loading = null
      reject(new Error('Could not load the Excel exporter — check Wi-Fi.'))
    }
    document.head.appendChild(script)
  })
  return loading
}

export async function downloadMonthXlsx(model: MonthModel): Promise<void> {
  const XLSX = await loadXlsx()
  const { header, rows } = buildExportSheet(model)
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows])
  ws['!cols'] = [{ wch: 18 }, ...Array(model.daysInMonth).fill({ wch: 10 }), { wch: 11 }, { wch: 11 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, model.ym)
  XLSX.writeFile(wb, `attendance-${model.ym}.xlsx`)
}
