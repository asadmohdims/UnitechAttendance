import { SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_MODE } from './config.js';

if(!DEMO_MODE && SUPABASE_URL.startsWith('PASTE')){
  document.body.innerHTML = '<div style="padding:40px; font-family:sans-serif"><h2>Not configured</h2><p>Supabase URL and anon key have not been set in js/config.js yet.</p></div>';
  throw new Error('Supabase not configured');
}
export const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
