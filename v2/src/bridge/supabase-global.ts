// The live app's js/supabaseClient.js calls `supabase.createClient(...)` on a global that the
// vendored UMD build used to provide. v2 installs supabase-js from npm instead, so this module
// provides the same global. It must be the first import in main.tsx (and in any test that
// touches the store): ES modules evaluate imports in order, and js/supabaseClient.js reads the
// global at the moment it is first evaluated.
import { createClient } from '@supabase/supabase-js'

;(globalThis as unknown as { supabase: { createClient: typeof createClient } }).supabase = { createClient }
