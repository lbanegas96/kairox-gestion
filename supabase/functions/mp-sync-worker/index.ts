/**
 * mp-sync-worker — sincronización periódica de MercadoPago disparada POR EL CRON.
 *
 * Contraparte sin usuario de `mp-sync`. Itera TODAS las integraciones MP
 * activas de todas las empresas usando service_role, igual que `arca-worker`
 * y `tc-diario-sync`, los otros dos workers de cron del proyecto.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 * El cron apuntaba a `mp-sync`, que exige admin logueado (`verifyAdmin`).
 * El cron invoca con la anon key, que no es un JWT de usuario, así que
 * devolvía 401 en el 100% de las corridas: **la sincronización de MercadoPago
 * estuvo caída del 2026-07-14 al 2026-07-29 sin ningún síntoma visible.**
 * El `verifyAdmin` de `mp-sync` es correcto y NO se tocó (cierra un agujero
 * real: cualquier usuario autenticado de cualquier tenant podía forzar el
 * sync de todas las empresas). La separación en dos entry points es la que
 * deja las dos cosas bien: el frontend sigue acotado por empresa, y el cron
 * corre sin usuario.
 *
 * Auth: service_role (adminClient) — desplegar con `verify_jwt=false`, mismo
 * criterio que `arca-worker`. No devuelve datos de ningún tenant, solo
 * `{ ok, synced }`.
 *
 * Sin CORS a propósito: no se invoca desde el browser.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sincronizarIntegracionesMP, MP_INTEGRACION_COLS } from '../_shared/mpSync.ts';

// Client propio en vez de importar el de _shared/auth.ts: acá no hace falta
// nada más de ese módulo (ni CORS ni verifyAdmin), y mantenerlo autocontenido
// evita arrastrar dependencias que esta función no usa.
const adminClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 });
  }

  try {
    // Alcance: TODAS las empresas con integración MP activa. Es lo que
    // diferencia a este worker de `mp-sync` (que filtra por auth.empresaId).
    const { data: integraciones, error: errInt } = await adminClient
      .from('integraciones_bancarias')
      .select(MP_INTEGRACION_COLS)
      .eq('proveedor', 'mercadopago')
      .eq('activo', true);

    if (errInt) {
      console.error('[mp-sync-worker] Error leyendo integraciones:', errInt.message);
      return new Response(JSON.stringify({ error: errInt.message }), { status: 500 });
    }

    if (!integraciones?.length) {
      return new Response(
        JSON.stringify({ ok: true, synced: 0, empresas: 0, mensaje: 'Sin integraciones MP activas' }),
        { status: 200 },
      );
    }

    const totalInsertados = await sincronizarIntegracionesMP(
      adminClient, integraciones, '[mp-sync-worker]',
    );

    console.log(`[mp-sync-worker] Completado. Empresas: ${integraciones.length}, insertados: ${totalInsertados}`);
    return new Response(
      JSON.stringify({ ok: true, synced: totalInsertados, empresas: integraciones.length }),
      { status: 200 },
    );

  } catch (err) {
    console.error('[mp-sync-worker]', (err as Error).message);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
});
