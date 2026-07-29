/**
 * mp-sync — sincronización de pagos de MercadoPago disparada POR UN ADMIN.
 *
 * Es el botón "Actualizar MP" del frontend: exige usuario admin logueado y
 * sincroniza SOLO la empresa de ese usuario.
 *
 * El cron NO usa esta función — usa `mp-sync-worker`. Ver la nota de abajo.
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyAdmin } from '../_shared/auth.ts';
import { sincronizarIntegracionesMP, MP_INTEGRACION_COLS } from '../_shared/mpSync.ts';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// FIX-CORS-MP-SYNC — permite invocar mp-sync desde el browser (botón "Actualizar")
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // FIX-CORS-MP-SYNC — responder preflight antes de correr cualquier lógica
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Solo admin de la propia empresa puede disparar el sync — antes cualquier usuario
  // autenticado de cualquier tenant podía forzar el sync (e inserción de movimientos) de TODAS
  // las empresas, porque no había chequeo de rol ni de alcance por empresa_id.
  //
  // ⚠️ NO sacar este chequeo para "arreglar el cron": el cron invoca con la anon
  // key, que no es un JWT de usuario, así que este verifyAdmin la rechaza — eso
  // dejó la sincronización caída del 2026-07-14 al 2026-07-29 sin que nadie lo
  // notara. La solución NO es aflojar acá, es `mp-sync-worker` (sin usuario,
  // service_role, todas las empresas), que es a quien apunta el cron ahora.
  const auth = await verifyAdmin(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: integraciones, error: errInt } = await supabase
    .from('integraciones_bancarias')
    .select(MP_INTEGRACION_COLS)
    .eq('proveedor', 'mercadopago')
    .eq('activo', true)
    .eq('empresa_id', auth.empresaId);   // ← alcance: SOLO la empresa del admin

  if (errInt || !integraciones?.length) {
    console.log('[mp-sync] Sin integraciones MP activas');
    return new Response(JSON.stringify({ ok: true, synced: 0 }), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, // FIX-CORS-MP-SYNC
    });
  }

  const totalInsertados = await sincronizarIntegracionesMP(supabase, integraciones);

  console.log(`[mp-sync] Completado. Insertados: ${totalInsertados}`);
  return new Response(JSON.stringify({ ok: true, synced: totalInsertados }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, // FIX-CORS-MP-SYNC
  });
});
