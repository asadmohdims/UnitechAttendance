// localStorage-backed implementation of the store interface, used when DEMO_MODE is true.
import { dateStr } from '../utils.js';

const DEMO_EMPLOYEES_KEY = 'attendance_demo_employees';
const DEMO_RECORDS_KEY = 'attendance_demo_records';
const DEMO_PHOTOS_KEY = 'attendance_demo_photo:';
const DEMO_SALARY_KEY = 'attendance_demo_salary_rates';
const DEMO_OVERRIDES_KEY = 'attendance_demo_day_overrides';

function loadEmployeesRaw(){
  const sampleEmployees = [
    {id:'demo-1', name:'Shakib', active:true, avatar:'assets/avatars/shakib.png'},
    {id:'demo-2', name:'Jamshed', active:true, avatar:'assets/avatars/jamshed.png'},
    {id:'demo-3', name:'Raju', active:true, avatar:'assets/avatars/raju.png'}
  ];
  const savedEmployees = localStorage.getItem(DEMO_EMPLOYEES_KEY);
  let employees = savedEmployees ? JSON.parse(savedEmployees) : sampleEmployees;
  // Upgrade the original generic demo entries without deleting any names later added by an admin.
  const genericDemo = employees.length && employees.every(e => /^Employee \d+$/.test(e.name));
  if(genericDemo) employees = sampleEmployees;
  employees = employees.map(e => {
    if(e.avatar) return e;
    const sample = sampleEmployees.find(x => x.id === e.id);
    return sample ? {...e, avatar:sample.avatar} : e;
  }).filter(e => !['demo-4','demo-5'].includes(e.id));
  saveEmployees(employees);
  return employees;
}
function saveEmployees(employees){ localStorage.setItem(DEMO_EMPLOYEES_KEY, JSON.stringify(employees)); }
function loadRecords(){ return JSON.parse(localStorage.getItem(DEMO_RECORDS_KEY) || '[]'); }
function saveRecords(records){ localStorage.setItem(DEMO_RECORDS_KEY, JSON.stringify(records)); }
function photoKey(path){ return DEMO_PHOTOS_KEY + path; }

function listEmployees(){ return loadEmployeesRaw(); }

function listOpenSessions(){
  const openSessions = {};
  loadRecords().filter(r => !r.clock_out).forEach(r => { openSessions[r.emp_id] = r; });
  return openSessions;
}

function addEmployee(name){
  const employees = loadEmployeesRaw();
  const emp = {id:'demo-' + Date.now(), name, active:true};
  employees.push(emp);
  saveEmployees(employees);
  return emp;
}

function renameEmployee(id, name){
  const employees = loadEmployeesRaw();
  const e = employees.find(x => x.id === id);
  if(e) e.name = name;
  saveEmployees(employees);
}

function setEmployeeActive(id, active){
  const employees = loadEmployeesRaw();
  const e = employees.find(x => x.id === id);
  if(e) e.active = active;
  saveEmployees(employees);
}

function setEmployeeAvatar(id, path){
  const employees = loadEmployeesRaw();
  const e = employees.find(x => x.id === id);
  if(e) e.avatar = path;
  saveEmployees(employees);
}

// Admin-entered backfill for a day that has no punch at all (an absence turning out to be a
// missed punch, not a genuine no-show) — never has a photo, since nobody was at the camera.
// Same "admin desktop edit" category as updateRecordTimes/setLunchPaid, not a kiosk punch.
function addManualRecord(empId, date, clockInIso, clockOutIso){
  const id = 'demo-rec-' + Date.now();
  const nowIso = new Date().toISOString();
  const data = {id, emp_id:empId, date, clock_in:clockInIso, clock_out:clockOutIso, in_photo:null, out_photo:null, created_at:nowIso};
  const records = loadRecords();
  records.push(data);
  saveRecords(records);
  return data;
}

async function clockIn(empId, blob){
  const id = 'demo-rec-' + Date.now();
  const path = `${empId}/${id}-in.jpg`;
  await uploadPhoto(path, blob);
  const nowIso = new Date().toISOString();
  const data = {id, emp_id:empId, date:dateStr(), clock_in:nowIso, clock_out:null, in_photo:path, out_photo:null, created_at:nowIso};
  const records = loadRecords();
  records.push(data);
  saveRecords(records);
  return data;
}

// `atIso` lets a caller record an exact past instant (e.g. the lunch auto-close cutoff)
// instead of "now". `blob` is optional — an auto-close has no photo, so out_photo is only
// set when one was actually captured (matches supabaseStore.js's clockOut).
async function clockOut(recordId, blob, atIso){
  const records = loadRecords();
  const idx = records.findIndex(r => r.id === recordId);
  if(idx < 0) throw new Error('Demo attendance record not found');
  if(blob){
    const path = `${records[idx].emp_id}/${recordId}-out.jpg`;
    await uploadPhoto(path, blob);
    records[idx].out_photo = path;
  }
  records[idx].clock_out = atIso || new Date().toISOString();
  saveRecords(records);
  return records[idx];
}

async function getSyncStatus(){ return {pending:0, stuck:false}; }

function listRecordsForDate(date){
  return loadRecords().filter(r => r.date === date).sort((a, b) => new Date(a.clock_in) - new Date(b.clock_in));
}

function listRecordsForRange(startDate, endDate){
  return loadRecords().filter(r => r.date >= startDate && r.date <= endDate);
}

function updateRecordTimes(recordId, clockInIso, clockOutIsoOrNull){
  const records = loadRecords();
  const idx = records.findIndex(x => x.id === recordId);
  if(idx < 0) throw new Error('Record not found');
  records[idx].clock_in = clockInIso;
  records[idx].clock_out = clockOutIsoOrNull;
  saveRecords(records);
}

// Marks (or un-marks) the lunch gap right after this session as paid work — a reversible flag,
// never a data change to the punches themselves, so toggling it off undoes it completely.
function setLunchPaid(recordId, paid){
  const records = loadRecords();
  const idx = records.findIndex(x => x.id === recordId);
  if(idx < 0) throw new Error('Record not found');
  records[idx].lunch_paid = paid;
  saveRecords(records);
}

// Splits one continuous session into two around a lunch gap — the original record becomes the
// morning half (its real in_photo, but no out_photo — the split point itself was never
// photographed) and a new record covers the afternoon half, carrying the ORIGINAL out_photo
// (the one real "end of day" photo, moved rather than duplicated or lost) so the day's last
// session still has a genuine out_photo. Defaults lunch_paid: false on the morning half — same
// as every other path that creates a lunch gap (a normal clock-out, the auto-close safety net):
// an earlier version of this defaulted to true "so splitting doesn't change total pay", but that
// fought the actual common case (see isPossibleMissedLunch() in reportMath.js) — an owner
// reaching for Split for lunch almost always means "this gap should be unpaid", and had to
// immediately undo the default every time. Still one tap to flip via the "Pay this" toggle
// (js/ui/records.js) if a split really was just cosmetic and pay shouldn't change.
function splitSessionForLunch(recordId, lunchStartIso, lunchEndIso){
  const records = loadRecords();
  const idx = records.findIndex(x => x.id === recordId);
  if(idx < 0) throw new Error('Record not found');
  const original = records[idx];
  const afternoon = {
    id: 'demo-rec-' + Date.now(), emp_id: original.emp_id, date: original.date,
    clock_in: lunchEndIso, clock_out: original.clock_out,
    in_photo: null, out_photo: original.out_photo, created_at: new Date().toISOString()
  };
  records[idx] = {...original, clock_out: lunchStartIso, out_photo: null, lunch_paid: false};
  records.push(afternoon);
  saveRecords(records);
}

function deleteRecord(record){
  saveRecords(loadRecords().filter(x => x.id !== record.id));
  [record.in_photo, record.out_photo].filter(Boolean).forEach(p => localStorage.removeItem(photoKey(p)));
}

function loadSalaryRates(){ return JSON.parse(localStorage.getItem(DEMO_SALARY_KEY) || '[]'); }
function saveSalaryRates(rates){ localStorage.setItem(DEMO_SALARY_KEY, JSON.stringify(rates)); }

function listSalaryRates(empId){
  return loadSalaryRates().filter(r => r.emp_id === empId).sort((a, b) => b.effective_from.localeCompare(a.effective_from));
}

function setSalaryRate(empId, {monthlySalary, effectiveFrom, note}){
  const rates = loadSalaryRates();
  const row = {id:'demo-rate-' + Date.now(), emp_id:empId, monthly_salary:monthlySalary, effective_from:effectiveFrom, note:note || null, created_at:new Date().toISOString()};
  rates.push(row);
  saveSalaryRates(rates);
  return row;
}

function loadDayOverrides(){ return JSON.parse(localStorage.getItem(DEMO_OVERRIDES_KEY) || '[]'); }
function saveDayOverrides(rows){ localStorage.setItem(DEMO_OVERRIDES_KEY, JSON.stringify(rows)); }

function listDayPayOverrides(fromDate, toDate){
  return loadDayOverrides().filter(o => o.date >= fromDate && o.date <= toDate);
}

// Marks (or restores) a specific no-punch day's pay for an employee — e.g. docking a paid
// Friday holiday the owner doesn't want to pay through this month. One row per (emp_id, date),
// upserted in place — same reversible-flag shape as setLunchPaid, just keyed by date instead of
// a record id since a no-punch day has no record to attach a flag to.
function setDayOverride(empId, date, paid){
  const rows = loadDayOverrides();
  const idx = rows.findIndex(r => r.emp_id === empId && r.date === date);
  if(idx >= 0) rows[idx].paid = paid;
  else rows.push({id:'demo-override-' + Date.now(), emp_id:empId, date, paid, created_at:new Date().toISOString()});
  saveDayOverrides(rows);
}

function uploadPhoto(path, blob){
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => { localStorage.setItem(photoKey(path), reader.result); resolve(); };
    reader.readAsDataURL(blob);
  });
}

async function getPhotoUrl(path){
  if(!path) return null;
  return localStorage.getItem(photoKey(path));
}

export const demoStore = {
  listEmployees, addEmployee, renameEmployee, setEmployeeActive, setEmployeeAvatar,
  listOpenSessions, clockIn, clockOut, addManualRecord,
  listRecordsForDate, listRecordsForRange, updateRecordTimes, setLunchPaid, deleteRecord,
  splitSessionForLunch,
  uploadPhoto, getPhotoUrl, getSyncStatus,
  listSalaryRates, setSalaryRate,
  listDayPayOverrides, setDayOverride
};
