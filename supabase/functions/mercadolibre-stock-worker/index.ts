import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { adminClient } from '../_shared/auth.ts';
import { obtenerTokenValido } from '../_shared/integraciones.ts';

/**
 * Worker de sync de stock KAIROX → MercadoLibre (Fase 4 del adapter, ROADMAP.md).
 * Disparado por pg_cron cada 5 minutos (migración 239), mismo patrón que el worker
 * de Tiendanube: procesa la cola integraciones_stock_pendiente (multi-canal, filtra
 * canal='mercadolibre') con reintentos y backoff. Dirección ÚNICA — KAIROX es la
 * fuente de verdad del stock.
 *
 * Siempre lee productos.stock_actual MÁS RECIENTE al procesar (no un snapshot del
 * encolado).
 *
 * API de stock de MercadoLibre (usa obtenerTokenValido — el access token expira a 6h):
 *   - Publicación SIN variaciones (external_id == external_product_id):
 *       PUT /items/{item_id}   body { available_quantity: <stock> }
 *   - Publicación CON variaciones (external_id = variation_id):
 *       PUT /items/{item_id}   body { variations: [{ id: <variation_id>, available_quantity: <stock> }] }
 */
const ML_API_BASE = 'https://api.mercadolibre.com';
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
    .eq('canal', 'mercadolibre')
    .lte('proximo_intento', new Date().toISOString())
    .order('proximo_intento', { ascending: true })
    .limit(LOTE);

  if (fetchError) {
    console.error('[mercadolibre-stock-worker] Error leyendo la cola:', fetchError);
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
      // Re-chequear el mapeo AHORA (pudo desactivarse desde que se encoló)
      const { data: mapeo } = await adminClient
        .from('integraciones_producto_mapeo')
        .select('external_id, external_product_id, integraciones_canales!inner(activo, canal)')
        .eq('producto_id', item.producto_id)
        .eq('sincronizar_stock', true)
        .eq('integraciones_canales.activo', true)
        .eq('integraciones_canales.canal', 'mercadolibre')
        .maybeSingle();

      if (!mapeo || !mapeo.external_product_id || !mapeo.external_id) {
        console.log('[mercadolibre-stock-worker] Sin mapeo activo (ya no aplica) — marcando sincronizado:', item.producto_id);
        await adminClient.from('integraciones_stock_pendiente').update({ estado: 'sincronizado' }).eq('id', item.id);
        resultados.push({ id: item.id, resultado: 'sin_mapeo' });
        continue;
      }

      const { data: producto } = await adminClient
        .from('productos')
        .select('stock_actual')
        .eq('id', item.producto_id)
        .single();

      const token = await obtenerTokenValido(item.empresa_id, 'mercadolibre');
      if (!token) {
        throw new Error('Sin token vigente para la integración de MercadoLibre');
      }

      const stock = Math.max(0, Math.trunc(Number(producto?.stock_actual ?? 0)));
      const itemId = mapeo.external_product_id;

      // Publicación con variaciones: external_id es el id de la variación; sin
      // variaciones: external_id == external_product_id (el propio ítem).
      const tieneVariacion = String(mapeo.external_id) !== String(mapeo.external_product_id);
      const body = tieneVariacion
        ? { variations: [{ id: Number(mapeo.external_id), available_quantity: stock }] }
        : { available_quantity: stock };

      const res = await fetch(`${ML_API_BASE}/items/${itemId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detalle = await res.text();
        throw new Error(`MercadoLibre respondió ${res.status}: ${detalle}`);
      }

      await adminClient.from('integraciones_stock_pendiente').update({ estado: 'sincronizado' }).eq('id', item.id);
      resultados.push({ id: item.id, resultado: 'sincronizado' });
      console.log('[mercadolibre-stock-worker] ✓ Stock sincronizado:', item.producto_id, '→', stock);
    } catch (e) {
      const intentos = item.intentos + 1;
      const mensaje = e instanceof Error ? e.message : String(e);

      if (intentos >= item.max_intentos) {
        await adminClient.from('integraciones_stock_pendiente').update({
          estado: 'error_definitivo', intentos, error_mensaje: mensaje,
        }).eq('id', item.id);
        console.error('[mercadolibre-stock-worker] Error definitivo:', item.producto_id, mensaje);
        resultados.push({ id: item.id, resultado: 'error_definitivo' });
      } else {
        const backoff = BACKOFF_MINUTOS[Math.min(intentos - 1, BACKOFF_MINUTOS.length - 1)];
        await adminClient.from('integraciones_stock_pendiente').update({
          estado: 'pendiente',
          intentos,
          error_mensaje: mensaje,
          proximo_intento: new Date(Date.now() + backoff * 60 * 1000).toISOString(),
        }).eq('id', item.id);
        console.warn('[mercadolibre-stock-worker] Reintento programado:', item.producto_id, `intento ${intentos}, en ${backoff}min`);
        resultados.push({ id: item.id, resultado: 'reintentando' });
      }
    }

    // Pausa chica entre llamadas para no gatillar el rate limit de MELI.
    await sleep(300);
  }

  return new Response(JSON.stringify({ ok: true, procesados: resultados.length, resultados }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
