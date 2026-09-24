// Shared mutable app state. Modules import `state` and read/write its properties directly
// (the object reference is shared, so mutations are visible everywhere it's imported).
export const state = {
  employees: [],      // {id, name, active, avatar}
  openSessions: {},   // emp_id -> open record
  punchedToday: {},    // emp_id -> true if ANY record exists for today, open or closed —
                        // disambiguates "already showed up today" from "never showed up" (both
                        // look like "no open session" otherwise), source for the
                        // missed-clock-in flag — see tileStatus() in js/ui/kiosk.js.
  lastPunchAt: {},     // emp_id -> ISO of their latest punch today (in or out) — drives the
                        // duplicate-punch window, see js/punchCooldown.js.
  adminUnlocked: false,
  kioskMode: 'attendance' // 'attendance' | 'payments' — which screen the kiosk's tile grid shows
};

export const ADMIN_TABS = ['records', 'report', 'employees', 'salary', 'payments'];
