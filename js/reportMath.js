// Pure day-hours accumulation for report.js's monthData() — no store/DOM access, so it's
// testable in isolation the same way js/salary.js is.
import { recHours, dateStr } from './utils.js';
import { WEEKLY_HOLIDAY_DAY } from './config.js';

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

// A day with exactly one session — as opposed to the two-session morning+afternoon pattern a
// full day normally has now that lunch breaks are routinely punched separately (see the
// Lunch-break section in CLAUDE.md) — reads as attendance for only one half of the day, worth
// its own calendar color rather than blending into a normal full day.
// Caveat worth knowing: this can't tell "only worked the morning" apart from "worked a full
// day in one continuous punch with no lunch break taken" — both are a single session. It's a
// literal session-count rule, not an hours-based one; flag it if that misclassifies real days.
export function isHalfDay(sessions){
  return !!sessions && sessions.length === 1;
}
