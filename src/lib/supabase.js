import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // Helps you catch a missing env var immediately instead of a blank screen.
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Set them in .env.local and in Netlify.');
}

export const supabase = createClient(url || 'http://localhost', anon || 'anon', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || '';
export const CONFIG_OK = !!(url && anon);
