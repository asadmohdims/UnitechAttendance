/* ================= CONFIG — paste your Supabase project values ================= */
export const SUPABASE_URL      = 'https://ybgdetybspkdjwgysgeo.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_m9i8FqlytW5uSnzRaRkCww_Wz9EoPUN'; // anon/publishable key — safe to be public, protected by RLS
// TEMPORARY: local demo mode. Set to false when connecting the real Supabase backend.
export const DEMO_MODE = false;
// Hours in one standard working day — what a paid Friday is credited as, what a docked Friday
// loses, and the per-day unit js/ui/salary.js multiplies by the ACTUAL days in a given calendar
// month to get that month's standard hours (the owner's explicit call, 2026-09-12: "days in the
// month — January 31, February 28, March 31" — not a fixed 26-day approximation, which is why
// there's no STANDARD_MONTHLY_HOURS constant here anymore; it varies by month, so it's computed
// per-render from monthData()'s own day count instead of being a fixed export).
export const STANDARD_DAY_HOURS = 8;
// The shop's standing paid day off (0=Sunday...6=Saturday) — employees aren't expected to
// work this day but are still paid for it, so the monthly report shows it distinctly from an
// actual gap in attendance. Placeholder — confirm with the shop owner before treating this as
// final, same status as the cutoffs below.
export const WEEKLY_HOLIDAY_DAY = 5; // Friday
// The shop's typical lunch time. A labeling/layout hint only — nothing acts on it automatically
// and it never affects pay: lunch is simply the gap between two real taps (employees tap out and
// back in themselves; the kiosk no longer closes anyone's session for lunch). It picks WHICH gap
// on a 3+ session day is labeled "Lunch" rather than "Break" (lunchGapIndex in js/reportMath.js)
// and where "Split for lunch" centers its 1-hour gap (defaultLunchWindow in js/ui/records.js).
// Placeholder — confirm the real time with the shop owner. (Still named "CUTOFF" from when it
// drove an auto-close; renaming would touch config, reportMath, records and tests for no gain.)
export const LUNCH_CUTOFF_HOUR = 13;   // 1:00 PM
export const LUNCH_CUTOFF_MINUTE = 0;
// Active employees with no attendance record at all for today (no open session, not on
// lunch, no completed shift) are flagged as a missed clock-in past this hour — kiosk tile
// + admin Daily records banner. Not tied to a per-employee expected shift-start time (no
// scheduling concept exists in this app) — just "hasn't shown up at all yet today, and it's
// now late enough to notice." Placeholder — confirm the real cutoff with the shop owner
// before treating this as final.
export const MISSED_CLOCKIN_HOUR = 10;   // 10:00 AM
export const MISSED_CLOCKIN_MINUTE = 0;
/* =============================================================================== */
