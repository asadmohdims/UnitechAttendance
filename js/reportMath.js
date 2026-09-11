// Pure day-hours accumulation for report.js's monthData() — no store/DOM access, so it's
// testable in isolation the same way js/salary.js is.
import { recHours } from './utils.js';

// recs: raw records for the month; empIds: employee ids to build rows for; days: days in month.
// Returns hours[empId][day] = summed completed hours for that day (null = no record at all —
// never a sentinel), and openFlags[empId][day] = true if ANY session that day is still open,
// tracked independently of the hours sum. That independence matters once a day can have
// multiple sessions (lunch break): a closed morning session's hours must never mask a still-open
// afternoon session on the same day, regardless of which record gets processed first.
export function buildDayHours(recs, empIds, days){
  const hours = {}, openFlags = {};
  empIds.forEach(id => { hours[id] = Array(days+1).fill(null); openFlags[id] = Array(days+1).fill(false); });
  recs.forEach(r => {
    if(!(r.emp_id in hours)) return;
    const d = Number(r.date.slice(8,10));
    const h = recHours(r);
    if(h === null) openFlags[r.emp_id][d] = true;
    else hours[r.emp_id][d] = (hours[r.emp_id][d] || 0) + h;
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
