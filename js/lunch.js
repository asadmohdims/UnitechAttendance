// Pure lunch auto-close logic — no store or DOM access, so it's testable in isolation the
// same way js/salary.js is.
import { dateStr } from './utils.js';
import { LUNCH_CUTOFF_HOUR, LUNCH_CUTOFF_MINUTE } from './config.js';

// Today's lunch cutoff instant as a Date, for a given `now` (injectable so this stays pure
// under test — same pattern as salary.js's periodEndDate).
export function cutoffTimeFor(now = new Date()){
  const d = new Date(now);
  d.setHours(LUNCH_CUTOFF_HOUR, LUNCH_CUTOFF_MINUTE, 0, 0);
  return d;
}

// True when an open record should be auto-closed for lunch: still open, clock_in was today
// (guards against force-closing a stale multi-day-old open session), clock_in was before
// today's cutoff, and `now` has reached the cutoff.
export function shouldAutoCloseForLunch(record, now = new Date()){
  if(!record || record.clock_out) return false;
  const cutoff = cutoffTimeFor(now);
  if(now < cutoff) return false;
  const clockIn = new Date(record.clock_in);
  if(dateStr(clockIn) !== dateStr(now)) return false;
  return clockIn < cutoff;
}
