// localStorage-backed implementation of the store interface, used when DEMO_MODE is true.
import { dateStr } from '../utils.js';

const DEMO_EMPLOYEES_KEY = 'attendance_demo_employees';
const DEMO_RECORDS_KEY = 'attendance_demo_records';
const DEMO_PHOTOS_KEY = 'attendance_demo_photo:';
const DEMO_SALARY_KEY = 'attendance_demo_salary_rates';

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

async function clockOut(recordId, blob){
  const records = loadRecords();
  const idx = records.findIndex(r => r.id === recordId);
  if(idx < 0) throw new Error('Demo attendance record not found');
  const path = `${records[idx].emp_id}/${recordId}-out.jpg`;
  await uploadPhoto(path, blob);
  records[idx].clock_out = new Date().toISOString();
  records[idx].out_photo = path;
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
  listOpenSessions, clockIn, clockOut,
  listRecordsForDate, listRecordsForRange, updateRecordTimes, deleteRecord,
  uploadPhoto, getPhotoUrl, getSyncStatus,
  listSalaryRates, setSalaryRate
};
