import { store } from './store/index.js';

export function initialsAvatarUrl(name){
  const initials = (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  let hash = 0;
  for(let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 68 68">`
    + `<circle cx="34" cy="34" r="34" fill="hsl(${hue} 45% 32%)"/>`
    + `<text x="34" y="35" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,sans-serif" font-size="26" font-weight="700" fill="hsl(${hue} 70% 88%)">${initials}</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

// Marks the <img> with what it's showing once that's final (a real photo, or initials for an
// employee with no photo), so the kiosk can keep a tile's <img> across renders and only call this
// again when something changed — see avatarIsCurrent(). A photo that couldn't be fetched (e.g.
// offline) leaves the mark unset, so the next render retries it.
export function applyAvatar(img, emp){
  const key = avatarKey(emp);
  img.dataset.avatarWanted = key;
  delete img.dataset.avatarShown;
  img.src = initialsAvatarUrl(emp.name);
  const path = emp.avatar;
  if(!path){ img.dataset.avatarShown = key; return; }
  if(path.startsWith('assets/')){ img.src = path; img.dataset.avatarShown = key; return; }
  store.getPhotoUrl(path).then(u => {
    // A later applyAvatar() on this same <img> (the avatar changed while this fetch was in
    // flight) wins — never let a slow, older fetch land the previous photo on top of it.
    if(!u || img.dataset.avatarWanted !== key) return;
    img.src = u;
    img.dataset.avatarShown = key;
  });
}

// Keyed on the photo path when there is one (a retake gets a new path — see
// handleAvatarCapture() in js/ui/employees.js), else on the name the initials are drawn from.
const avatarKey = emp => emp.avatar ? 'photo:' + emp.avatar : 'initials:' + emp.name;

// True when `img` already shows the right final picture for `emp` — nothing to re-fetch.
export const avatarIsCurrent = (img, emp) => img.dataset.avatarShown === avatarKey(emp);
