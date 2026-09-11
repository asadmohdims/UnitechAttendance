// Pure payroll-rounding math — no store/DOM access, same pattern as salary.js/lunch.js.
const QUARTER_MS = 15 * 60 * 1000;
// The shop's own rule (not the DOL's symmetric 7-minute rule this started from): a punch up to
// 10 minutes past a quarter still counts as that quarter; only past 10 minutes does it roll to
// the next one. 10:30 is the exact cutover, so :00-:10 round down and :11-:14 round up.
const ROUND_DOWN_THROUGH_MS = 10.5 * 60 * 1000;

// Every real-world UTC offset (including IST, +5:30) is itself a multiple of 15 minutes, so
// doing this arithmetic on the raw epoch ms lands on a quarter-hour boundary in local time
// too, with no timezone-aware handling needed.
export function roundToQuarterHour(input){
  const ms = new Date(input).getTime();
  const quarterStart = Math.floor(ms / QUARTER_MS) * QUARTER_MS;
  const offset = ms - quarterStart;
  return new Date(offset <= ROUND_DOWN_THROUGH_MS ? quarterStart : quarterStart + QUARTER_MS);
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
