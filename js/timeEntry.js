// Pure: turns the owner's typed clock-in/clock-out (HH:MM, from <input type="time">) into stored
// instants for a record's date. No DOM, no store — same pattern as rounding.js.
//
// Two things this exists to get right, both found in real data (Oct 2026):
//  1. A clock-out earlier than the clock-in used to be "fixed" by silently adding 24 hours. Typing
//     4:35 for a session that started at 2:02 PM became 4:35 AM the next day, a 14.5-hour shift,
//     with no warning. No shift in this shop crosses midnight, so that guess is refused instead.
//  2. The dialog only has minutes, so saving it rewrote BOTH times with the seconds zeroed, even
//     for a field the owner never touched. A time whose minute is unchanged now keeps its exact
//     stored instant (the audit trail), and saving with no real change writes nothing.

const HHMM = /^(\d{1,2}):(\d{2})$/;

function atTime(date, hhmm){
  const m = HHMM.exec(String(hhmm || '').trim());
  if(!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if(h > 23 || min > 59) return null;
  const d = new Date(date + 'T00:00:00');
  d.setHours(h, min, 0, 0);
  return d;
}

// The stored instant if it is the same minute as what was typed, so an unchanged field keeps its
// real seconds; otherwise the typed time.
function keepIfSameMinute(candidate, storedIso){
  if(storedIso && Math.floor(new Date(storedIso).getTime() / 60000) * 60000 === candidate.getTime()) return storedIso;
  return candidate.toISOString();
}

export const CLOCK_OUT_BEFORE_IN = 'Clock-out must be later than clock-in on the same day. Check AM/PM.';

// existing: the record being edited ({clock_in, clock_out}) or omitted for a brand-new entry.
// Returns {inIso, outIso, changed} or {error}. outHHMM may be empty (session still open).
export function buildEntryTimes(date, inHHMM, outHHMM, existing = {}){
  const inCandidate = atTime(date, inHHMM);
  if(!inCandidate) return {error: 'Enter a valid clock-in time.'};
  let outCandidate = null;
  if(outHHMM){
    outCandidate = atTime(date, outHHMM);
    if(!outCandidate) return {error: 'Enter a valid clock-out time, or leave it empty.'};
    if(outCandidate.getTime() <= inCandidate.getTime()) return {error: CLOCK_OUT_BEFORE_IN};
  }
  const inIso = keepIfSameMinute(inCandidate, existing.clock_in);
  const outIso = outCandidate ? keepIfSameMinute(outCandidate, existing.clock_out) : null;
  const changed = inIso !== (existing.clock_in ?? null) || outIso !== (existing.clock_out ?? null);
  return {inIso, outIso, changed};
}
