import { $, busy, toast } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { captureFor } from '../camera.js';
import { refreshAll, renderHome } from './kiosk.js';
import { promptModal } from './modal.js';

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
  const path = `${emp.id}/avatar.jpg`;
  await store.uploadPhoto(path, blob, {upsert: true});
  await store.setEmployeeAvatar(emp.id, path);
  await refreshAll();
  renderEmployees();
  toast(`Photo saved for ${emp.name}`);
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
    const row = document.createElement('div');
    row.className = 'emp-row';

    const avatarImg = document.createElement('img');
    avatarImg.className = 'report-avatar'; avatarImg.alt = '';
    applyAvatar(avatarImg, e);

    const who = document.createElement('div');
    const name = document.createElement('div'); name.className = 'report-name'; name.textContent = e.name;
    const status = document.createElement('div');
    status.className = 'emp-status' + (e.active ? ' active' : '');
    status.innerHTML = `<span class="dot"></span>${e.active ? 'Active' : 'Inactive'}`;
    who.append(name, status);

    const actions = document.createElement('div');
    actions.className = 'emp-actions';
    const bPhoto = document.createElement('button');
    bPhoto.className = 'btn small ghost'; bPhoto.textContent = e.avatar ? 'Retake photo' : 'Add photo';
    bPhoto.onclick = () => captureFor(e, 'avatar', blob => handleAvatarCapture(e, blob));
    const bRen = document.createElement('button');
    bRen.className = 'btn small ghost'; bRen.textContent = 'Rename';
    bRen.onclick = async () => {
      const result = await promptModal({title: 'Rename employee', fields: [{name:'name', label:'Employee name', value:e.name}]});
      if(!result) return;
      busy(true);
      try{
        await store.renameEmployee(e.id, result.name);
        await refreshAll();
        renderEmployees();
      }catch(err){ toast('Failed: ' + err.message); }
      busy(false);
    };
    const bTog = document.createElement('button');
    bTog.className = 'btn small ' + (e.active ? 'red' : 'green');
    bTog.textContent = e.active ? 'Deactivate' : 'Activate';
    bTog.onclick = async () => {
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
    };
    actions.append(bPhoto, bRen, bTog);

    row.append(avatarImg, who, actions);
    list.appendChild(row);
  });
}
