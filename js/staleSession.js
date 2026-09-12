// Pure "forgotten end-of-day clock-out" auto-close logic — the complement of js/lunch.js's
// same-day guard. No store/DOM access, same pattern as lunch.js/salary.js/rounding.js.
import { dateStr } from './utils.js';

// True when an open record should be force-closed because it was left open from a day before
// `now` — nobody's shift genuinely spans midnight in this shop, so once the calendar day has
// rolled over, any session still open from before it is stale and safe to close. Unlike
// js/lunch.js's cutoff-hour check, this doesn't care what time of day it is now — only whether
// a new day has started since the session opened.
export function shouldAutoCloseStaleSession(record, now = new Date()){
  if(!record || record.clock_out) return false;
  return dateStr(new Date(record.clock_in)) !== dateStr(now);
}

// The instant a stale session gets force-closed at: midnight at the end of the day it started
// — deliberately not a guessed real punch time. There's no shop-wide "end of shift" hour the
// way LUNCH_CUTOFF_HOUR works for lunch (shifts vary in length), so rather than invent one, this
// picks a timestamp that can never look like a real punch — the resulting "shift" reads as
// obviously wrong (often 12+ hours), which is a louder, harder-to-miss signal than a
// plausible-but-wrong number would be. Combined with no photo (same as js/lunch.js's own
// auto-close), needsReview() in reportMath.js flags it for the owner to fix via Edit/"Add a
// missed punch" (js/ui/records.js) with the real end time.
export function endOfDayFor(record){
  const d = new Date(record.clock_in);
  d.setHours(24, 0, 0, 0);
  return d;
}
