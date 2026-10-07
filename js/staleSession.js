// Pure "forgotten end-of-day clock-out" auto-close logic — the kiosk's only automatic clock-out
// (lunch is never inferred; see Lunch-break support in CLAUDE.md). No store/DOM access, same
// pattern as salary.js/rounding.js.
import { dateStr } from './utils.js';
import { endOfDayFor } from './autoClosed.js';

// True when an open record should be force-closed because it was left open from a day before
// `now` — nobody's shift genuinely spans midnight in this shop, so once the calendar day has
// rolled over, any session still open from before it is stale and safe to close. This doesn't
// care what time of day it is now — only whether a new day has started since the session opened.
export function shouldAutoCloseStaleSession(record, now = new Date()){
  if(!record || record.clock_out) return false;
  return dateStr(new Date(record.clock_in)) !== dateStr(now);
}

// endOfDayFor() lives in autoClosed.js (the hours math needs it too, and can't import this file
// without a cycle through utils.js); re-exported so the kiosk keeps importing both from here.
export { endOfDayFor };
