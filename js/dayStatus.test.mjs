// Pure-logic tests for Daily records' one-chip-per-person rule, the "Check punches" checks and the
// photo-slot types. Dates are built in LOCAL time (like the app) so they hold in any timezone.
// Run with: node --test js/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dayModel, emptyDayModel, sessionProblems, slotTypes } from './dayStatus.js';

const DATE = '2026-10-07', TODAY = '2026-10-08';
const at = (h, m = 0, dayOffset = 0) => new Date(2026, 9, 7 + dayOffset, h, m).toISOString();
const rec = (inH, inM, outH, outM, extra = {}) => ({
  id: `r${inH}${inM}`, emp_id: 'e1', date: DATE, clock_in: at(inH, inM),
  clock_out: outH == null ? null : at(outH, outM), in_photo: 'p/in', out_photo: outH == null ? null : 'p/out', ...extra
});
const model = (sessions, extra = {}) => dayModel({sessions, date: DATE, today: TODAY, now: new Date(2026, 9, 8, 11, 30), ...extra});

describe('a normal day', () => {
  test('four taps: no chip, no callout, paid total', () => {
    const m = model([rec(9, 1, 13, 4), rec(14, 7, 18, 22)]);
    assert.equal(m.chip, null);
    assert.equal(m.callout, null);
    assert.equal(m.needsLook, false);
    assert.equal(m.paidTotal, 8.25);
    assert.equal(m.lunch.paid, false);
  });
});

describe('still in / forgot to clock out', () => {
  test('open session today: Still in, no actions, hours so far', () => {
    const m = dayModel({sessions: [{...rec(9, 12, null), date: TODAY, clock_in: new Date(2026, 9, 8, 9, 12).toISOString()}], date: TODAY, today: TODAY, now: new Date(2026, 9, 8, 11, 30)});
    assert.equal(m.chip.id, 'still-in');
    assert.deepEqual(m.callout.actions, []);
    assert.ok(Math.abs(m.sessions[0].soFar - 2.3) < 0.01);
    assert.equal(m.sessions[0].slots.out, 'not-yet');
    assert.equal(m.paidTotal, null);
  });
  test('open session on a past day: Needs clock-out (open-past)', () => {
    const m = model([rec(9, 0, null)]);
    assert.equal(m.chip.id, 'needs-clock-out');
    assert.equal(m.callout.id, 'open-past');
  });
  test('auto-closed at midnight: Needs clock-out, counted to closing, one primary action', () => {
    const auto = rec(14, 2, 0, 0, {clock_out: at(0, 0, 1), out_photo: null});
    const m = model([auto]);
    assert.equal(m.chip.id, 'needs-clock-out');
    assert.equal(new Date(m.callout.params.countedTo).getHours(), 18);
    assert.equal(m.callout.params.paid, 4);
    assert.equal(m.callout.actions.filter(a => a.primary).length, 1);
    assert.equal(m.sessions[0].slots.out, 'auto');
  });
});

describe('Check punches', () => {
  const auto = (h, mi) => rec(h, mi, 0, 0, {clock_out: at(0, 0, 1), out_photo: null});
  test('missed morning clock-in: last session starts after closing', () => {
    const m = model([rec(13, 5, 14, 0), auto(18, 5)]);
    assert.equal(m.chip.id, 'check-punches');
    assert.equal(m.problems[0].kind, 'late-start');
    assert.equal(m.callout.actions[0].id, 'add-punch');
    assert.equal(m.callout.actions[0].primary, true);
    assert.equal(m.needsLook, true);
  });
  test('missed lunch tap reads the same way', () => {
    const m = model([rec(9, 10, 13, 58), auto(18, 2)]);
    assert.equal(m.chip.id, 'check-punches');
  });
  test('a session over 11 hours is flagged, exactly 11 is not', () => {
    assert.equal(sessionProblems([rec(9, 43, 21, 58)])[0].kind, 'long');
    assert.equal(sessionProblems([rec(9, 0, 20, 0)]).length, 0);
  });
  test('a session under 10 minutes is flagged, exactly 10 is not', () => {
    assert.equal(sessionProblems([rec(9, 1, 9, 4), rec(9, 6, 13, 0)])[0].kind, 'short');
    assert.equal(sessionProblems([rec(9, 0, 9, 10), rec(9, 30, 13, 0)]).length, 0);
  });
  test('overlapping sessions are flagged with the minutes paid twice, even if edited', () => {
    const edited = {edited_at: '2026-10-08T10:00:00.000Z', orig_clock_in: at(14, 0), orig_clock_out: at(18, 0)};
    const p = sessionProblems([rec(9, 0, 14, 30), rec(14, 0, 18, 0, edited)]);
    assert.deepEqual(p.map(x => x.kind), ['overlap']);
    assert.equal(p[0].minutes, 30);
    assert.equal(p[0].index, 1);
  });
  test('a session the owner already edited is not second-guessed for being short, long or late', () => {
    const edited = {edited_at: '2026-10-08T10:00:00.000Z', orig_clock_in: at(9, 0), orig_clock_out: at(9, 3)};
    assert.equal(sessionProblems([rec(9, 0, 9, 3, edited), rec(13, 0, 18, 0)]).length, 0);
  });
  test('needs-clock-out outranks check-punches', () => {
    const m = model([rec(9, 1, 9, 4), rec(14, 0, 0, 0, {clock_out: at(0, 0, 1), out_photo: null})]);
    assert.equal(m.chip.id, 'needs-clock-out');
  });
});

describe('owner changes', () => {
  test('owner entered the real clock-out of an auto-closed session: Edited, not flagged', () => {
    const fixed = rec(14, 2, 18, 0, {out_photo: null, edited_at: '2026-10-08T14:00:00.000Z', orig_clock_in: at(14, 2), orig_clock_out: at(0, 0, 1)});
    const m = model([fixed]);
    assert.equal(m.chip.id, 'edited');
    assert.equal(m.needsLook, false);
    assert.equal(m.sessions[0].slots.out, 'owner');
  });
  test('a record the owner created: Added by you, owner slots on both sides', () => {
    const added = rec(9, 15, 18, 5, {in_photo: null, out_photo: null, edited_at: '2026-10-08T10:00:00.000Z', orig_clock_in: null, orig_clock_out: null});
    const m = model([added]);
    assert.equal(m.chip.id, 'added');
    assert.deepEqual(m.sessions[0].slots, {in: 'owner', out: 'owner'});
  });
  test('lunch paid as work shows in the lunch summary', () => {
    const m = model([rec(9, 0, 13, 0, {lunch_paid: true}), rec(14, 0, 18, 0)]);
    assert.equal(m.lunch.paid, true);
    assert.equal(m.paidTotal, 9);
  });
  test('overtime is added to the paid total and shown as a chip when nothing else applies', () => {
    const m = model([rec(9, 16, 13, 1), rec(14, 11, 18, 7)], {overtimeHours: 2});
    assert.equal(m.paidTotal, 9.5);
    assert.equal(m.chip.id, 'overtime');
  });
});

describe('plain days', () => {
  test('one long unbroken session: No lunch punch? with a Split for lunch action', () => {
    const m = model([rec(9, 2, 18, 13)]);
    assert.equal(m.chip.id, 'no-lunch');
    assert.equal(m.callout.actions[0].id, 'split');
  });
  test('afternoon-only day is a half day, not a problem', () => {
    const m = model([rec(14, 5, 18, 5)]);
    assert.equal(m.chip.id, 'half-day');
    assert.equal(m.needsLook, false);
    assert.deepEqual(m.problems, []);
  });
  test("today's morning session is not called a half day while the day is still going", () => {
    const m = dayModel({sessions: [{...rec(9, 40, 13, 30), date: TODAY}], date: TODAY, today: TODAY, now: new Date(2026, 9, 8, 15, 0)});
    assert.equal(m.chip, null);
  });
  test('three sessions: the one gap nearest lunch is Lunch, with all sessions listed', () => {
    const m = model([rec(9, 2, 12, 30), rec(13, 30, 15, 30), rec(15, 45, 18, 13)]);
    assert.equal(m.sessions.length, 3);
    assert.equal(m.lunch.index, 1);
  });
});

describe('a punch not uploaded yet', () => {
  test('Syncing, and the photo slot says it is uploading', () => {
    const m = model([rec(9, 10, 18, 5, {_sync: {pending: true, inPhoto: false, outPhoto: true}}), ]);
    assert.equal(m.chip.id, 'syncing');
    assert.deepEqual(m.callout.actions, []);
    assert.equal(m.sessions[0].slots.out, 'uploading');
    assert.equal(m.needsLook, false);
  });
  test('a real problem outranks Syncing', () => {
    const m = model([rec(9, 1, 9, 4, {_sync: {pending: true}}), rec(9, 6, 13, 0)]);
    assert.equal(m.chip.id, 'check-punches');
  });
  test('a synced open session is not Syncing', () => {
    const m = dayModel({sessions: [{...rec(9, 12, null), date: TODAY, clock_in: new Date(2026, 9, 8, 9, 12).toISOString(), _sync: {pending: false}}], date: TODAY, today: TODAY, now: new Date(2026, 9, 8, 11, 30)});
    assert.equal(m.chip.id, 'still-in');
  });
});

describe('days with no punches', () => {
  const weekday = d => new Date(d + 'T12:00:00').getDay();
  const morning = new Date(2026, 9, 8, 9, 40), evening = new Date(2026, 9, 8, 22, 40);
  test('today before the shop closes: Not in yet', () => {
    assert.equal(emptyDayModel({date: TODAY, today: TODAY, weekday: weekday(TODAY), now: morning}).chip.id, 'not-in-yet');
  });
  test('today after the shop closes: Absent, like the Report says', () => {
    const m = emptyDayModel({date: TODAY, today: TODAY, weekday: weekday(TODAY), now: evening});
    assert.equal(m.chip.id, 'absent');
    assert.equal(m.needsLook, true);
  });
  test('a weekly holiday that is today is a holiday, not Not in yet', () => {
    // 2026-10-09 is a Friday
    assert.equal(emptyDayModel({date: '2026-10-09', today: '2026-10-09', weekday: 5, now: new Date(2026, 9, 9, 9, 40)}).chip.id, 'holiday');
  });
  test('a past working day: Absent, with Add missed punch as the primary action', () => {
    const m = emptyDayModel({date: '2026-10-07', today: TODAY, weekday: weekday('2026-10-07')});
    assert.equal(m.chip.id, 'absent');
    assert.equal(m.callout.actions[0].primary, true);
    assert.equal(m.needsLook, true);
  });
  test('the weekly holiday (Friday): Holiday, nothing to do', () => {
    const m = emptyDayModel({date: '2026-10-02', today: TODAY, weekday: weekday('2026-10-02')});
    assert.equal(m.chip.id, 'holiday');
    assert.deepEqual(m.callout.actions, []);
  });
  test('a future day, or a day before the person was added: no row', () => {
    assert.equal(emptyDayModel({date: '2026-10-09', today: TODAY, weekday: 5}), null);
    assert.equal(emptyDayModel({date: '2026-10-07', today: TODAY, weekday: 3, employeeSince: '2026-10-08'}), null);
  });
});

describe('slotTypes', () => {
  test('a photographed punch', () => assert.deepEqual(slotTypes(rec(9, 0, 13, 0)), {in: 'photo', out: 'photo'}));
  test('open session', () => assert.equal(slotTypes(rec(9, 0, null)).out, 'not-yet'));
  test('missing photo with no explanation', () => assert.deepEqual(slotTypes(rec(9, 0, 13, 0, {in_photo: null, out_photo: null})), {in: 'missing', out: 'missing'}));
});
