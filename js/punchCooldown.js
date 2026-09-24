// Pure "duplicate punch window" logic: a second tap on the same employee's tile within
// PUNCH_COOLDOWN_MINUTES of their last punch is treated as a repeat of that punch, not a new
// one. No store/DOM access, same pattern as staleSession.js.
//
// Why both directions: the kiosk is a toggle, so a "did that register?" retap always records the
// OPPOSITE of what the employee just did. Out-then-straight-back-in is the costlier case — seen
// in live use, it silently turned a lunch break into paid work (a 0:00 "Lunch" gap) and then
// flipped the meaning of the employee's next tap too.

// emp_id -> ISO instant of that employee's most recent punch (clock-in or clock-out) across
// `records`. The kiosk passes today's records, which already include this tablet's unsynced
// punches (listRecordsForDate is local-wins) and anything punched on another device.
export function latestPunchByEmployee(records){
  const latest = {};
  for(const r of records){
    for(const iso of [r.clock_in, r.clock_out]){
      if(iso && (!latest[r.emp_id] || new Date(iso) > new Date(latest[r.emp_id]))) latest[r.emp_id] = iso;
    }
  }
  return latest;
}

// The instant a new punch is allowed again, or null if one is allowed right now. A last punch
// dated in the future (an admin-entered clock-out time, or another device's clock running ahead)
// can't be a just-now double-tap, so it never locks anyone out — otherwise it could block an
// employee for hours.
export function punchLockedUntil(lastPunchIso, minutes, now = new Date()){
  if(!lastPunchIso) return null;
  const last = new Date(lastPunchIso);
  if(last > now) return null;
  const until = new Date(last.getTime() + minutes * 60000);
  return until > now ? until : null;
}
