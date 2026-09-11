import { $, busy, toast, dateStr, fmtTime, fmtHours, recHours } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { refreshAll } from './kiosk.js';
import { promptModal } from './modal.js';

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

function punchCell(label, iso, photoPath){
  const cell = document.createElement('div');
  cell.className = 'rec-punch';
  const lbl = document.createElement('span'); lbl.className = 'lbl'; lbl.textContent = label;
  const val = document.createElement('span'); val.className = 'val';
  val.append(document.createTextNode(fmtTime(iso)));
  if(photoPath){
    const img = document.createElement('img');
    img.className = 'photo-thumb';
    store.getPhotoUrl(photoPath).then(u => { if(u) img.src = u; });
    img.onclick = () => showPhoto(photoPath);
    val.appendChild(img);
  }
  cell.append(lbl, val);
  return cell;
}

export async function renderRecords(){
  const list = $('recList');
  list.innerHTML = '';
  busy(true);
  let records;
  try{
    records = await store.listRecordsForDate(recDate.value);
  }catch(err){
    busy(false);
    return toast('Load failed: ' + err.message);
  }
  busy(false);
  $('recEmpty').style.display = records.length ? 'none' : '';
  $('recCountLabel').textContent = records.length ? `${records.length} ${records.length === 1 ? 'entry' : 'entries'}` : '';

  for(const r of records){
    const emp = state.employees.find(e => e.id === r.emp_id);
    const row = document.createElement('div');
    row.className = 'rec-row';

    const avatar = document.createElement('img');
    avatar.className = 'report-avatar rec-avatar'; avatar.alt = '';
    if(emp) applyAvatar(avatar, emp);

    const who = document.createElement('div'); who.className = 'rec-who';
    const name = document.createElement('div'); name.className = 'report-name'; name.textContent = emp ? emp.name : '?';
    who.appendChild(name);
    if(!r.clock_out){
      const live = document.createElement('div'); live.className = 'open-session'; live.style.fontSize = '13px';
      live.textContent = '● Still in';
      who.appendChild(live);
    }

    const punches = document.createElement('div'); punches.className = 'rec-punches';
    punches.append(punchCell('In', r.clock_in, r.in_photo), punchCell('Out', r.clock_out, r.out_photo));

    const hours = document.createElement('div'); hours.className = 'rec-hours'; hours.textContent = fmtHours(recHours(r));

    const actions = document.createElement('div'); actions.className = 'rec-actions';
    const bEdit = document.createElement('button'); bEdit.className = 'btn small ghost'; bEdit.textContent = 'Edit'; bEdit.onclick = () => editRecord(r, emp);
    const bDel = document.createElement('button'); bDel.className = 'btn small red'; bDel.textContent = 'Delete';
    bDel.onclick = async () => {
      const confirmed = await promptModal({
        title: `Delete this record for ${emp ? emp.name : 'this employee'}?`,
        submitLabel: 'Delete', danger: true, fields: []
      });
      if(!confirmed) return;
      busy(true);
      try{
        await store.deleteRecord(r);
        await refreshAll();
        await renderRecords();
      }catch(err){ toast('Failed: ' + err.message); }
      busy(false);
    };
    actions.append(bEdit, bDel);

    row.append(avatar, who, punches, hours, actions);
    list.appendChild(row);
  }
}

async function editRecord(r, emp){
  const result = await promptModal({
    title: `Edit — ${emp ? emp.name : 'record'}`,
    fields: [
      {name:'clockIn', label:'Clock in', type:'time', value: new Date(r.clock_in).toTimeString().slice(0,5)},
      {name:'clockOut', label:'Clock out (leave empty if still in)', type:'time', value: r.clock_out ? new Date(r.clock_out).toTimeString().slice(0,5) : '', required:false}
    ]
  });
  if(!result) return;
  const mk = hhmm => {
    const [h, m] = hhmm.split(':').map(Number);
    const d = new Date(r.date + 'T00:00:00');
    d.setHours(h, m, 0, 0);
    return d;
  };
  const inD = mk(result.clockIn);
  let outD = null;
  if(result.clockOut){
    outD = mk(result.clockOut);
    if(outD < inD) outD = new Date(outD.getTime() + 86400000); // crossed midnight
  }
  busy(true);
  try{
    await store.updateRecordTimes(r.id, inD.toISOString(), outD ? outD.toISOString() : null);
    await refreshAll();
    await renderRecords();
  }catch(err){ toast('Failed: ' + err.message); }
  busy(false);
}
