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

// fields: [{name, label, type ('text'|'number'|'date'), value, placeholder, min}]
// Resolves with {name: value, ...} on Save, or null on Cancel/Escape.
export function promptModal({title, fields, submitLabel = 'Save'}){
  return new Promise(resolve => {
    titleEl.textContent = title;
    errEl.textContent = '';
    submitBtn.textContent = submitLabel;
    fieldsEl.innerHTML = '';
    const inputs = fields.map(f => {
      const label = document.createElement('label');
      label.className = 'modal-field-label';
      label.textContent = f.label;
      const input = document.createElement('input');
      input.type = f.type || 'text';
      input.value = f.value ?? '';
      if(f.placeholder) input.placeholder = f.placeholder;
      if(f.min != null) input.min = f.min;
      fieldsEl.append(label, input);
      return {name: f.name, input};
    });

    function close(result){
      modal.classList.remove('open');
      submitBtn.onclick = null; cancelBtn.onclick = null; modal.onkeydown = null;
      resolve(result);
    }
    submitBtn.onclick = () => {
      const values = {};
      for(const {name, input} of inputs){
        const v = input.value.trim();
        if(!v){ errEl.textContent = 'Please fill in all fields.'; input.focus(); return; }
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
    inputs[0].input.focus();
  });
}
