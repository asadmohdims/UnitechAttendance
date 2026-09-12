import { $, busy, toast, pad, dateStr, shiftMonthInput, hapticSuccess, hapticError } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { promptModal } from './modal.js';
import { refreshAll, renderHome } from './kiosk.js';
import { renderEmployees } from './employees.js';
import { generateSalt, hashPin, verifyPin } from '../pin.js';
import { reconcileDay, groupByEmployeeDate, employeeLoggedTotal, paymentsSummary } from '../paymentsMath.js';

function fmtRupee(n){ return '₹' + Math.round(n).toLocaleString('en-IN'); }

function fmtDateLong(isoDate){
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {weekday:'long', month:'long', day:'numeric'});
}

function fmtLoggedAt(iso){
  return new Date(iso).toLocaleString('en-IN', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
}

function monthRange(yearMonth){
  const [y, m] = yearMonth.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  return {fromDate: `${yearMonth}-01`, toDate: `${yearMonth}-${pad(days)}`};
}

// Admin-only — reconciliation status (matched/mismatch/awaiting) is never shown to an employee
// on the kiosk (the owner's call: an employee logging their own payment shouldn't be shown
// whether it agrees with the owner's side; that's the owner's reconciliation to work through,
// not something to surface mid-shift on a shared tablet).
const CHIP_CLASS = {matched:'matched', 'awaiting-owner':'awaiting', 'awaiting-employee':'awaiting', mismatch:'mismatch'};
const CHIP_GLYPH = {matched:'✓', 'awaiting-owner':'…', 'awaiting-employee':'…', mismatch:'!'};
const CHIP_LABEL = {matched:'Matched', 'awaiting-owner':'Awaiting you', 'awaiting-employee':'Awaiting employee', mismatch:'Mismatch'};
function chipFor(status){
  const span = document.createElement('span');
  span.className = 'status-chip ' + CHIP_CLASS[status];
  span.textContent = `${CHIP_GLYPH[status]} ${CHIP_LABEL[status]}`;
  return span;
}
function resolvedChip(){
  const span = document.createElement('span');
  span.className = 'status-chip resolved';
  span.textContent = '✓ Resolved';
  return span;
}

/* ==================== KIOSK SIDE ==================== */

let activeEmployee = null;
let pinDigits = '';
let pinAttempts = 0;
let amountDigits = '';

// Toggles the kiosk's tile grid between Attendance and Payments — a standalone side-panel
// control (not mixed into the attendance tiles), per the approved design.
export function togglePaymentsMode(){
  state.kioskMode = state.kioskMode === 'payments' ? 'attendance' : 'payments';
  renderHome();
}

// Called by kiosk.js's renderHome() when state.kioskMode is 'payments' — builds the same tile
// grid area with simplified, clock-state-free tiles (there's nothing to show here besides "tap
// your name"; privacy from other employees comes from the PIN behind the tap, not from hiding
// anything on the tile itself).
export function renderPaymentsGrid(){
  const grid = $('empGrid');
  grid.innerHTML = '';
  const active = state.employees.filter(e => e.active);
  $('homeEmpty').style.display = active.length ? 'none' : '';
  active.forEach(e => {
    const div = document.createElement('div');
    div.className = 'badge-tile';
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.innerHTML = '<img class="avatar" alt=""><div class="name"></div><div class="status">Tap to log a payment</div>';
    const avatar = div.querySelector('.avatar');
    applyAvatar(avatar, e);
    avatar.alt = e.name;
    div.querySelector('.name').textContent = e.name;
    div.onclick = () => paymentsTileTap(e);
    div.onkeydown = ev => { if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); paymentsTileTap(e); } };
    grid.appendChild(div);
  });
}

// The PIN pad, monthly summary, and add-payment form are one continuous flow inside a single
// overlay (#paymentFlowModal) — only entering/leaving the flow fades; switching between these
// three screens is an instant display swap, so two overlays never end up cross-fading over each
// other (that was the cause of the flicker between screens — each used to be its own
// independently-animating .modal-overlay).
function showFlowScreen(id){
  ['pinScreen', 'pmScreen', 'apScreen'].forEach(s => { $(s).style.display = s === id ? '' : 'none'; });
}

function closePaymentFlow(){
  $('paymentFlowModal').classList.remove('open');
  activeEmployee = null;
}

function paymentsTileTap(emp){
  activeEmployee = emp;
  pinDigits = '';
  pinAttempts = 0;
  openPinModal();
}

function openPinModal(){
  $('pinTitle').textContent = `Enter PIN for ${activeEmployee.name}`;
  applyAvatar($('pinAvatar'), activeEmployee);
  $('pinAvatar').alt = activeEmployee.name;
  $('pinError').innerHTML = '&nbsp;';
  $('pinLocked').style.display = 'none';
  $('pinKeypad').classList.remove('disabled');
  updatePinDots(false);
  showFlowScreen('pinScreen');
  $('paymentFlowModal').classList.add('open');
}

function updatePinDots(error){
  const dotsEl = $('pinDots');
  [...dotsEl.children].forEach((dot, i) => {
    dot.className = 'pin-dot' + (error ? ' error' : i < pinDigits.length ? ' filled' : '');
  });
  if(error){
    // Remove-then-reflow-then-add so three wrong PINs in a row each get their own shake,
    // rather than the 2nd/3rd being a no-op because the class was already present.
    dotsEl.classList.remove('shake');
    void dotsEl.offsetWidth;
    dotsEl.classList.add('shake');
    hapticError();
  }
}

$('pinKeypad').addEventListener('click', e => {
  const btn = e.target.closest('button[data-digit]');
  if(btn) handlePinDigit(btn.dataset.digit);
});
$('pinBackspace').onclick = () => { pinDigits = pinDigits.slice(0, -1); updatePinDots(false); };
$('pinCancel').onclick = closePaymentFlow;

function handlePinDigit(digit){
  if(pinDigits.length >= 4) return;
  pinDigits += digit;
  updatePinDots(false);
  if(pinDigits.length === 4) verifyEnteredPin();
}

async function verifyEnteredPin(){
  busy(true);
  let ok = false, noPin = false;
  try{
    const rec = await store.getEmployeePinRecord(activeEmployee.id);
    if(!rec) noPin = true;
    else ok = await verifyPin(pinDigits, rec.salt, rec.hash);
  }catch(err){
    busy(false);
    toast('Failed: ' + err.message);
    pinDigits = '';
    updatePinDots(false);
    return;
  }
  busy(false);
  if(ok){
    openMonthLanding();
    return;
  }
  pinDigits = '';
  updatePinDots(true);
  if(noPin){
    $('pinError').textContent = 'No PIN set for you yet — ask the owner.';
    return;
  }
  pinAttempts++;
  if(pinAttempts >= 3){
    $('pinError').innerHTML = '&nbsp;';
    $('pinKeypad').classList.add('disabled');
    $('pinLocked').style.display = '';
  }else{
    $('pinError').textContent = `Incorrect PIN. ${3 - pinAttempts} attempt${3 - pinAttempts === 1 ? '' : 's'} left.`;
  }
}

async function openMonthLanding(){
  $('pmAvatar').alt = activeEmployee.name;
  applyAvatar($('pmAvatar'), activeEmployee);
  $('pmName').textContent = activeEmployee.name;
  await renderMonthLanding();
  showFlowScreen('pmScreen');
}

async function renderMonthLanding(){
  const ym = dateStr().slice(0, 7);
  const {fromDate, toDate} = monthRange(ym);
  const [y, m] = ym.split('-').map(Number);
  $('pmMonth').textContent = new Date(y, m - 1, 1).toLocaleDateString('en-IN', {month:'long', year:'numeric'});

  busy(true);
  let payments = [];
  try{ payments = await store.listPaymentsForEmployeeRange(activeEmployee.id, fromDate, toDate); }
  catch(err){ toast('Load failed: ' + err.message); }
  busy(false);

  $('pmTotal').textContent = fmtRupee(employeeLoggedTotal(payments));

  const groups = groupByEmployeeDate(payments).sort((a, b) => b.date.localeCompare(a.date));
  const list = $('pmEntries');
  list.innerHTML = '';
  $('pmEmpty').style.display = groups.length ? 'none' : '';
  groups.forEach(g => {
    const row = document.createElement('div');
    row.className = 'recent-row';
    const left = document.createElement('div');
    const dateEl = document.createElement('div'); dateEl.className = 'recent-date'; dateEl.textContent = fmtDateLong(g.date);
    // Only ever shows what THIS employee logged, never the owner's amount or whether it
    // matches — reconciliation is the owner's job to work through on the admin side, not
    // something to surface to an employee mid-shift on a shared tablet (the owner's explicit
    // call). Reconciliation itself correctly sums same-day entries (see reconcileDay(), used
    // only on the admin side now), but this display must not silently collapse two real,
    // separately-logged entries into one number — list each one so logging twice in a day is
    // visibly two entries, not a mysteriously bigger total.
    const ownEntries = g.payments.filter(p => p.entered_by === 'employee');
    const metaEl = document.createElement('div'); metaEl.className = 'recent-meta';
    metaEl.textContent = ownEntries.length
      ? ownEntries.map(p => fmtRupee(p.amount)).join(' + ')
      : 'Not yet logged by you';
    left.append(dateEl, metaEl);
    row.append(left);
    list.appendChild(row);
  });
}

$('pmBack').onclick = closePaymentFlow;
$('pmAdd').onclick = openAddPayment;

function openAddPayment(){
  amountDigits = '';
  applyAvatar($('apAvatar'), activeEmployee);
  $('apAvatar').alt = activeEmployee.name;
  $('apName').textContent = activeEmployee.name;
  $('apAmount').textContent = '0';
  $('apDate').value = dateStr();
  $('apErr').textContent = '';
  showFlowScreen('apScreen');
}

function refreshAmountDisplay(){
  $('apAmount').textContent = Number(amountDigits || '0').toLocaleString('en-IN');
}
$('apKeypad').addEventListener('click', e => {
  const btn = e.target.closest('button[data-digit]');
  if(!btn) return;
  if(amountDigits.length < 7) amountDigits += btn.dataset.digit; // caps at 9,999,999 — plenty for cash pay
  refreshAmountDisplay();
});
$('apBackspace').onclick = () => { amountDigits = amountDigits.slice(0, -1); refreshAmountDisplay(); };
$('apBack').onclick = () => openMonthLanding();

$('apSave').onclick = async () => {
  const amount = Number(amountDigits);
  const occurredOn = $('apDate').value;
  if(!amount){ $('apErr').textContent = 'Enter an amount.'; return; }
  if(!occurredOn){ $('apErr').textContent = 'Pick a date.'; return; }
  busy(true);
  try{
    await store.addPayment(activeEmployee.id, amount, occurredOn, 'employee');
    busy(false);
    const name = activeEmployee.name; // read before finishPaymentFlow() clears activeEmployee
    $('paymentFlowModal').classList.remove('open');
    showPaymentConfirm(name, amount, occurredOn);
  }catch(err){
    busy(false);
    $('apErr').textContent = 'Couldn’t save — check Wi-Fi and try again.';
  }
};

function finishPaymentFlow(){
  $('paymentConfirm').classList.remove('open');
  activeEmployee = null;
  // The owner's explicit call: saving always returns to Attendance, never back to the
  // Payments tile grid.
  state.kioskMode = 'attendance';
  renderHome();
}
$('paymentConfirm').onclick = finishPaymentFlow;

function showPaymentConfirm(name, amount, occurredOn){
  $('pymName').textContent = name;
  $('pymDetail').innerHTML = `${fmtRupee(amount)} · ${fmtDateLong(occurredOn)}<br>This will show in your payments this month`;
  $('paymentConfirm').classList.add('open');
  hapticSuccess();
  clearTimeout(showPaymentConfirm._t);
  showPaymentConfirm._t = setTimeout(finishPaymentFlow, 1800);
}

/* ==================== ADMIN SIDE ==================== */

const payMonth = $('payMonth');
payMonth.value = dateStr().slice(0, 7);
payMonth.onchange = renderPayments;
$('btnPayPrevMonth').onclick = () => shiftMonthInput(payMonth, -1, renderPayments);
$('btnPayNextMonth').onclick = () => shiftMonthInput(payMonth, 1, renderPayments);

// Which employee row (if any) is expanded, and within it, which date's side-by-side detail
// panel is expanded — same keyed-by-string, rebuild-and-restore approach as report.js's
// openDetailKey, just at two nested levels since the list is now employee-first.
let openEmpKey = null;
let openPayDetailKey = null;

export async function renderPayments(){
  const {fromDate, toDate} = monthRange(payMonth.value);
  busy(true);
  let payments = [], resolutions = [];
  try{
    payments = await store.listPaymentsForRange(fromDate, toDate);
    resolutions = await store.listPaymentResolutions(fromDate, toDate);
  }catch(err){
    toast('Load failed: ' + err.message);
    busy(false);
    return;
  }
  busy(false);

  const resolvedSet = new Set(resolutions.filter(r => r.resolved).map(r => `${r.emp_id}:${r.date}`));
  const groups = groupByEmployeeDate(payments).sort((a, b) => b.date.localeCompare(a.date));

  renderPaySummary(groups, resolvedSet);
  renderPayAlert(groups, resolvedSet);
  renderPayList(groups, resolvedSet);
}

function unresolvedMismatches(groups, resolvedSet){
  return groups.filter(g => reconcileDay(g.payments).status === 'mismatch' && !resolvedSet.has(`${g.emp_id}:${g.date}`));
}

function renderPaySummary(groups, resolvedSet){
  const summary = paymentsSummary(groups);
  $('metricPayTotal').textContent = fmtRupee(summary.totalLogged);
  $('metricPayMatched').textContent = summary.matchedCount;
  $('metricPayAwaiting').textContent = summary.awaitingCount;
  $('metricPayMismatch').textContent = unresolvedMismatches(groups, resolvedSet).length;
}

function renderPayAlert(groups, resolvedSet){
  const flagged = unresolvedMismatches(groups, resolvedSet);
  const alertEl = $('payAlert');
  if(!flagged.length){ alertEl.style.display = 'none'; return; }
  alertEl.style.display = '';
  $('payAlertTitle').textContent = `${flagged.length} payment${flagged.length === 1 ? '' : 's'} need${flagged.length === 1 ? 's' : ''} reconciliation`;
  const first = flagged[0];
  const emp = state.employees.find(e => e.id === first.emp_id);
  $('payAlertText').textContent = emp
    ? `${emp.name}'s entry doesn't match yours for ${fmtDateLong(first.date)} — see below.`
    : 'See below.';
}

function groupByEmployee(dayGroups){
  const map = new Map();
  dayGroups.forEach(g => {
    if(!map.has(g.emp_id)) map.set(g.emp_id, []);
    map.get(g.emp_id).push(g);
  });
  return [...map.entries()];
}

// The employee-level row's summary chip: worst-case status across all their days this
// month — an unresolved mismatch outranks "awaiting", which outranks "all matched" — so a
// glance at the collapsed list tells the owner who actually needs a look.
function employeeStatusChip(days, resolvedSet){
  const unresolved = unresolvedMismatches(days, resolvedSet);
  const summary = paymentsSummary(days);
  const span = document.createElement('span');
  if(unresolved.length){
    span.className = 'status-chip mismatch';
    span.textContent = `! ${unresolved.length} mismatch${unresolved.length === 1 ? '' : 'es'}`;
  }else if(summary.awaitingCount){
    span.className = 'status-chip awaiting';
    span.textContent = `… ${summary.awaitingCount} awaiting`;
  }else{
    span.className = 'status-chip matched';
    span.textContent = '✓ All matched';
  }
  return span;
}

function renderPayList(groups, resolvedSet){
  const list = $('paymentsList');
  list.innerHTML = '';
  $('paymentsEmpty').style.display = groups.length ? 'none' : '';
  $('paymentsCountLabel').textContent = groups.length ? `${groups.length} entr${groups.length === 1 ? 'y' : 'ies'}` : '';

  const byEmployee = groupByEmployee(groups)
    .map(([empId, days]) => ({
      empId, emp: state.employees.find(e => e.id === empId),
      days: days.slice().sort((a, b) => b.date.localeCompare(a.date))
    }))
    .sort((a, b) => (a.emp ? a.emp.name : '').localeCompare(b.emp ? b.emp.name : ''));

  byEmployee.forEach(({empId, emp, days}) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'pay-group';

    const row = document.createElement('div');
    row.className = 'pay-row';
    row.tabIndex = 0;

    const avatar = document.createElement('img'); avatar.className = 'pay-avatar'; avatar.alt = '';
    if(emp) applyAvatar(avatar, emp);

    const who = document.createElement('div');
    const name = document.createElement('div'); name.className = 'pay-name'; name.textContent = emp ? emp.name : '?';
    const sub = document.createElement('div'); sub.className = 'pay-sub';
    sub.textContent = `${days.length} day${days.length === 1 ? '' : 's'} this month`;
    who.append(name, sub);

    const amountWrap = document.createElement('div');
    const amountEl = document.createElement('div'); amountEl.className = 'pay-amount';
    amountEl.textContent = fmtRupee(paymentsSummary(days).totalLogged);
    amountWrap.append(amountEl, employeeStatusChip(days, resolvedSet));

    const chevron = document.createElement('div'); chevron.className = 'pay-chevron'; chevron.textContent = '›';

    row.append(avatar, who, amountWrap, chevron);

    const empDetailWrap = document.createElement('div');
    empDetailWrap.style.display = 'none';

    row.onclick = () => toggleEmpDetail(empId, row, empDetailWrap, days, emp, resolvedSet);
    groupEl.append(row, empDetailWrap);
    list.appendChild(groupEl);

    if(openEmpKey === empId){
      renderEmpDateList(empDetailWrap, days, emp, resolvedSet);
      empDetailWrap.style.display = '';
      chevron.classList.add('down');
    }
  });
}

// The date-wise breakdown shown once an employee's row is expanded — one sub-row per day,
// each independently expandable into the existing side-by-side owner/employee comparison.
function renderEmpDateList(container, days, emp, resolvedSet){
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'pay-emp-detail';

  days.forEach(g => {
    const r = reconcileDay(g.payments);
    const key = `${g.emp_id}:${g.date}`;
    const resolved = resolvedSet.has(key);

    const dateRow = document.createElement('div');
    dateRow.className = 'pay-date-row';

    const left = document.createElement('div');
    const dateEl = document.createElement('div'); dateEl.className = 'pay-name'; dateEl.textContent = fmtDateLong(g.date);
    const sub = document.createElement('div'); sub.className = 'pay-sub';
    sub.textContent = r.status === 'matched' ? 'Both sides logged'
      : r.status === 'mismatch' ? 'Both sides logged — amounts differ'
      : r.status === 'awaiting-owner' ? 'Logged by employee only'
      : 'Logged by you only';
    left.append(dateEl, sub);

    const amountWrap = document.createElement('div');
    const amountEl = document.createElement('div'); amountEl.className = 'pay-amount';
    amountEl.textContent = r.status === 'mismatch'
      ? `${fmtRupee(r.employeeTotal)} vs ${fmtRupee(r.ownerTotal)}`
      : fmtRupee(r.employeeTotal || r.ownerTotal);
    amountWrap.append(amountEl, resolved ? resolvedChip() : chipFor(r.status));

    const chevron = document.createElement('div'); chevron.className = 'pay-chevron'; chevron.textContent = '›';

    dateRow.append(left, amountWrap, chevron);

    const detailWrap = document.createElement('div');
    detailWrap.style.display = 'none';

    dateRow.onclick = () => togglePayDetail(key, dateRow, detailWrap, g, emp, resolved, wrap);
    wrap.append(dateRow, detailWrap);

    if(openPayDetailKey === key){
      renderPayDetail(detailWrap, g, emp, resolved);
      detailWrap.style.display = '';
      chevron.classList.add('down');
    }
  });

  container.appendChild(wrap);
}

function closeAllEmployeeRows(){
  document.querySelectorAll('#paymentsList .pay-group > div[style]').forEach(el => { el.style.display = 'none'; el.innerHTML = ''; });
  document.querySelectorAll('#paymentsList > .pay-group > .pay-row .pay-chevron').forEach(c => c.classList.remove('down'));
}

function toggleEmpDetail(empId, row, empDetailWrap, days, emp, resolvedSet){
  const isOpen = empDetailWrap.style.display !== 'none';
  closeAllEmployeeRows();
  openPayDetailKey = null; // collapsing/switching employees always resets the nested date selection
  if(isOpen){ openEmpKey = null; return; }
  renderEmpDateList(empDetailWrap, days, emp, resolvedSet);
  empDetailWrap.style.display = '';
  row.querySelector('.pay-chevron').classList.add('down');
  openEmpKey = empId;
}

// Scoped to `container` (one employee's date list) — toggling one date's detail must not
// collapse sibling dates' rows from a DIFFERENT employee, or the employee-level expand itself.
function closeAllDateRows(container){
  container.querySelectorAll('.pay-date-row + div').forEach(el => { el.style.display = 'none'; el.innerHTML = ''; });
  container.querySelectorAll('.pay-date-row .pay-chevron').forEach(c => c.classList.remove('down'));
}

function togglePayDetail(key, dateRow, detailWrap, g, emp, resolved, container){
  const isOpen = detailWrap.style.display !== 'none';
  closeAllDateRows(container);
  if(isOpen){ openPayDetailKey = null; return; }
  renderPayDetail(detailWrap, g, emp, resolved);
  detailWrap.style.display = '';
  dateRow.querySelector('.pay-chevron').classList.add('down');
  openPayDetailKey = key;
}

// Excludes clicks inside the payment list or the shared prompt modal — otherwise the panel a
// click just opened (or a promptModal opened from within it) closes a tick later, the same
// real failure mode report.js's own outside-click listener guards against.
document.addEventListener('click', e => {
  if(e.target.closest('#paymentsList') || e.target.closest('#promptModal')) return;
  closeAllEmployeeRows();
  openEmpKey = null;
  openPayDetailKey = null;
});

function renderPayDetail(container, g, emp, resolved){
  container.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'detail-panel';

  const cards = document.createElement('div');
  cards.className = 'detail-cards';
  cards.append(
    detailCard('Your entry (owner)', g.payments.filter(p => p.entered_by === 'owner'), emp),
    detailCard(emp ? `${emp.name.split(' ')[0]}'s entry` : 'Employee’s entry', g.payments.filter(p => p.entered_by === 'employee'), emp)
  );
  panel.appendChild(cards);

  if(reconcileDay(g.payments).status === 'mismatch') panel.appendChild(resolveRow(g, resolved));
  container.appendChild(panel);
}

function detailCard(label, entries, emp){
  const card = document.createElement('div');
  card.className = 'detail-card';
  const lbl = document.createElement('div'); lbl.className = 'detail-card-label'; lbl.textContent = label;
  card.appendChild(lbl);
  if(!entries.length){
    const empty = document.createElement('div'); empty.className = 'detail-card-meta'; empty.textContent = 'Not logged yet';
    card.appendChild(empty);
    return card;
  }
  entries.forEach(p => {
    const amt = document.createElement('div'); amt.className = 'detail-card-amount'; amt.textContent = fmtRupee(p.amount);
    const meta = document.createElement('div'); meta.className = 'detail-card-meta'; meta.textContent = `Logged ${fmtLoggedAt(p.created_at)}`;
    const actions = document.createElement('div'); actions.className = 'detail-card-actions';
    const bEdit = document.createElement('button'); bEdit.className = 'btn small ghost'; bEdit.textContent = 'Edit';
    bEdit.onclick = () => editPayment(p, emp);
    const bDel = document.createElement('button'); bDel.className = 'btn small red'; bDel.textContent = 'Delete';
    bDel.onclick = () => deletePaymentFlow(p, emp);
    actions.append(bEdit, bDel);
    card.append(amt, meta, actions);
  });
  return card;
}

function resolveRow(g, resolved){
  const row = document.createElement('div');
  row.className = 'resolve-row';
  const text = document.createElement('div'); text.className = 'resolve-row-text';
  text.innerHTML = resolved
    ? '<strong>Marked resolved</strong><span>Tap to undo — the amounts stay as entered.</span>'
    : '<strong>Mark as resolved</strong><span>Use this once you’ve talked it through — the amounts stay as entered.</span>';
  const btn = document.createElement('button'); btn.className = 'resolve-toggle';
  btn.textContent = resolved ? '✓ Resolved — undo' : 'Mark resolved';
  btn.onclick = () => toggleResolution(g, resolved);
  row.append(text, btn);
  return row;
}

async function toggleResolution(g, resolved){
  busy(true);
  try{
    await store.setPaymentResolution(g.emp_id, g.date, !resolved, null);
    openEmpKey = g.emp_id;
    openPayDetailKey = `${g.emp_id}:${g.date}`;
    await renderPayments();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

async function editPayment(p, emp){
  const result = await promptModal({
    title: `Edit payment — ${emp ? emp.name : ''}`,
    fields: [
      {name:'amount', label:'Amount', type:'number', value:p.amount, min:1},
      {name:'occurredOn', label:'Date', type:'date', value:p.occurred_on}
    ]
  });
  if(!result) return;
  busy(true);
  try{
    await store.updatePayment(p.id, Number(result.amount), result.occurredOn);
    await renderPayments();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

async function deletePaymentFlow(p, emp){
  const confirmed = await promptModal({
    title: `Delete this payment entry for ${emp ? emp.name : 'this employee'}?`,
    submitLabel: 'Delete', danger: true, fields: []
  });
  if(!confirmed) return;
  busy(true);
  try{
    await store.deletePayment(p.id);
    await renderPayments();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

$('btnLogPayment').onclick = async () => {
  const active = state.employees.filter(e => e.active);
  if(!active.length){ toast('Add an employee first.'); return; }
  const result = await promptModal({
    title: 'Log a payment',
    fields: [
      {name:'empId', label:'Employee', type:'select', options: active.map(e => ({value:e.id, label:e.name})), value: active[0].id},
      {name:'amount', label:'Amount', type:'number', min:1},
      {name:'occurredOn', label:'Date', type:'date', value: dateStr()}
    ]
  });
  if(!result) return;
  busy(true);
  try{
    await store.addPayment(result.empId, Number(result.amount), result.occurredOn, 'owner');
    toast('Payment logged.');
    await renderPayments();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
};

/* ==================== Employees tab: Set PIN ==================== */

// Owner-assigned PIN, per the approved design (not self-service). Exported so employees.js can
// add a "Set PIN" button per row alongside Rename/Deactivate.
export async function setEmployeePinFlow(emp){
  const result = await promptModal({
    title: `Set PIN — ${emp.name}`,
    // type:'text', not 'number' — a number input silently strips leading zeros (typing "0192"
    // reads back as "192"), which would make any PIN starting with 0 impossible to set.
    fields: [{name:'pin', label:'4-digit PIN', type:'text', inputmode:'numeric', pattern:'\\d{4}', maxlength:4, placeholder:'e.g. 4821'}]
  });
  if(!result) return;
  if(!/^\d{4}$/.test(result.pin)){ toast('PIN must be exactly 4 digits.'); return; }
  busy(true);
  try{
    const salt = generateSalt();
    const hash = await hashPin(result.pin, salt);
    await store.setEmployeePin(emp.id, hash, salt);
    await refreshAll();
    renderEmployees();
    toast(`PIN set for ${emp.name}.`);
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
};
