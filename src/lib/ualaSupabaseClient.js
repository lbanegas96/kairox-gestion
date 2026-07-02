/**
 * Cliente Supabase secundario para la integración Ualá.
 *
 * Apunta al proyecto Supabase de Ualá (project ID en VITE_UALA_SUPABASE_URL).
 *
 * Requiere en .env.local:
 *   VITE_UALA_SUPABASE_URL=https://your-project.supabase.co
 *   VITE_UALA_SUPABASE_ANON_KEY=your-anon-key
 */
import { createClient } from '@supabase/supabase-js';

const ualaSupabaseUrl  = import.meta.env.VITE_UALA_SUPABASE_URL;
const ualaAnonKey      = import.meta.env.VITE_UALA_SUPABASE_ANON_KEY;

if (!ualaSupabaseUrl || !ualaAnonKey) {
  console.warn(
    '[ualaSupabaseClient] Faltan VITE_UALA_SUPABASE_URL o VITE_UALA_SUPABASE_ANON_KEY en .env.local. ' +
    'El módulo de movimientos Ualá no funcionará hasta que se configuren.'
  );
}

export const ualaSupabase = ualaSupabaseUrl && ualaAnonKey
  ? createClient(ualaSupabaseUrl, ualaAnonKey)
  : null;
