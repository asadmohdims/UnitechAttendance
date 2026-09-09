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
  const tb = document.querySelector('#empTable tbody');
  tb.innerHTML = '';
  $('empEmpty').style.display = state.employees.length ? 'none' : '';
  state.employees.forEach(e => {
    const tr = document.createElement('tr');
    const tdAvatar = document.createElement('td');
    const avatarImg = document.createElement('img');
    avatarImg.className = 'photo-thumb'; avatarImg.style.borderRadius = '50%'; avatarImg.alt = '';
    applyAvatar(avatarImg, e);
    tdAvatar.appendChild(avatarImg);
    const tdName = document.createElement('td');
    tdName.textContent = e.name + (e.active ? '' : ' (inactive)');
    const tdBtns = document.createElement('td');
    tdBtns.style.textAlign = 'right';
    const bPhoto = document.createElement('button');
    bPhoto.className = 'btn small ghost'; bPhoto.textContent = e.avatar ? 'Retake photo' : 'Add photo';
    bPhoto.onclick = () => captureFor(e, 'avatar', blob => handleAvatarCapture(e, blob));
    const bRen = document.createElement('button');
    bRen.className = 'btn small ghost'; bRen.style.marginLeft = '8px'; bRen.textContent = 'Rename';
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
    bTog.style.marginLeft = '8px';
    bTog.textContent = e.active ? 'Deactivate' : 'Activate';
    bTog.onclick = async () => {
      busy(true);
      try{
        await store.setEmployeeActive(e.id, !e.active);
        await refreshAll();
        renderEmployees();
      }catch(err){ toast('Failed: ' + err.message); }
      busy(false);
    };
    tdBtns.append(bPhoto, bRen, bTog);
    tr.append(tdAvatar, tdName, tdBtns);
    tb.appendChild(tr);
  });
}
