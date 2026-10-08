// A styled stand-in for prompt(): renders as the app's own card instead of the browser's
// native dialog (which can't render at all inside some embedded preview contexts), while
// keeping prompt()'s simple "await it, null means cancelled" call shape.
import { $ } from '../utils.js';

const modal = $('promptModal');
const titleEl = $('promptTitle');
const noteEl = $('promptNote');
const fieldsEl = $('promptFields');
const errEl = $('promptErr');
const submitBtn = $('promptSubmit');
const cancelBtn = $('promptCancel');

function setNote(note){
  noteEl.replaceChildren();
  const lines = note ? [].concat(note) : [];
  lines.forEach(l => { const p = document.createElement('div'); p.textContent = l; noteEl.append(p); });
  noteEl.style.display = lines.length ? '' : 'none';
}

// fields: [{name, label, type ('text'|'number'|'date'|'time'|'select'), value, placeholder, min,
// required, options}]. A field is required unless explicitly marked `required: false` (e.g. an
// optional clock-out time). `type:'select'` renders a native <select> instead of an <input> —
// `options: [{value, label}]` — for a short, fixed list (an employee picker) rather than free
// text. Pass an empty `fields` array to use this as a styled confirm() instead of a prompt().
// `danger: true` styles Save as the red/destructive button, for confirms like "Delete this?".
// `note` (a string or an array of lines) is shown under the title, to say what is being changed.
// `validate(values)` may return an error string to refuse Save and keep the dialog open.
// Resolves with {name: value, ...} on Save (an empty object for a zero-field confirm), or
// null on Cancel/Escape.
export function promptModal({title, fields, submitLabel = 'Save', danger = false, validate = null, note = null}){
  return new Promise(resolve => {
    titleEl.textContent = title;
    setNote(note);
    errEl.textContent = '';
    submitBtn.textContent = submitLabel;
    submitBtn.classList.toggle('red', danger);
    submitBtn.classList.toggle('green', !danger);
    fieldsEl.innerHTML = '';
    const inputs = fields.map(f => {
      const label = document.createElement('label');
      label.className = 'modal-field-label';
      label.textContent = f.label;
      const input = document.createElement(f.type === 'select' ? 'select' : 'input');
      if(f.type === 'select'){
        (f.options || []).forEach(opt => {
          const o = document.createElement('option');
          o.value = opt.value; o.textContent = opt.label;
          input.appendChild(o);
        });
        if(f.value != null) input.value = f.value;
      }else{
        input.type = f.type || 'text';
        input.value = f.value ?? '';
        if(f.placeholder) input.placeholder = f.placeholder;
        if(f.min != null) input.min = f.min;
        if(f.maxlength != null) input.maxLength = f.maxlength;
        if(f.inputmode) input.inputMode = f.inputmode;
        if(f.pattern) input.pattern = f.pattern;
      }
      fieldsEl.append(label, input);
      return {name: f.name, input, required: f.required !== false};
    });

    function close(result){
      modal.classList.remove('open');
      submitBtn.onclick = null; cancelBtn.onclick = null; modal.onkeydown = null;
      resolve(result);
    }
    submitBtn.onclick = () => {
      const values = {};
      for(const {name, input, required} of inputs){
        const v = input.value.trim();
        if(!v && required){ errEl.textContent = 'Please fill in all fields.'; input.focus(); return; }
        values[name] = v;
      }
      // Optional check on the whole form, e.g. clock-out before clock-in: shown inline and the
      // dialog stays open, so the owner corrects the field instead of losing what they typed.
      const problem = validate && validate(values);
      if(problem){ errEl.textContent = problem; return; }
      close(values);
    };
    cancelBtn.onclick = () => close(null);
    modal.onkeydown = e => {
      if(e.key === 'Enter') submitBtn.click();
      if(e.key === 'Escape') cancelBtn.click();
    };
    modal.classList.add('open');
    inputs[0]?.input.focus();
  });
}

// A read-only variant for showing information rather than collecting it (e.g. "which days,
// exactly, made up this absence count") — same card/overlay as promptModal so it doesn't
// introduce a second visual language, just a single "Close" button instead of Save/Cancel.
// `render(container)` builds whatever DOM the caller needs directly into the fields area,
// same escape-safe DOM-building convention as the rest of this app (no raw HTML strings).
export function infoModal({title, render}){
  return new Promise(resolve => {
    titleEl.textContent = title;
    setNote(null);
    errEl.textContent = '';
    fieldsEl.innerHTML = '';
    render(fieldsEl);
    submitBtn.textContent = 'Close';
    submitBtn.classList.remove('red');
    submitBtn.classList.add('green');
    cancelBtn.style.display = 'none';
    function close(){
      modal.classList.remove('open');
      submitBtn.onclick = null; modal.onkeydown = null;
      cancelBtn.style.display = '';
      resolve();
    }
    submitBtn.onclick = close;
    modal.onkeydown = e => { if(e.key === 'Enter' || e.key === 'Escape') close(); };
    modal.classList.add('open');
  });
}

// A list of actions for one thing (an employee, say): a bottom sheet on a phone, a centred card on
// wider screens (CSS decides). Replaces a row of small buttons repeated on every line — the row
// itself becomes the one tap target and the choices appear only when you ask for them.
// `avatar` is an element for the header (the caller builds it, so this stays free of employee code);
// `actions`: [{label, icon (static SVG markup), danger, run}]. Choosing one closes the sheet first,
// then runs it. Tapping outside, Close, or Escape just closes.
export function actionSheet({title, subtitle, avatar, actions}){
  document.querySelectorAll('.sheet-overlay').forEach(o => o.remove());
  const overlay = document.createElement('div');
  overlay.className = 'sheet-overlay';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', title);
  const handle = document.createElement('div'); handle.className = 'sheet-handle';
  const head = document.createElement('div'); head.className = 'sheet-head';
  const who = document.createElement('div');
  const t = document.createElement('div'); t.className = 'sheet-title'; t.textContent = title;
  who.append(t);
  if(subtitle){ const sub = document.createElement('div'); sub.className = 'sheet-sub'; sub.textContent = subtitle; who.append(sub); }
  if(avatar) head.append(avatar);
  head.append(who);
  sheet.append(handle, head);
  function close(){
    overlay.classList.remove('open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 200);
  }
  function onKey(e){ if(e.key === 'Escape') close(); }
  actions.forEach(a => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sheet-action' + (a.danger ? ' danger' : '');
    if(a.icon){ const holder = document.createElement('template'); holder.innerHTML = a.icon; b.append(holder.content); }
    b.append(document.createTextNode(a.label));
    b.onclick = () => { close(); a.run(); };
    sheet.append(b);
  });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button'; closeBtn.className = 'btn ghost sheet-close'; closeBtn.textContent = 'Close';
  closeBtn.onclick = close;
  sheet.append(closeBtn);
  overlay.append(sheet);
  overlay.onclick = e => { if(e.target === overlay) close(); };
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  sheet.querySelector('.sheet-action')?.focus();
}
