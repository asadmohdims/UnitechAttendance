// Pure helpers for sessions the kiosk auto-closed because nobody clocked out (see
// staleSession.js). No store/DOM access. Kept separate from staleSession.js because utils.js's
// recHours() needs it, and staleSession.js itself imports utils.js — one module would be a cycle.
import { SHOP_CLOSING_HOUR, SHOP_CLOSING_MINUTE } from './config.js';

// The instant a stale session gets force-closed at: midnight at the end of the day it started
// — deliberately not a guessed real punch time. There's no shop-wide "end of shift" hour
// (shifts vary in length), so rather than invent one, this picks a timestamp that can never
// look like a real punch. Combined with no photo, needsReview() in reportMath.js flags it for
// the owner to fix via Edit/"Add a missed punch" (js/ui/records.js) with the real end time.
export function endOfDayFor(record){
  const d = new Date(record.clock_in);
  d.setHours(24, 0, 0, 0);
  return d;
}

// True for a record the kiosk closed itself: no camera photo, and clock_out sitting exactly on
// the midnight endOfDayFor() would have stamped. Inferred rather than stored so no schema change
// was needed and rows auto-closed before this existed are corrected too. A fixed record
// (owner entered the real end time) no longer matches, so it's counted as entered. Known
// limit: a hand-entered exactly-12:00-AM clock-out with no photo is read as auto-closed — fine
// here, since no shift spans midnight.
export function isAutoClosedSession(record){
  if(!record || !record.clock_out || record.out_photo) return false;
  return new Date(record.clock_out).getTime() === endOfDayFor(record).getTime();
}

// The clock-out instant (ISO) that hours and pay should be computed from. For a normal record
// that's just its clock_out. For an auto-closed one the midnight stamp is NOT when the employee
// left — counting it paid ~10 hours for someone who clocked in at 2 PM and just forgot to tap
// out — so it's capped at the shop's closing time on the clock-in day (and never earlier than
// the clock-in itself, for someone who clocked in after closing). The stored clock_out and the
// "No clock-out photo" review flag are untouched: the record still needs the owner's real time.
export function countedClockOut(record){
  if(!isAutoClosedSession(record)) return record.clock_out;
  const closing = new Date(record.clock_in);
  closing.setHours(SHOP_CLOSING_HOUR, SHOP_CLOSING_MINUTE, 0, 0);
  const clockIn = new Date(record.clock_in);
  return (closing > clockIn ? closing : clockIn).toISOString();
}
