import type { RecordRow, Employee } from '../data/types'

// What js/dayStatus.js hands back. The legacy module is untyped JavaScript; these are its shapes.
export type Tone = 'amber' | 'green' | 'pink' | 'blue' | 'yellow' | 'grey' | 'red' | 'violet'

export interface Chip {
  id: string
  tone: Tone
  text: string
}

export interface Problem {
  kind: 'short' | 'long' | 'late-start' | 'overlap'
  index: number
  minutes?: number
  hours?: number
}

export interface CalloutAction {
  id: 'edit-session' | 'delete-session' | 'split' | 'add-punch' | 'toggle-holiday' | 'mark-reviewed'
  label: string
  primary?: boolean
  index?: number
}

export interface Callout {
  id: string
  tone: Tone
  index?: number
  params: Record<string, unknown> & { problems?: Problem[]; paid?: number | null; docked?: boolean }
  actions: CalloutAction[]
}

export type SlotType = 'photo' | 'uploading' | 'owner' | 'missing' | 'not-yet' | 'auto'

export interface OwnerPunches {
  in: boolean
  out: boolean
  added: boolean
  wasIn: string | null
  wasOut: string | null
}

export interface SessionView {
  index: number
  record: RecordRow
  label: string
  slots: { in: SlotType; out: SlotType }
  paid: number | null
  soFar: number | null
  countedOut: string | null
  edited: boolean
  mine: OwnerPunches
  flagIn: boolean
  problems: Problem[]
}

/** A standard day paid whatever the punches: the weekly Friday, or a holiday the owner declared. */
export interface HolidayPay {
  kind: 'friday' | 'holiday'
  /** The owner took this person off it. */
  docked: boolean
  /** The standard day, in hours. */
  hours: number
  /** Hours worked that day on top of it (null: none, or still in). */
  worked: number | null
}

export interface DayModel {
  kind: 'worked' | 'empty'
  chip: Chip | null
  callout: Callout | null
  problems?: Problem[]
  sessions: SessionView[]
  paidTotal: number | null
  lunch: { hours: number; paid: boolean; index: number } | null
  /** Set on a day that earns a standard day, with or without punches. `paidTotal` then includes it (unless docked). */
  holiday?: HolidayPay
  ownerPunchCount?: number
  punchCount?: number
  needsLook: boolean
}

export interface DayEntry {
  emp: Employee
  model: DayModel
  overtimeHours: number
}
