/* ================= CONFIG — paste your Supabase project values ================= */
export const SUPABASE_URL      = 'https://ybgdetybspkdjwgysgeo.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_m9i8FqlytW5uSnzRaRkCww_Wz9EoPUN'; // anon/publishable key — safe to be public, protected by RLS
// TEMPORARY: local demo mode. Set to false when connecting the real Supabase backend.
export const DEMO_MODE = false;
// Assumed hours in a standard working month, used to prorate a fixed monthly salary into
// pay for hours actually worked. Placeholder — confirm the real figure (days/week, hours/day)
// with the shop owner before treating this as final.
export const STANDARD_MONTHLY_HOURS = 208; // 8 hrs/day × 26 days (6-day week)
// Employees still clocked in past this time are assumed to have forgotten to tap out for
// lunch — the kiosk auto-closes that session at this time (see js/lunch.js / js/ui/kiosk.js).
// Only applies to a session that started today. Placeholder — confirm the real cutoff with
// the shop owner before treating this as final.
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
