// supabase/functions/tc-diario-sync/index.ts
// Carga automática del tipo de cambio del día (PLAN_TC_AUTOMATICO.md, fase A).
//
// Corre por cron todos los días a las 08:00 AR (11:00 UTC). También acepta
// invocación manual por HTTP POST para testing.
//
// Fuente: dolarapi.com, endpoint del dólar OFICIAL, campo `venta`.
//   Decisión de negocio confirmada por Nadia (2026-07-28): el criterio es el
//   dólar oficial vendedor, NO el blue — el texto del TipoCambioModal sugería
//   blue y quedó desactualizado respecto de esta decisión.
//
// Alcance v1: solo empresas con moneda_paralela='USD'. dolarapi no cubre EUR/BRL
// con la misma calidad, así que esas empresas siguen cargando a mano.
//
// Corre TODOS los días, incluidos sábados y domingos, a propósito: el gate de
// moneda paralela busca un TC con `fecha = hoy`, así que si el fin de semana no
// se escribiera ninguna fila, toda operación de sábado/domingo quedaría
// bloqueada. Con el mercado cerrado dolarapi devuelve la última cotización
// (la del viernes), que además es el tratamiento financiero correcto: las
// operaciones del fin de semana se valúan al cierre del último día hábil.

// Nota: esta función crea su propio adminClient en vez de importar el de
// `_shared/auth.ts` como hacen las demás. Es lo único que necesita de ahí (no usa
// CORS ni verifyAdmin: la invoca el cron, no el browser), y mantenerla
// autocontenida evita el paso de bundling del import relativo al deployar.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const adminClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const DOLARAPI_URL = 'https://dolarapi.com/v1/dolares/oficial';

/** YYYY-MM-DD de hoy en hora Argentina (UTC-3 fijo, sin horario de verano desde 2009).
 *  Misma convención que `getTodayAR()` en src/lib/dateUtils.js. */
function hoyAR(): string {
  return new Date(Date.now() - 3 * 3600000).toISOString().split('T')[0];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200 });
  }

  const fecha = hoyAR();
  const resumen = {
    fecha,
    tasa: null as number | null,
    empresas_procesadas: 0,
    creados: 0,
    actualizados: 0,
    respetados_manual: 0,
    errores: [] as string[],
  };

  try {
    // ── 1. Cotización, una sola vez para todo el batch ──────────────────────
    const resp = await fetch(DOLARAPI_URL, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      throw new Error(`dolarapi respondió ${resp.status}`);
    }
    const cotizacion = await resp.json();
    const tasa = Number(cotizacion?.venta);

    // Guard de sanidad: si la API cambia de forma o devuelve basura, no escribimos
    // nada. Es preferible que el sistema caiga al banner manual de siempre antes
    // que valuar operaciones reales contra un número inventado.
    if (!Number.isFinite(tasa) || tasa <= 0) {
      throw new Error(`Cotización inválida recibida de dolarapi: ${JSON.stringify(cotizacion?.venta)}`);
    }
    resumen.tasa = tasa;

    // ── 2. Empresas con automático prendido ────────────────────────────────
    const { data: empresas, error: empErr } = await adminClient
      .from('empresas')
      .select('id, nombre, moneda_paralela')
      .eq('usa_tc_paralelo', true)
      .eq('tc_automatico', true);

    if (empErr) throw empErr;

    // ── 3. Upsert por empresa, aislando fallos ─────────────────────────────
    for (const empresa of empresas ?? []) {
      // v1 solo cubre USD. El toggle de Configuración ya no se ofrece para otras
      // monedas, pero se re-chequea acá por si el dato cambió después.
      if (empresa.moneda_paralela !== 'USD') continue;

      resumen.empresas_procesadas++;

      try {
        // Nunca pisar un TC que un humano cargó a mano hoy: si alguien lo puso
        // antes de que corriera el cron, esa decisión gana. Solo refrescamos
        // filas que escribió esta misma función.
        const { data: existente, error: selErr } = await adminClient
          .from('tipos_cambio')
          .select('id, origen')
          .eq('empresa_id', empresa.id)
          .eq('moneda', 'USD')
          .eq('fecha', fecha)
          .maybeSingle();

        if (selErr) throw selErr;

        if (existente && existente.origen === 'manual') {
          resumen.respetados_manual++;
          continue;
        }

        if (existente) {
          const { error } = await adminClient
            .from('tipos_cambio')
            .update({ tasa, origen: 'automatico' })
            .eq('id', existente.id);
          if (error) throw error;
          resumen.actualizados++;
        } else {
          const { error } = await adminClient
            .from('tipos_cambio')
            .insert({
              empresa_id: empresa.id,
              moneda: 'USD',
              fecha,
              tasa,
              origen: 'automatico',
            });
          if (error) throw error;
          resumen.creados++;
        }
      } catch (e) {
        // Un error en una empresa no frena el resto del batch.
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[tc-diario-sync] Falló empresa ${empresa.id}:`, msg);
        resumen.errores.push(`${empresa.id}: ${msg}`);
      }
    }

    console.log('[tc-diario-sync]', JSON.stringify(resumen));
    return new Response(JSON.stringify({ ok: true, ...resumen }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // Fallo global (dolarapi caído, respuesta inesperada, etc.): no se escribe
    // nada y el sistema queda exactamente como está hoy — cada empresa ve el
    // banner manual de siempre. Nunca se inventa ni se reutiliza un TC viejo.
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[tc-diario-sync] Fallo global:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg, ...resumen }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
