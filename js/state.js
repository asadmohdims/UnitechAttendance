// Shared mutable app state. Modules import `state` and read/write its properties directly
// (the object reference is shared, so mutations are visible everywhere it's imported).
export const state = {
  employees: [],      // {id, name, active, avatar}
  openSessions: {},   // emp_id -> open record
  onLunch: {},         // emp_id -> true while auto-closed for lunch and not yet clocked back in
                        // (openSessions[id] is absent for both "never punched" and "on lunch",
                        // so this is what disambiguates the two for the kiosk tile)
  punchedToday: {},    // emp_id -> true if ANY record exists for today, open or closed —
                        // disambiguates "already completed a shift" from "never showed up"
                        // (both look like "no open session, not on lunch" otherwise), source
                        // for the missed-clock-in flag
  adminUnlocked: false
};

export const ADMIN_TABS = ['records', 'report', 'employees', 'salary'];
