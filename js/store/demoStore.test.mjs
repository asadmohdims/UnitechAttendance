// Regression coverage for a real bug found while testing the salary feature: demoStore's
// employee loader was unconditionally resetting name/avatar back to the hardcoded seed data
// on every single read, silently undoing any rename. Run with: node --test js/
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Node has no built-in localStorage — this is a minimal in-memory stand-in, not a mocking
// library, so the "no new dependencies" constraint holds for tests too.
function makeLocalStorage(){
  const data = new Map();
  return {
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    clear: () => data.clear()
  };
}
globalThis.localStorage = makeLocalStorage();

// demoStore.js reads `localStorage` as a bare global at module-load time in some browsers'
// module resolution, so the shim above must exist before this import runs.
const { demoStore } = await import('./demoStore.js');

beforeEach(() => { globalThis.localStorage.clear(); });

describe('demoStore employees', () => {
  test('a fresh store seeds the three sample employees', async () => {
    const emps = await demoStore.listEmployees();
    assert.deepEqual(emps.map(e => e.name), ['Shakib', 'Jamshed', 'Raju']);
  });

  // This is the exact scenario that was broken: rename, then read again.
  test('a rename survives a subsequent read (the bug this guards against)', async () => {
    const [shakib] = await demoStore.listEmployees();
    await demoStore.renameEmployee(shakib.id, 'Shakib Karim');

    const afterOneRead = await demoStore.listEmployees();
    assert.equal(afterOneRead.find(e => e.id === shakib.id).name, 'Shakib Karim');

    // The original bug specifically reasserted itself on the *second* read, since the first
    // renameEmployee() call's own internal loadEmployeesRaw() masked it — so read twice more.
    const afterTwoReads = await demoStore.listEmployees();
    assert.equal(afterTwoReads.find(e => e.id === shakib.id).name, 'Shakib Karim');
  });

  test('renaming does not disturb other employees or their avatars', async () => {
    const [shakib, jamshed] = await demoStore.listEmployees();
    await demoStore.renameEmployee(shakib.id, 'Shakib Karim');

    const emps = await demoStore.listEmployees();
    const stillJamshed = emps.find(e => e.id === jamshed.id);
    assert.equal(stillJamshed.name, 'Jamshed');
    assert.equal(stillJamshed.avatar, 'assets/avatars/jamshed.png');
  });
});

describe('demoStore salary rates', () => {
  test('a saved rate round-trips through listSalaryRates', async () => {
    const [shakib] = await demoStore.listEmployees();
    await demoStore.setSalaryRate(shakib.id, {monthlySalary: 18000, effectiveFrom: '2026-09-01', note: null});

    const rates = await demoStore.listSalaryRates(shakib.id);
    assert.equal(rates.length, 1);
    assert.equal(rates[0].monthly_salary, 18000);
    assert.equal(rates[0].effective_from, '2026-09-01');
  });

  test('multiple amendments are all kept, newest effective_from first', async () => {
    const [shakib] = await demoStore.listEmployees();
    await demoStore.setSalaryRate(shakib.id, {monthlySalary: 18000, effectiveFrom: '2026-09-01', note: null});
    await demoStore.setSalaryRate(shakib.id, {monthlySalary: 20000, effectiveFrom: '2026-09-09', note: null});

    const rates = await demoStore.listSalaryRates(shakib.id);
    assert.equal(rates.length, 2);
    assert.equal(rates[0].effective_from, '2026-09-09');
    assert.equal(rates[1].effective_from, '2026-09-01');
  });

  test('rates for one employee do not leak into another employee\'s list', async () => {
    const [shakib, jamshed] = await demoStore.listEmployees();
    await demoStore.setSalaryRate(shakib.id, {monthlySalary: 18000, effectiveFrom: '2026-09-01', note: null});

    assert.equal((await demoStore.listSalaryRates(jamshed.id)).length, 0);
  });
});
