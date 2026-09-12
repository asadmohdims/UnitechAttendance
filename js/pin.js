// PIN hashing for an employee's own kiosk access to Payments — SHA-256(salt + pin) via the
// browser's built-in crypto.subtle, no store/DOM access. A 4-digit PIN only has 10,000 possible
// values, so no hash algorithm makes it brute-force-resistant on its own — the real protection
// is that reading employees.pin_hash/pin_salt at all requires an authenticated Supabase session
// (RLS), plus a client-side lockout after repeated wrong attempts (see js/ui/payments.js). This
// is proportionate to a small-shop kiosk PIN, not a full password scheme (no bcrypt/PBKDF2
// stretching) — a deliberate choice, not an oversight.

export function generateSalt(){
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPin(pin, salt){
  const data = new TextEncoder().encode(salt + pin);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(new Uint8Array(digest));
}

export async function verifyPin(pin, salt, hash){
  return (await hashPin(pin, salt)) === hash;
}

function toHex(bytes){
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
