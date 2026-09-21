// Shared mutable app state. Modules import `state` and read/write its properties directly
// (the object reference is shared, so mutations are visible everywhere it's imported).
export const state = {
  employees: [],      // {id, name, active, avatar}
  openSessions: {},   // emp_id -> open record
  sessionsToday: {},   // emp_id -> count of today's records, open or closed. Lets the kiosk
                        // tell "between two sessions, expected back" (exactly 1 so far) apart
                        // from "the day's shape is already done" (2 or more) — on its own,
                        // openSessions[id] being absent covers both "never punched" and "on a
                        // break". Deriving "on lunch" from this count (rather than a
                        // separately-mutated flag) keeps the tile a pure function of what's
                        // actually recorded today, so it can't drift from the data — see
                        // tileStatus() in js/ui/kiosk.js.
  punchedToday: {},    // emp_id -> true if ANY record exists for today, open or closed —
                        // disambiguates "already completed a shift" from "never showed up"
                        // (both look like "no open session, not on a break" otherwise), source
                        // for the missed-clock-in flag
  adminUnlocked: false,
  kioskMode: 'attendance' // 'attendance' | 'payments' — which screen the kiosk's tile grid shows
};

export const ADMIN_TABS = ['records', 'report', 'employees', 'salary', 'payments'];
