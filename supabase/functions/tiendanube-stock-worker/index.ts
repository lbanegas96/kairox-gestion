import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { adminClient } from '../_shared/auth.ts';
import { leerTokenCanal } from '../_shared/integraciones.ts';

/**
 * Worker de sync de stock KAIROX → Tiendanube (paso 3 del adapter, ROADMAP.md).
 * Disparado por pg_cron cada 5 minutos (migración 233), mismo patrón que
 * arca-worker: procesa la cola integraciones_stock_pendiente con reintentos y
 * backoff. Dirección ÚNICA — KAIROX es la fuente de verdad del stock.
 *
 * Siempre lee productos.stock_actual MÁS RECIENTE al momento de procesar (no un
 * valor guardado en la cola en el momento del encolado) — si el stock cambió
 * varias veces entre el encolado y el procesamiento, se sincroniza el valor real
 * actual, no uno intermedio ya viejo.
 *
 * API: POST /{store_id}/products/{external_product_id}/variants/stock
 *   body: { action: 'replace', value: <stock>, id: <external_id de la variante> }
 */
const TN_API_BASE = 'https://api.tiendanube.com/2025-03';
const USER_AGENT = 'KAIROX Gestion (soporte@kairox.app)';
const LOTE = 20;
const BACKOFF_MINUTOS = [1, 5, 15, 30, 60];

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { data: pendientes, error: fetchError } = await adminClient
    .from('integraciones_stock_pendiente')
    .select('id, empresa_id, producto_id, intentos, max_intentos')
    .eq('estado', 'pendiente')
    .lte('proximo_intento', new Date().toISOString())
    .order('proximo_intento', { ascending: true })
    .limit(LOTE);

  if (fetchError) {
    console.error('[tiendanube-stock-worker] Error leyendo la cola:', fetchError);
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }

  if (!pendientes?.length) {
    return new Response(JSON.stringify({ ok: true, procesados: 0 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const resultados: Array<{ id: string; resultado: string }> = [];

  for (const item of pendientes) {
    await adminClient.from('integraciones_stock_pendiente').update({ estado: 'procesando' }).eq('id', item.id);

    try {
      // Re-chequear el mapeo AHORA (pudo haberse desactivado desde que se encoló)
      const { data: mapeo } = await adminClient
        .from('integraciones_producto_mapeo')
        .select('external_id, external_product_id, integracion_id, integraciones_canales!inner(external_store_id, activo, canal)')
        .eq('producto_id', item.producto_id)
        .eq('sincronizar_stock', true)
        .eq('integraciones_canales.activo', true)
        .eq('integraciones_canales.canal', 'tiendanube')
        .maybeSingle();

      if (!mapeo || !mapeo.external_product_id) {
        console.log('[tiendanube-stock-worker] Sin mapeo activo (ya no aplica) — marcando sincronizado:', item.producto_id);
        await adminClient.from('integraciones_stock_pendiente').update({ estado: 'sincronizado' }).eq('id', item.id);
        resultados.push({ id: item.id, resultado: 'sin_mapeo' });
        continue;
      }

      const { data: producto } = await adminClient
        .from('productos')
        .select('stock_actual')
        .eq('id', item.producto_id)
        .single();

      const token = await leerTokenCanal(item.empresa_id, 'tiendanube');
      const storeId = (mapeo.integraciones_canales as unknown as { external_store_id: string }).external_store_id;

      if (!token || !storeId) {
        throw new Error('Sin token o store_id vigente para la integración');
      }

      const res = await fetch(
        `${TN_API_BASE}/${storeId}/products/${mapeo.external_product_id}/variants/stock`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': USER_AGENT,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'replace',
            value: producto?.stock_actual ?? 0,
            id: Number(mapeo.external_id),
          }),
        },
      );

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Tiendanube respondió ${res.status}: ${body}`);
      }

      await adminClient.from('integraciones_stock_pendiente').update({ estado: 'sincronizado' }).eq('id', item.id);
      resultados.push({ id: item.id, resultado: 'sincronizado' });
      console.log('[tiendanube-stock-worker] ✓ Stock sincronizado:', item.producto_id, '→', producto?.stock_actual);
    } catch (e) {
      const intentos = item.intentos + 1;
      const mensaje = e instanceof Error ? e.message : String(e);

      if (intentos >= item.max_intentos) {
        await adminClient.from('integraciones_stock_pendiente').update({
          estado: 'error_definitivo', intentos, error_mensaje: mensaje,
        }).eq('id', item.id);
        console.error('[tiendanube-stock-worker] Error definitivo:', item.producto_id, mensaje);
        resultados.push({ id: item.id, resultado: 'error_definitivo' });
      } else {
        const backoff = BACKOFF_MINUTOS[Math.min(intentos - 1, BACKOFF_MINUTOS.length - 1)];
        await adminClient.from('integraciones_stock_pendiente').update({
          estado: 'pendiente',
          intentos,
          error_mensaje: mensaje,
          proximo_intento: new Date(Date.now() + backoff * 60 * 1000).toISOString(),
        }).eq('id', item.id);
        console.warn('[tiendanube-stock-worker] Reintento programado:', item.producto_id, `intento ${intentos}, en ${backoff}min`);
        resultados.push({ id: item.id, resultado: 'reintentando' });
      }
    }

    // Pausa chica entre llamadas — evita ráfagas contra el rate limit de
    // Tiendanube (leaky bucket 2 req/s) si hay varios productos de la misma tienda.
    await sleep(300);
  }

  return new Response(JSON.stringify({ ok: true, procesados: resultados.length, resultados }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
