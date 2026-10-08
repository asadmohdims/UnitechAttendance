// Pure: turns one person's punches for one day into what the Daily records screen shows — a single
// status chip, at most one plain-language callout with its suggested actions, and per-session slot
// types (why a photo slot is empty). No store/DOM access, same pattern as reportMath.js.
//
// Three rules shape it (see the stress-test board in the design review):
//   1. One chip per person, the most important thing winning (CHIP_RANK below). A normal day has none.
//   2. Anything unusual gets one callout: what happened, what it does to pay, what to do.
//   3. Every empty photo slot says why it is empty (slot types), so "no photo" is never a mystery.
// Nothing here changes pay or edits a record, and lunch is never inferred — the checks only point
// at a day for the owner to look at.
import { SHOP_CLOSING_HOUR, SHOP_CLOSING_MINUTE, SHORT_SESSION_MINUTES, LONG_SESSION_HOURS } from './config.js';
import { isAutoClosedSession, countedClockOut } from './autoClosed.js';
import { isOwnerResolved } from './editMarker.js';
import { dayHoursFromSessions, isHalfDay, isPossibleMissedLunch, lunchGapIndex, dayOffStatus } from './reportMath.js';
import { recHours } from './utils.js';
import { recHoursRounded } from './rounding.js';

const MIN = 60000;

// Lower number wins the list row's single chip.
export const CHIP_RANK = {
  'needs-clock-out': 1, 'check-punches': 2, 'syncing': 3, 'still-in': 4, 'no-lunch': 5, 'edited': 6, 'added': 6, 'half-day': 7,
  'absent': 8, 'holiday': 9, 'not-in-yet': 9
};

function closingTime(session){
  const d = new Date(session.clock_in);
  d.setHours(SHOP_CLOSING_HOUR, SHOP_CLOSING_MINUTE, 0, 0);
  return d;
}

// What looks wrong about a day's punches, if anything. Chronologically-sorted `sessions`.
// A session the owner has already touched (edited_at) is not second-guessed for being short, long or
// late — they looked at it. Overlap is the exception: it is usually CAUSED by an owner edit, and
// pays the overlapping minutes twice, so it is always reported.
export function sessionProblems(sessions){
  const problems = [];
  sessions.forEach((s, i) => {
    const touched = !!s.edited_at;
    if(!touched && s.clock_out && !isAutoClosedSession(s)){
      const minutes = (new Date(s.clock_out) - new Date(s.clock_in)) / MIN;
      if(minutes < SHORT_SESSION_MINUTES) problems.push({kind: 'short', index: i, minutes: Math.round(minutes)});
      else if(minutes / 60 > LONG_SESSION_HOURS) problems.push({kind: 'long', index: i, hours: minutes / 60});
    }
    // The day's last session starting after closing time: a tap earlier in the day was missed, so
    // every later tap flipped. Can't tell WHICH tap is missing, so this only says one may be.
    if(!touched && i === sessions.length - 1 && new Date(s.clock_in) >= closingTime(s)){
      problems.push({kind: 'late-start', index: i});
    }
    if(i > 0 && sessions[i - 1].clock_out && new Date(s.clock_in) < new Date(sessions[i - 1].clock_out)){
      problems.push({kind: 'overlap', index: i, minutes: Math.round((new Date(sessions[i - 1].clock_out) - new Date(s.clock_in)) / MIN)});
    }
  });
  return problems;
}

// Why a photo slot is empty, or that it isn't. in: photo | uploading | owner | missing.
// out: photo | uploading | not-yet | auto | owner | missing. Each type renders in its own style.
export function slotTypes(s){
  const added = !!s.edited_at && !s.orig_clock_in && !s.orig_clock_out;
  // `_sync` is set by the store for a punch this tablet has not finished uploading (supabaseStore.js):
  // the photo exists, on the tablet, and is on its way.
  const inType = s._sync?.inPhoto ? 'uploading' : s.in_photo ? 'photo' : (added || s.edited_at ? 'owner' : 'missing');
  let outType;
  if(!s.clock_out) outType = 'not-yet';
  else if(isAutoClosedSession(s)) outType = 'auto';
  else if(s._sync?.outPhoto) outType = 'uploading';
  else if(s.out_photo) outType = 'photo';
  else outType = s.edited_at ? 'owner' : 'missing';
  return {in: inType, out: outType};
}

function sessionLabel(index, count, session){
  if(count === 1){
    const h = new Date(session.clock_in).getHours();
    return h < 12 ? 'MORNING' : h < 17 ? 'AFTERNOON' : 'EVENING';
  }
  const h = new Date(session.clock_in).getHours();
  const part = h < 12 ? 'MORNING' : h < 17 ? 'AFTERNOON' : 'EVENING';
  return `SESSION ${index + 1} · ${part}`;
}

// The model for a person who has at least one session on `date`.
// `now`/`today` are passed in (never read here) so tests are deterministic.
export function dayModel({sessions, date, today, now = new Date(), overtimeHours = 0}){
  const problems = sessionProblems(sessions);
  const last = sessions[sessions.length - 1];
  const isToday = date === today;
  const lateStartIdx = problems.find(p => p.kind === 'late-start')?.index;

  const sessionViews = sessions.map((r, i) => {
    const slots = slotTypes(r);
    return {
      index: i, record: r, label: sessionLabel(i, sessions.length, r), slots,
      paid: recHoursRounded(r),
      soFar: !r.clock_out && isToday ? Math.max(0, (now - new Date(r.clock_in)) / 3600000) : null,
      countedOut: r.clock_out ? countedClockOut(r) : null,
      edited: !!r.edited_at,
      flagIn: problems.some(p => p.index === i && p.kind === 'late-start'),
      problems: problems.filter(p => p.index === i)
    };
  });

  // Only a session that is waiting on a real clock-out: the kiosk's own midnight close (unless the
  // person clocked in after closing, where entering a clock-out is not the real fix), or a session
  // left open on a day that has already ended.
  const waiting = sessions.map((r, i) => ({r, i})).filter(({r, i}) =>
    (isAutoClosedSession(r) && i !== lateStartIdx) || (!r.clock_out && !isToday));

  const rawTotal = dayHoursFromSessions(sessions, recHoursRounded).total;
  const paidTotal = rawTotal === null && !overtimeHours ? null : (rawTotal || 0) + overtimeHours;

  const lunchIdx = lunchGapIndex(sessions);
  let lunch = null;
  if(lunchIdx !== null && sessions[lunchIdx - 1].clock_out){
    const hours = (new Date(sessions[lunchIdx].clock_in) - new Date(sessions[lunchIdx - 1].clock_out)) / 3600000;
    // A negative gap is an overlap (reported under Check punches), not a lunch break.
    if(hours >= 0) lunch = {hours, paid: !!sessions[lunchIdx - 1].lunch_paid, index: lunchIdx};
  }

  let chip = null, callout = null;
  const owned = sessions.filter(r => r.edited_at);
  const added = owned.some(r => !r.orig_clock_in && !r.orig_clock_out);
  const hoursWorked = dayHoursFromSessions(sessions, recHours).total;

  if(waiting.length){
    const {r, i} = waiting[0];
    chip = {id: 'needs-clock-out', tone: 'amber', text: 'Needs clock-out'};
    callout = {id: r.clock_out ? 'needs-clock-out' : 'open-past', tone: 'amber', index: i,
      params: {closedAt: r.clock_out, countedTo: r.clock_out ? countedClockOut(r) : null, paid: recHoursRounded(r)},
      actions: [{id: 'edit-session', label: 'Enter clock-out time', primary: true, index: i}]};
  }else if(problems.length){
    const p = problems[0];
    chip = {id: 'check-punches', tone: 'amber', text: 'Check punches'};
    const actions = [];
    if(p.kind === 'late-start'){ actions.push({id: 'add-punch', label: 'Add missing punch', primary: true}); actions.push({id: 'edit-session', label: 'Edit', index: p.index}); }
    else if(p.kind === 'short'){ actions.push({id: 'delete-session', label: 'Delete session…', index: p.index}); actions.push({id: 'edit-session', label: 'Edit', index: p.index}); }
    else actions.push({id: 'edit-session', label: p.kind === 'overlap' ? `Edit session ${p.index + 1}` : 'Edit session', primary: true, index: p.index});
    callout = {id: 'check-punches', tone: 'amber', params: {problems, paid: paidTotal}, actions};
  }else if(sessions.some(r => r._sync?.pending)){
    chip = {id: 'syncing', tone: 'amber', text: 'Syncing'};
    callout = {id: 'syncing', tone: 'amber', params: {}, actions: []};
  }else if(!last.clock_out){
    chip = {id: 'still-in', tone: 'green', text: 'Still in'};
    callout = {id: 'still-in', tone: 'green', params: {since: last.clock_in}, actions: []};
  }else if(!owned.length && isPossibleMissedLunch(sessions, hoursWorked)){
    chip = {id: 'no-lunch', tone: 'pink', text: 'No lunch punch?'};
    callout = {id: 'no-lunch', tone: 'pink', params: {hours: hoursWorked}, actions: [{id: 'split', label: 'Split for lunch', primary: true, index: 0}]};
  }else if(owned.length){
    chip = added ? {id: 'added', tone: 'blue', text: 'Added by you'} : {id: 'edited', tone: 'blue', text: 'Edited'};
    callout = {id: chip.id, tone: 'blue', params: {editedAt: owned[owned.length - 1].edited_at}, actions: []};
  }else if(!isToday && isHalfDay(sessions, hoursWorked)){ // today's day isn't over: a morning before lunch is not a half day yet
    chip = {id: 'half-day', tone: 'yellow', text: 'Half day'};
    callout = {id: 'half-day', tone: 'grey', params: {hours: hoursWorked}, actions: []};
  }

  if(overtimeHours && !chip){
    chip = {id: 'overtime', tone: 'green', text: `+${overtimeHours}h overtime`};
  }

  return {
    kind: 'worked', chip, callout, problems, sessions: sessionViews, paidTotal, lunch,
    needsLook: !!chip && (chip.id === 'needs-clock-out' || chip.id === 'check-punches')
  };
}

// The model for a person with NO sessions on `date`. Returns null when there is nothing worth a row
// (a day that has not happened yet, or one before the person was added). Today counts as "not in
// yet" only until the shop closes; after that nobody is going to arrive, so it reads as Absent, the
// same as the Report's cell for today. A weekly holiday is a holiday today too. `docked`: the owner has
// marked this paid holiday unpaid for this person (the Report's day_pay_overrides).
export function emptyDayModel({date, today, weekday, employeeSince, now = new Date(), docked = false}){
  const status = dayOffStatus({date, weekday, employeeSince, today});
  if(status === 'holiday'){
    return {kind: 'empty', chip: {id: 'holiday', tone: 'violet', text: 'Holiday'},
      callout: {id: 'holiday', tone: 'violet', params: {docked},
        actions: [{id: 'toggle-holiday', label: docked ? 'Restore as paid' : 'Mark unpaid'}]},
      sessions: [], paidTotal: null, lunch: null, needsLook: false};
  }
  if(date === today){
    const closing = new Date(now); closing.setHours(SHOP_CLOSING_HOUR, SHOP_CLOSING_MINUTE, 0, 0);
    if(now < closing){
      return {kind: 'empty', chip: {id: 'not-in-yet', tone: 'grey', text: 'Not in yet'},
        callout: {id: 'not-in-yet', tone: 'grey', params: {}, actions: [{id: 'add-punch', label: 'Add missed punch'}]},
        sessions: [], paidTotal: null, lunch: null, needsLook: false};
    }
  }
  if(status === 'off'){
    return {kind: 'empty', chip: {id: 'absent', tone: 'red', text: 'Absent'},
      callout: {id: 'absent', tone: 'red', params: {}, actions: [{id: 'add-punch', label: 'Add missed punch', primary: true}]},
      sessions: [], paidTotal: null, lunch: null, needsLook: true};
  }
  return null;
}
