// Pure day-hours accumulation for report.js's monthData() — no store/DOM access, so it's
// testable in isolation the same way js/salary.js is.
import { recHours, dateStr } from './utils.js';
import { WEEKLY_HOLIDAY_DAY, STANDARD_DAY_HOURS, LUNCH_CUTOFF_HOUR, LUNCH_CUTOFF_MINUTE } from './config.js';

// A single session's hours below which it reads as attendance for only part of the day, rather
// than a full day worked straight through with no break — see isHalfDay() below. 6 of 8 standard
// hours (75%) is the working default; revisit if it misclassifies real days either direction.
const HALF_DAY_HOUR_THRESHOLD = STANDARD_DAY_HOURS * 0.75;

// A day's chronologically-sorted sessions, collapsing any run chained by `lunch_paid` (a flag
// on the earlier session in a pair, set when the owner opts to pay through that lunch gap)
// into one virtual span before applying hoursFn. Merging first — rather than summing each
// session's hours and separately adding the raw gap — means a paid-through lunch day gets one
// continuous shift's rounding at its true start/end, not two independently-rounded halves plus
// an unrounded gap stitched on.
// Exported so report.js's day-detail panel can total a day's sessions the exact same
// lunch-paid-aware way buildDayHours() does below — otherwise the expanded detail row and the
// calendar's own total column could disagree the moment a lunch gap is marked paid.
export function dayHoursFromSessions(sessions, hoursFn){
  let total = null, hasOpen = false;
  let i = 0;
  while(i < sessions.length){
    let j = i;
    while(j + 1 < sessions.length && sessions[j].lunch_paid) j++;
    const span = i === j ? sessions[i] : {clock_in: sessions[i].clock_in, clock_out: sessions[j].clock_out};
    const h = hoursFn(span);
    if(h === null) hasOpen = true;
    else total = (total || 0) + h;
    i = j + 1;
  }
  return {total, hasOpen};
}

// recs: raw records for the month; empIds: employee ids to build rows for; days: days in month.
// Returns hours[empId][day] = summed completed hours for that day (null = no record at all —
// never a sentinel), and openFlags[empId][day] = true if ANY session that day is still open,
// tracked independently of the hours sum. That independence matters once a day can have
// multiple sessions (lunch break): a closed morning session's hours must never mask a still-open
// afternoon session on the same day, regardless of which record gets processed first.
// `hoursFn` is injectable (defaults to the exact recHours) so Salary can build the same
// aggregate from recHoursRounded() — the payroll-rounded figure — without duplicating this
// grouping/accumulation logic.
export function buildDayHours(recs, empIds, days, hoursFn = recHours){
  const hours = {}, openFlags = {};
  empIds.forEach(id => { hours[id] = Array(days+1).fill(null); openFlags[id] = Array(days+1).fill(false); });
  const grouped = groupByEmployeeDay(recs);
  Object.keys(grouped).forEach(empId => {
    if(!(empId in hours)) return;
    Object.entries(grouped[empId]).forEach(([day, sessions]) => {
      const {total, hasOpen} = dayHoursFromSessions(sessions, hoursFn);
      hours[empId][day] = total;
      openFlags[empId][day] = hasOpen;
    });
  });
  return {hours, openFlags};
}

// Groups a month's raw records by employee, then by day-of-month, each day's list sorted
// chronologically. buildDayHours() gives the aggregate a day needs for its status pill;
// this gives the session-by-session detail (times, lunch gap) shown when a day is clicked.
export function groupByEmployeeDay(recs){
  const map = {};
  recs.forEach(r => {
    const d = Number(r.date.slice(8,10));
    if(!map[r.emp_id]) map[r.emp_id] = {};
    if(!map[r.emp_id][d]) map[r.emp_id][d] = [];
    map[r.emp_id][d].push(r);
  });
  Object.values(map).forEach(byDay => {
    Object.values(byDay).forEach(list => list.sort((a, b) => new Date(a.clock_in) - new Date(b.clock_in)));
  });
  return map;
}

// True when a day's data can't be trusted as final without a human checking it: either the
// last session is still open (clock_out null — forgot to clock out), or it was auto-closed by
// the lunch safety net and nothing followed it (out_photo null on a session that IS closed —
// the employee never tapped back in from lunch). Both collapse to the same check: the day's
// last session has no photographed clock-out.
export function needsReview(sessions){
  if(!sessions || !sessions.length) return false;
  return !sessions[sessions.length - 1].out_photo;
}

// Classifies a day that has NO punches at all (buildDayHours already returned null hours and
// no open session) — deciding whether that gap is the standing weekly holiday, an inferred
// day off, or nothing worth marking (a day that hasn't happened yet, or predates this
// employee being added). A day with any punches never reaches this function — buildDayHours/
// needsReview already cover those.
// `employeeSince` gates BEFORE the holiday check: a Friday that fell before someone was even
// added should read as "nothing to show," not "paid holiday" — hiring can't retroactively pay
// someone for a day before they existed in the system. Left undefined (the demo store doesn't
// track a created_at), the gate is simply skipped rather than misclassifying every past day.
export function dayOffStatus({date, weekday, employeeSince, today = dateStr()}){
  if(date > today) return null;
  if(employeeSince && date < employeeSince) return null;
  if(weekday === WEEKLY_HOLIDAY_DAY) return 'holiday';
  return 'off';
}

// A day with exactly one session AND notably fewer hours than a full day — as opposed to the
// two-session morning+afternoon pattern a full day normally has now that lunch breaks are
// routinely punched separately (see the Lunch-break section in CLAUDE.md) — reads as attendance
// for only part of the day, worth its own calendar color rather than blending into a normal
// full day. The hours check is what tells "only worked the morning" (a real half day) apart
// from "worked a full day in one continuous punch with no lunch break taken" (still a full
// day's work, just not chained into two sessions) — session count alone can't distinguish them.
// `hoursWorked` is the day's already-computed total (buildDayHours' `hours[empId][day]`), not
// re-derived here, so this never disagrees with what the day's own hours figure says.
export function isHalfDay(sessions, hoursWorked){
  if(!sessions || sessions.length !== 1) return false;
  return hoursWorked != null && hoursWorked < HALF_DAY_HOUR_THRESHOLD;
}

// Given a day's chronologically-sorted sessions, returns the index (into `sessions`) of the
// session whose gap-before-it is the day's actual lunch break — i.e. the gap sits between
// sessions[i-1] and sessions[i] — or null if there's no gap at all (a single session).
// With exactly one gap, that gap simply IS lunch: real usage is almost always one clock-out/
// back-in pair a day, so there's nothing to disambiguate and no reason to second-guess what
// time it happened to fall at (an employee's one break is their break, whenever they took it).
// The bug this guards against only shows up with MORE than one gap — an extra punch from a
// forgotten tap, a same-day errand, or (what actually surfaced this) repeated test taps — every
// gap used to render as "Lunch" unconditionally, which reads as multiple lunch breaks in one
// day. Only the gap nearest the shop's configured lunch time (LUNCH_CUTOFF_HOUR/MINUTE — the
// same constant js/lunch.js's auto-close safety net already uses) is the real lunch break; every
// other gap is just an ordinary break (still unpaid unless the owner explicitly marks it paid,
// same lunch_paid mechanism either way — see dayHoursFromSessions above).
// Uses local (kiosk-device) time, same convention as js/lunch.js's cutoffTimeFor() — this app
// has never needed to reason about time zones beyond "wherever the kiosk physically is".
export function lunchGapIndex(sessions){
  if(!sessions || sessions.length < 2) return null;
  if(sessions.length === 2) return 1;
  const cutoffMinutes = LUNCH_CUTOFF_HOUR * 60 + LUNCH_CUTOFF_MINUTE;
  let bestIdx = 1, bestDist = Infinity;
  for(let i = 1; i < sessions.length; i++){
    const gapStart = new Date(sessions[i-1].clock_out);
    const gapMinutes = gapStart.getHours() * 60 + gapStart.getMinutes();
    const dist = Math.abs(gapMinutes - cutoffMinutes);
    if(dist < bestDist){ bestDist = dist; bestIdx = i; }
  }
  return bestIdx;
}
