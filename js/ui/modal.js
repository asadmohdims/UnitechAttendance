// A styled stand-in for prompt(): renders as the app's own card instead of the browser's
// native dialog (which can't render at all inside some embedded preview contexts), while
// keeping prompt()'s simple "await it, null means cancelled" call shape.
import { $ } from '../utils.js';

const modal = $('promptModal');
const titleEl = $('promptTitle');
const fieldsEl = $('promptFields');
const errEl = $('promptErr');
const submitBtn = $('promptSubmit');
const cancelBtn = $('promptCancel');

// fields: [{name, label, type ('text'|'number'|'date'|'time'|'select'), value, placeholder, min,
// required, options}]. A field is required unless explicitly marked `required: false` (e.g. an
// optional clock-out time). `type:'select'` renders a native <select> instead of an <input> —
// `options: [{value, label}]` — for a short, fixed list (an employee picker) rather than free
// text. Pass an empty `fields` array to use this as a styled confirm() instead of a prompt().
// `danger: true` styles Save as the red/destructive button, for confirms like "Delete this?".
// Resolves with {name: value, ...} on Save (an empty object for a zero-field confirm), or
// null on Cancel/Escape.
export function promptModal({title, fields, submitLabel = 'Save', danger = false}){
  return new Promise(resolve => {
    titleEl.textContent = title;
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
