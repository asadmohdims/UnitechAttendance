import { $, busy, toast } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { captureFor } from '../camera.js';
import { refreshAll, renderHome } from './kiosk.js';
import { promptModal, actionSheet } from './modal.js';
import { setEmployeePinFlow } from './payments.js';

$('btnAddEmp').onclick = async () => {
  const name = $('newEmpName').value.trim();
  if(!name) return;
  busy(true);
  try{
    const emp = await store.addEmployee(name);
    $('newEmpName').value = '';
    await refreshAll();
    renderEmployees();
    captureFor(emp, 'avatar', blob => handleAvatarCapture(emp, blob));
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
};

async function handleAvatarCapture(emp, blob){
  // A new file name per retake rather than overwriting one fixed name: the kiosk keeps a tile's
  // photo on screen for as long as the employee's avatar path is unchanged (renderHome() in
  // js/ui/kiosk.js), so a changed path is how every device learns there's a new picture. The
  // previous file is left in Storage (~20KB, only on a retake).
  const path = `${emp.id}/avatar-${Date.now()}.jpg`;
  await store.uploadPhoto(path, blob);
  await store.setEmployeeAvatar(emp.id, path);
  await refreshAll();
  renderEmployees();
  toast(`Photo saved for ${emp.name}`);
}

const icon = d => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = {
  photo: icon('<path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>'),
  rename: icon('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  pin: icon('<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  off: icon('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'),
  on: icon('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>')
};

async function renameEmployee(e){
  const result = await promptModal({title: 'Rename employee', fields: [{name:'name', label:'Employee name', value:e.name}]});
  if(!result) return;
  busy(true);
  try{
    await store.renameEmployee(e.id, result.name);
    await refreshAll();
    renderEmployees();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

async function toggleActive(e){
  // Deactivating someone mid-shift would orphan their open session — today's clock-in
  // would have no way to clock out, since the kiosk only shows active employees.
  if(e.active && state.openSessions[e.id]){
    toast(`${e.name} is currently clocked in — clock them out before deactivating.`);
    return;
  }
  busy(true);
  try{
    await store.setEmployeeActive(e.id, !e.active);
    await refreshAll();
    renderEmployees();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}

// Each row is one tap target; the four things you can do to a person live in a sheet behind it, with
// the one destructive-looking choice (Deactivate, which is reversible) last and in text, not a solid
// red button repeated on every row.
function openEmployeeSheet(e){
  const avatar = document.createElement('img');
  avatar.className = 'sheet-avatar'; avatar.alt = '';
  applyAvatar(avatar, e);
  actionSheet({
    title: e.name,
    subtitle: `${e.active ? 'Active' : 'Inactive'} · ${e.pin_hash ? 'PIN set' : 'No PIN yet'}`,
    avatar,
    actions: [
      {label: e.avatar ? 'Retake photo' : 'Add photo', icon: ICONS.photo, run: () => captureFor(e, 'avatar', blob => handleAvatarCapture(e, blob))},
      {label: 'Rename', icon: ICONS.rename, run: () => renameEmployee(e)},
      {label: e.pin_hash ? 'Change PIN' : 'Set PIN', icon: ICONS.pin, run: () => setEmployeePinFlow(e)},
      e.active ? {label: 'Deactivate', icon: ICONS.off, danger: true, run: () => toggleActive(e)}
               : {label: 'Activate', icon: ICONS.on, run: () => toggleActive(e)}
    ]
  });
}

export function renderEmployees(){
  const list = $('empList');
  list.innerHTML = '';
  $('empEmpty').style.display = state.employees.length ? 'none' : '';
  const inactive = state.employees.filter(e => !e.active).length;
  $('empCountLabel').textContent = state.employees.length
    ? `${state.employees.length} total${inactive ? ` · ${inactive} inactive` : ''}`
    : '';

  state.employees.forEach(e => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'emp-row';
    row.onclick = () => openEmployeeSheet(e);

    const avatarImg = document.createElement('img');
    avatarImg.className = 'report-avatar'; avatarImg.alt = '';
    applyAvatar(avatarImg, e);

    const who = document.createElement('div');
    const name = document.createElement('div'); name.className = 'report-name'; name.textContent = e.name;
    const status = document.createElement('div');
    status.className = 'emp-status' + (e.active ? ' active' : '');
    status.innerHTML = `<span class="dot"></span>${e.active ? 'Active' : 'Inactive'}`;
    who.append(name, status);

    const chevron = document.createElement('span');
    chevron.className = 'emp-chevron'; chevron.setAttribute('aria-hidden', 'true'); chevron.textContent = '›';

    row.append(avatarImg, who, chevron);
    list.appendChild(row);
  });
}
