// Pure payroll-rounding math — no store/DOM access, same pattern as salary.js/lunch.js.
const QUARTER_MS = 15 * 60 * 1000;

// DOL "7-minute rule" (29 CFR 785.48(b)): round to the nearest 15 minutes, symmetric for
// both clock-in and clock-out. Every real-world UTC offset (including IST, +5:30) is itself
// a multiple of 15 minutes, so rounding the raw epoch ms to the nearest 900,000ms lands on a
// quarter-hour boundary in local time too — no timezone-aware arithmetic needed.
export function roundToQuarterHour(input){
  const ms = new Date(input).getTime();
  return new Date(Math.round(ms / QUARTER_MS) * QUARTER_MS);
}

// True when rounding actually moved the punch — the UI uses this to decide whether a "paid"
// annotation is worth showing at all (most punches land close enough to a quarter that
// showing a redundant identical time would just be noise).
export function wasRounded(iso){
  return roundToQuarterHour(iso).getTime() !== new Date(iso).getTime();
}

// Mirrors utils.js's recHours(), but rounds each punch to the nearest quarter hour first —
// this is the hours figure Salary pays on; Records/Report keep using the exact recHours()
// so the audit trail (tied to the proof photo) always shows what actually happened.
export function recHoursRounded(r){
  if(!r.clock_out) return null;
  const inD = roundToQuarterHour(r.clock_in);
  const outD = roundToQuarterHour(r.clock_out);
  return Math.max(0, (outD - inD) / 3600000);
}
