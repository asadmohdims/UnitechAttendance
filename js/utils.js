export const $ = id => document.getElementById(id);

export function toast(msg){
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3200);
}

export function busy(on){ $('busy').style.display = on ? 'block' : 'none'; }

export const pad = n => String(n).padStart(2,'0');

export const dateStr = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

export const fmtTime = iso => iso
  ? new Date(iso).toLocaleTimeString('en-IN', {hour:'numeric', minute:'2-digit', hour12:true}).replace(/am|pm/i, part => part.toUpperCase())
  : '—';

export function fmtHours(h){
  if(h == null) return '—';
  const m = Math.round(h*60);
  return `${Math.floor(m/60)}:${pad(m%60)}`;
}

export function recHours(r){ return r.clock_out ? Math.max(0,(new Date(r.clock_out) - new Date(r.clock_in))/3600000) : null; }

// navigator.vibrate is Android/Chrome only — a silent no-op everywhere else (iOS Safari,
// desktop), so these are safe to call unconditionally from anywhere. Reserved for the two
// moments that actually need reinforcing (a confirmed punch/payment, a rejected PIN) — not
// wired into ordinary button/tile presses, for the same reason a sound cue on every tap was
// ruled out: at kiosk-all-day frequency, a buzz on every press would wear thin fast.
export function hapticSuccess(){ navigator.vibrate?.(20); }
export function hapticError(){ navigator.vibrate?.([30, 40, 30]); }

// Moves a <input type="month"> value by `change` months (±1 for prev/next arrows) and re-renders.
// Shared by the Report and Salary tabs' identical month-picker pattern.
export function shiftMonthInput(input, change, onChange){
  const [year, month] = input.value.split('-').map(Number);
  const next = new Date(year, month - 1 + change, 1);
  input.value = `${next.getFullYear()}-${pad(next.getMonth() + 1)}`;
  onChange();
}
