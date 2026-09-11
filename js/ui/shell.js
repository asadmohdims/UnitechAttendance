import { $, busy, toast } from '../utils.js';
import { DEMO_MODE } from '../config.js';
import { sb } from '../supabaseClient.js';
import { state, ADMIN_TABS } from '../state.js';
import { refreshAll } from './kiosk.js';
import { renderRecords } from './records.js';
import { renderReport } from './report.js';
import { renderEmployees } from './employees.js';
import { renderSalary } from './salary.js';

/* ---------- auth ---------- */
export async function initAuth(){
  if(DEMO_MODE){
    state.adminUnlocked = true;
    setAuthUI(true);
    $('loginModal').classList.remove('open');
    $('btnLogout').style.display = 'none';
    $('btnLock').style.display = 'none';
    await refreshAll();
    return;
  }
  const {data:{session}} = await sb.auth.getSession();
  setAuthUI(!!session);
  if(session) await refreshAll();
}
function setAuthUI(loggedIn){
  $('loginModal').classList.toggle('open', !loggedIn);
  $('btnLogout').style.display = loggedIn ? '' : 'none';
  $('btnLock').style.display = loggedIn && state.adminUnlocked ? '' : 'none';
}
$('btnLogin').onclick = async () => {
  const email = $('loginEmail').value.trim(), pass = $('loginPass').value;
  if(!email || !pass) return;
  busy(true); $('loginErr').textContent = '';
  const {error} = await sb.auth.signInWithPassword({email, password:pass});
  busy(false);
  if(error){ $('loginErr').textContent = error.message; return; }
  $('loginPass').value = '';
  setAuthUI(true);
  await refreshAll();
};
$('loginPass').addEventListener('keydown', e => { if(e.key === 'Enter') $('btnLogin').click(); });
$('btnLogout').onclick = async () => {
  if(DEMO_MODE){
    switchTab('home');
    toast('Demo mode — no sign-in is required.');
    return;
  }
  if(!confirm('Sign out? The tablet will need the password to use the app again.')) return;
  await sb.auth.signOut();
  state.adminUnlocked = false;
  location.reload();
};

/* admin lock */
let pendingTab = null;
function requestAdmin(tab){
  pendingTab = tab;
  $('adminErr').textContent = ''; $('adminPass').value = '';
  $('adminModal').classList.add('open');
  $('adminPass').focus();
}
$('btnUnlockCancel').onclick = () => { $('adminModal').classList.remove('open'); pendingTab = null; };
$('btnUnlock').onclick = async () => {
  const pass = $('adminPass').value;
  if(!pass) return;
  busy(true); $('adminErr').textContent = '';
  const {data:{user}} = await sb.auth.getUser();
  const {error} = await sb.auth.signInWithPassword({email:user.email, password:pass});
  busy(false);
  if(error){ $('adminErr').textContent = 'Wrong password'; return; }
  state.adminUnlocked = true;
  $('adminModal').classList.remove('open');
  $('btnLock').style.display = '';
  if(pendingTab) switchTab(pendingTab);
  pendingTab = null;
};
$('adminPass').addEventListener('keydown', e => { if(e.key === 'Enter') $('btnUnlock').click(); });
$('btnLock').onclick = () => {
  if(DEMO_MODE) return switchTab('home');
  state.adminUnlocked = false;
  $('btnLock').style.display = 'none';
  switchTab('home');
  toast('Admin sections locked');
};

/* ---------- tabs ---------- */
// Pinch-zoom is disabled only on the kiosk home screen (stops an employee mid-queue from
// accidentally zooming the shared tablet) — every admin tab re-enables it, since an admin
// reviewing Records/Report/Salary on their own phone shouldn't be blocked from zooming in.
const viewportMeta = document.querySelector('meta[name=viewport]');
function setKioskZoomLock(locked){
  viewportMeta.setAttribute('content', locked
    ? 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
    : 'width=device-width, initial-scale=1');
}

export function switchTab(tab){
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  ['home','records','report','employees','salary'].forEach(t =>
    $('tab-'+t).style.display = (t === tab) ? '' : 'none');
  document.body.classList.toggle('kiosk-active', tab === 'home');
  setKioskZoomLock(tab === 'home');
  $('topHeader').style.display = tab === 'home' ? 'none' : '';
  $('adminTools').style.display = tab === 'home' ? 'none' : 'flex';
  document.querySelectorAll('#adminTools [data-tab]').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  if(tab === 'records') renderRecords();
  if(tab === 'report') renderReport();
  if(tab === 'employees') renderEmployees();
  if(tab === 'salary') renderSalary();
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => {
  const tab = b.dataset.tab;
  if(!DEMO_MODE && ADMIN_TABS.includes(tab) && !state.adminUnlocked) return requestAdmin(tab);
  switchTab(tab);
});
$('btnAdminEntry').onclick = () => {
  if(DEMO_MODE) return switchTab('employees');
  if(!state.adminUnlocked) return requestAdmin('employees');
  switchTab('employees');
};
$('btnReturnKiosk').onclick = () => switchTab('home');
document.querySelectorAll('#adminTools [data-tab]').forEach(b => b.onclick = () => {
  const tab = b.dataset.tab;
  if(!DEMO_MODE && !state.adminUnlocked) return requestAdmin(tab);
  switchTab(tab);
});

/* ---------- live clock ---------- */
function tickClock(){
  const now = new Date();
  $('clock').textContent = now.toLocaleString('en-IN', {weekday:'short', day:'numeric', month:'short', hour:'numeric', minute:'2-digit', hour12:true}).replace(/am|pm/i, part => part.toUpperCase());
  const h = now.getHours();
  $('kioskGreet').textContent = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('kioskTime').textContent = now.toLocaleTimeString('en-IN', {hour:'numeric', minute:'2-digit', hour12:true}).replace(/am|pm/i, p => p.toUpperCase());
  $('kioskDate').textContent = now.toLocaleDateString('en-IN', {weekday:'long', day:'numeric', month:'long'});
}
tickClock();
setInterval(tickClock, 1000);
