// Pure two-sided payment reconciliation math — no store/DOM access, same pattern as
// reportMath.js/rounding.js. There's no in-app confirm/dispute step for a payment — these
// functions only ever classify what's already been independently logged by each side.

// One employee+date's payment rows -> {employeeTotal, ownerTotal, status}. Assumes at least
// one row (callers only ever call this on a bucket groupByEmployeeDate() actually produced,
// which by construction never holds a day with zero payments).
export function reconcileDay(dayPayments){
  const employeeTotal = sumBy(dayPayments, 'employee');
  const ownerTotal = sumBy(dayPayments, 'owner');
  const hasEmployee = dayPayments.some(p => p.entered_by === 'employee');
  const hasOwner = dayPayments.some(p => p.entered_by === 'owner');
  let status;
  if(hasEmployee && hasOwner) status = employeeTotal === ownerTotal ? 'matched' : 'mismatch';
  else if(hasEmployee) status = 'awaiting-owner';
  else status = 'awaiting-employee';
  return {employeeTotal, ownerTotal, status};
}

function sumBy(payments, enteredBy){
  return payments.filter(p => p.entered_by === enteredBy).reduce((sum, p) => sum + p.amount, 0);
}

// Groups a flat payments array into one bucket per employee+date — the unit both the kiosk's
// single-employee monthly view and the admin's all-employee view reconcile independently.
export function groupByEmployeeDate(payments){
  const map = new Map();
  for(const p of payments){
    const key = `${p.emp_id}:${p.occurred_on}`;
    if(!map.has(key)) map.set(key, {emp_id: p.emp_id, date: p.occurred_on, payments: []});
    map.get(key).payments.push(p);
  }
  return [...map.values()];
}

// Sum of this employee's own logged amounts — what the kiosk landing screen's "logged this
// month" figure shows. Deliberately not the reconciled/matched amount: the whole point of the
// screen is showing what THEY said, independent of what the owner said.
export function employeeLoggedTotal(payments){
  return payments.filter(p => p.entered_by === 'employee').reduce((sum, p) => sum + p.amount, 0);
}

// A day's one representative amount for a month-level total: the shared amount when matched,
// whichever single side actually logged when only one has, and the larger of the two when
// mismatched (a conservative "at least this much changed hands" reading — it's flagged either
// way, so the summary shouldn't quietly under-count it).
function effectiveAmount({employeeTotal, ownerTotal, status}){
  if(status === 'mismatch') return Math.max(employeeTotal, ownerTotal);
  return employeeTotal || ownerTotal;
}

// Rolls a set of employee+date groups (groupByEmployeeDate()'s output) up into the admin
// Payments tab's metrics strip.
export function paymentsSummary(groupedDays){
  let totalLogged = 0, matchedCount = 0, awaitingCount = 0, mismatchCount = 0;
  for(const day of groupedDays){
    const r = reconcileDay(day.payments);
    totalLogged += effectiveAmount(r);
    if(r.status === 'matched') matchedCount++;
    else if(r.status === 'mismatch') mismatchCount++;
    else awaitingCount++;
  }
  return {totalLogged, matchedCount, awaitingCount, mismatchCount};
}
