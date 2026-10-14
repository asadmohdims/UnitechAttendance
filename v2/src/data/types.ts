// Shapes the legacy store returns. They mirror supabase-setup.sql; the legacy modules are
// untyped JavaScript, so this file is the contract v2 code is checked against.

export interface Employee {
  id: string
  name: string
  active: boolean
  /** Path in the photos bucket, `assets/...` for a bundled image, or null. */
  avatar: string | null
  created_at?: string
  pin_hash?: string | null
  pin_salt?: string | null
}

export interface RecordRow {
  id: string
  emp_id: string
  date: string
  clock_in: string
  clock_out: string | null
  in_photo: string | null
  out_photo: string | null
  lunch_paid: boolean
  created_at: string
  edited_at: string | null
  orig_clock_in: string | null
  orig_clock_out: string | null
  /** UI-only: set by supabaseStore on a punch this tablet has not finished uploading. */
  _sync?: { pending: boolean; inPhoto: boolean; outPhoto: boolean }
}

export interface SalaryRate {
  emp_id: string
  monthly_salary: number
  effective_from: string
  note?: string | null
}

export interface DayPayOverride {
  emp_id: string
  date: string
  paid: boolean
}

export interface OvertimeRow {
  emp_id: string
  date: string
  hours: number
}

export interface Payment {
  id: string
  emp_id: string
  amount: number
  occurred_on: string
  entered_by: 'employee' | 'owner'
}

export interface PaymentResolution {
  emp_id: string
  date: string
  resolved: boolean
  note?: string | null
}

export interface SyncStatus {
  pending: number
  stuck: boolean
  signedOut: boolean
}

export interface PinRecord {
  hash: string
  salt: string
}
