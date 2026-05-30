/**
 * Cliente Supabase secundario para la integración Ualá.
 *
 * Apunta al proyecto cgzaiijspgafruytozzk (Kairox-Gestión),
 * separado del cliente principal de la app (wuznppxeonmhfcvnqfbf).
 *
 * Requiere en .env.local:
 *   VITE_UALA_SUPABASE_URL=https://cgzaiijspgafruytozzk.supabase.co
 *   VITE_UALA_SUPABASE_ANON_KEY=<anon key del proyecto cgzaiijspgafruytozzk>
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
