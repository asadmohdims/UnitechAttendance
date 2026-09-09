import { $, busy, toast, dateStr, fmtTime, fmtHours, recHours } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { refreshAll } from './kiosk.js';

const recDate = $('recDate');
recDate.value = dateStr();
recDate.onchange = renderRecords;

export function setRecordsDate(date){ recDate.value = date; }

async function showPhoto(path){
  const url = await store.getPhotoUrl(path);
  if(!url) return toast('Photo not found');
  $('photoViewImg').src = url;
  $('photoView').classList.add('open');
}

function photoCell(path){
  const td = document.createElement('td');
  if(path){
    const img = document.createElement('img');
    img.className = 'photo-thumb';
    store.getPhotoUrl(path).then(u => { if(u) img.src = u; });
    img.onclick = () => showPhoto(path);
    td.appendChild(img);
  }
  return td;
}

export async function renderRecords(){
  const tb = document.querySelector('#recTable tbody');
  tb.innerHTML = '';
  busy(true);
  let list;
  try{
    list = await store.listRecordsForDate(recDate.value);
  }catch(err){
    busy(false);
    return toast('Load failed: ' + err.message);
  }
  busy(false);
  $('recEmpty').style.display = list.length ? 'none' : '';
  for(const r of list){
    const emp = state.employees.find(e => e.id === r.emp_id);
    const tr = document.createElement('tr');
    const tdName = document.createElement('td'); tdName.textContent = emp ? emp.name : '?';
    const tdIn = document.createElement('td'); tdIn.textContent = fmtTime(r.clock_in);
    const tdOut = document.createElement('td');
    if(r.clock_out) tdOut.textContent = fmtTime(r.clock_out); else tdOut.innerHTML = '<span class="open-session">still IN</span>';
    const tdH = document.createElement('td'); tdH.className = 'num'; tdH.textContent = fmtHours(recHours(r));
    const tdEdit = document.createElement('td'); tdEdit.style.textAlign = 'right';
    const bEdit = document.createElement('button'); bEdit.className = 'btn small ghost'; bEdit.textContent = 'Edit'; bEdit.onclick = () => editRecord(r);
    const bDel = document.createElement('button'); bDel.className = 'btn small red'; bDel.style.marginLeft = '6px'; bDel.textContent = '✕';
    bDel.onclick = async () => {
      if(!confirm('Delete this record?')) return;
      busy(true);
      try{
        await store.deleteRecord(r);
        await refreshAll();
        await renderRecords();
      }catch(err){ toast('Failed: ' + err.message); }
      busy(false);
    };
    tdEdit.append(bEdit, bDel);
    tr.append(tdName, tdIn, photoCell(r.in_photo), tdOut, photoCell(r.out_photo), tdH, tdEdit);
    tb.appendChild(tr);
  }
}

async function editRecord(r){
  const inT = prompt('IN time (HH:MM, 24h)', new Date(r.clock_in).toTimeString().slice(0,5));
  if(inT === null) return;
  const outCur = r.clock_out ? new Date(r.clock_out).toTimeString().slice(0,5) : '';
  const outT = prompt('OUT time (HH:MM, 24h) — leave empty if still in', outCur);
  if(outT === null) return;
  const mk = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
    if(!m) return null;
    const d = new Date(r.date + 'T00:00:00');
    d.setHours(+m[1], +m[2], 0, 0);
    return d;
  };
  const inD = mk(inT);
  if(!inD) return toast('Invalid IN time');
  let outD = null;
  if(outT.trim() !== ''){
    outD = mk(outT);
    if(!outD) return toast('Invalid OUT time');
    if(outD < inD) outD = new Date(outD.getTime() + 86400000);
  }
  busy(true);
  try{
    await store.updateRecordTimes(r.id, inD.toISOString(), outD ? outD.toISOString() : null);
    await refreshAll();
    await renderRecords();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}
