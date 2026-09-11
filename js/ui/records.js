import { $, busy, toast, dateStr, fmtTime, fmtHours, recHours } from '../utils.js';
import { state } from '../state.js';
import { store } from '../store/index.js';
import { applyAvatar } from '../avatars.js';
import { refreshAll } from './kiosk.js';
import { promptModal } from './modal.js';
import { isMissedClockIn } from '../missedClockIn.js';
import { recHoursRounded, roundToQuarterHour, wasRounded } from '../rounding.js';

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
  if(iso && wasRounded(iso)){
    const note = document.createElement('span'); note.className = 'paid-note';
    note.textContent = `→ ${fmtTime(roundToQuarterHour(iso))} paid`;
    cell.appendChild(note);
  }
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
  renderMissedAlert();

  // listRecordsForDate sorts by clock_in globally, which can interleave different employees'
  // sessions on a lunch-break day (A-in, B-in, A-lunch-out, B-lunch-out, ...) — re-group by
  // employee (keeping each employee's own chronological order) so a same-day second session
  // always renders directly under its first, with a lunch divider between them below.
  const byEmp = new Map();
  records.forEach(r => { if(!byEmp.has(r.emp_id)) byEmp.set(r.emp_id, []); byEmp.get(r.emp_id).push(r); });
  const grouped = [...byEmp.values()].flat();

  let prev = null;
  for(const r of grouped){
    if(prev && prev.emp_id === r.emp_id && prev.clock_out){
      const gapHours = (new Date(r.clock_in) - new Date(prev.clock_out)) / 3600000;
      const auto = !prev.out_photo; // out_photo is null only for an auto-close — a manual punch always has one
      const divider = document.createElement('div');
      divider.className = 'rec-lunch-divider';
      divider.textContent = `Lunch: ${fmtHours(gapHours)}${auto ? ' (auto)' : ''}`;
      list.appendChild(divider);
    }
    prev = r;

    const emp = state.employees.find(e => e.id === r.emp_id);
    const row = document.createElement('div');
    row.className = 'rec-row';

    const avatar = document.createElement('img');
    avatar.className = 'report-avatar rec-avatar'; avatar.alt = '';
    if(emp) applyAvatar(avatar, emp);

    const who = document.createElement('div'); who.className = 'rec-who';
    const name = document.createElement('div'); name.className = 'report-name'; name.textContent = emp ? emp.name : '?';
    who.appendChild(name);
    const empSessions = byEmp.get(r.emp_id);
    const isLastForEmp = empSessions[empSessions.length - 1] === r;
    if(!r.clock_out){
      const live = document.createElement('div'); live.className = 'open-session'; live.style.fontSize = '13px';
      live.textContent = '● Still in';
      who.appendChild(live);
    }else if(isLastForEmp && !r.out_photo){
      // The lunch safety net closed this session, and nothing followed it that day — the
      // employee never tapped back in. Hours look complete but haven't actually been confirmed.
      const flag = document.createElement('div'); flag.className = 'lunch-flag'; flag.style.fontSize = '13px';
      flag.textContent = '● Lunch not resumed';
      who.appendChild(flag);
    }

    const punches = document.createElement('div'); punches.className = 'rec-punches';
    punches.append(punchCell('In', r.clock_in, r.in_photo), punchCell('Out', r.clock_out, r.out_photo));

    const workedHours = recHours(r);
    const paidHours = recHoursRounded(r);
    const hours = document.createElement('div'); hours.className = 'rec-hours';
    hours.textContent = (paidHours !== null && paidHours !== workedHours)
      ? `${fmtHours(workedHours)} worked · ${fmtHours(paidHours)} paid`
      : fmtHours(workedHours);

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

// Only meaningful for today's date — "missed clock-in" isn't a retroactive judgment about a
// past day, so browsing history never shows it. Reads shared `state` directly rather than
// fetching: js/ui/kiosk.js's periodicCheck() keeps openSessions/onLunch/punchedToday live
// regardless of which admin tab is active.
function renderMissedAlert(){
  const el = $('missedAlert');
  if(recDate.value !== dateStr()){ el.style.display = 'none'; return; }
  const missed = state.employees.filter(e =>
    e.active && !state.openSessions[e.id] && !state.onLunch[e.id] && isMissedClockIn(state.punchedToday[e.id])
  );
  el.style.display = missed.length ? '' : 'none';
  if(missed.length){
    $('missedTitle').textContent = `${missed.length} ${missed.length === 1 ? "employee hasn't" : "employees haven't"} clocked in today`;
    $('missedText').textContent = missed.map(e => e.name).join(', ');
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
