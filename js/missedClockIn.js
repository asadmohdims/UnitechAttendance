// Pure "missed clock-in" predicate — no store or DOM access, same style as js/lunch.js.
import { MISSED_CLOCKIN_HOUR, MISSED_CLOCKIN_MINUTE } from './config.js';

// Today's missed-clock-in cutoff instant as a Date, for a given `now` (injectable for tests —
// same pattern as lunch.js's cutoffTimeFor).
export function missedCutoffFor(now = new Date()){
  const d = new Date(now);
  d.setHours(MISSED_CLOCKIN_HOUR, MISSED_CLOCKIN_MINUTE, 0, 0);
  return d;
}

// True when an active employee should show as "missed clock-in": no attendance record at all
// for today (`punchedToday` false — a single flag covering "currently clocked in", "on lunch",
// and "already completed a shift today" all at once, since all three imply a record exists for
// today) and `now` has reached the cutoff hour.
export function isMissedClockIn(punchedToday, now = new Date()){
  if(punchedToday) return false;
  return now >= missedCutoffFor(now);
}
