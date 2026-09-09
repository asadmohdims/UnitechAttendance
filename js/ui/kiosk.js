import { $, busy, toast, fmtTime, fmtHours } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { captureFor } from '../camera.js';

// Reloads employees + open sessions from the store into shared state and re-renders the kiosk.
// Called after every mutation (add/rename/deactivate employee, punch in/out) so both store
// backends behave identically, instead of demo mode mutating in-memory state directly.
export async function refreshAll(){
  busy(true);
  try{
    state.employees = await store.listEmployees();
    state.openSessions = await store.listOpenSessions();
    renderHome();
  }catch(err){ toast('Load failed: ' + err.message); }
  busy(false);
}

export function renderHome(){
  const grid = $('empGrid');
  grid.innerHTML = '';
  const active = state.employees.filter(e => e.active);
  $('homeEmpty').style.display = active.length ? 'none' : '';
  active.forEach(e => {
    const open = state.openSessions[e.id];
    const div = document.createElement('div');
    div.className = 'badge-tile' + (open ? ' in' : '');
    div.setAttribute('role', 'button');
    div.setAttribute('tabindex', '0');
    div.innerHTML = '<span class="state-badge"></span><img class="avatar" alt=""><div class="name"></div><div class="status"></div>';
    const avatar = div.querySelector('.avatar');
    applyAvatar(avatar, e);
    avatar.alt = e.name;
    div.querySelector('.state-badge').textContent = open ? '■' : '▶';
    div.querySelector('.name').textContent = e.name;
    div.querySelector('.status').innerHTML = open
      ? `Working since ${fmtTime(open.clock_in)}<br>Tap to finish`
      : 'Tap to start work';
    div.onclick = () => punchTap(e);
    div.onkeydown = ev => { if(ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); punchTap(e); } };
    grid.appendChild(div);
  });
}

function punchTap(emp){
  captureFor(emp, 'punch', blob => handlePunchCapture(emp, blob));
}

async function handlePunchCapture(emp, blob){
  const open = state.openSessions[emp.id];
  const path = `${emp.id}/${Date.now()}.jpg`;
  await store.uploadPhoto(path, blob);
  let action;
  if(open){
    await store.clockOut(open.id, path);
    delete state.openSessions[emp.id];
    action = 'out';
  }else{
    const rec = await store.clockIn(emp.id, path);
    state.openSessions[emp.id] = rec;
    action = 'in';
  }
  renderHome();
  showPunchConfirm(emp, action, blob, open);
}

function showPunchConfirm(emp, action, blob, priorOpen){
  const el = $('punchConfirm');
  $('pcPhoto').src = URL.createObjectURL(blob);
  $('pcName').textContent = emp.name;
  $('pcAction').textContent = action === 'in' ? 'Clocked IN' : 'Clocked OUT';
  el.classList.remove('in', 'out');
  el.classList.add(action);
  $('pcDetail').textContent = action === 'in'
    ? `Started at ${fmtTime(new Date().toISOString())}`
    : `Worked ${fmtHours((Date.now() - new Date(priorOpen.clock_in))/3600000)} hrs today`;
  el.classList.add('open');
  clearTimeout(showPunchConfirm._t);
  showPunchConfirm._t = setTimeout(() => el.classList.remove('open'), 1800);
}
$('punchConfirm').onclick = () => $('punchConfirm').classList.remove('open');
