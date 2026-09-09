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

export function applyAvatar(img, emp){
  img.src = initialsAvatarUrl(emp.name);
  const path = emp.avatar;
  if(!path) return;
  if(path.startsWith('assets/')){ img.src = path; return; }
  store.getPhotoUrl(path).then(u => { if(u) img.src = u; });
}
