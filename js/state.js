// Shared mutable app state. Modules import `state` and read/write its properties directly
// (the object reference is shared, so mutations are visible everywhere it's imported).
export const state = {
  employees: [],      // {id, name, active, avatar}
  openSessions: {},   // emp_id -> open record
  sessionsToday: {},   // emp_id -> count of today's records, open or closed. Lets the kiosk
                        // tell "between two sessions, expected back" (exactly 1 so far) apart
                        // from "the day's shape is already done" (2 or more) — on its own,
                        // openSessions[id] being absent covers both "never punched" and "on a
                        // break", whichever way the earlier session ended. Deriving "on lunch"
                        // from this count (rather than a flag set only by the auto-close path)
                        // is what makes a manual lunch tap-out and an auto-closed one look
                        // identical on the tile, instead of only the forgotten case being
                        // visible — see tileStatus() in js/ui/kiosk.js.
  punchedToday: {},    // emp_id -> true if ANY record exists for today, open or closed —
                        // disambiguates "already completed a shift" from "never showed up"
                        // (both look like "no open session, not on a break" otherwise), source
                        // for the missed-clock-in flag
  adminUnlocked: false
};

export const ADMIN_TABS = ['records', 'report', 'employees', 'salary'];
