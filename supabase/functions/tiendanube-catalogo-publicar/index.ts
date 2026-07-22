import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { adminClient } from '../_shared/auth.ts';
import { leerTokenCanal } from '../_shared/integraciones.ts';

/**
 * Worker de PUBLICACIÓN de catálogo KAIROX → Tiendanube (FASE 2 del build
 * "Publicar catálogo", diseño en docs/DISENO_publicar_catalogo_tiendanube.md).
 * Disparado por pg_cron cada 5 min (migración 235), mismo patrón que
 * tiendanube-stock-worker / arca-worker: procesa la cola
 * integraciones_producto_pendiente con reintentos y backoff.
 *
 * Dirección ÚNICA KAIROX → Tiendanube (KAIROX es la fuente de verdad del
 * catálogo). Por cada producto encolado:
 *   - Si NO tiene mapeo con external_product_id → CREA el producto en TN
 *     (POST /products, con variante + imágenes inline) y guarda los IDs que
 *     devuelve TN en integraciones_producto_mapeo.
 *   - Si YA tiene external_product_id → ACTUALIZA (PUT /products/{id} para
 *     nombre/descripción + PUT /products/{id}/variants/{variant_id} para precio).
 *
 * V1: en ACTUALIZAR no se reconcilian imágenes (evita duplicarlas en cada
 * edición) ni stock (lo maneja su propia cola). Ver "iteraciones futuras" en el
 * doc de diseño.
 */
const TN_API_BASE = 'https://api.tiendanube.com/2025-03';
const USER_AGENT = 'KAIROX Gestion (soporte@kairox.app)';
const LOTE = 10;
const BACKOFF_MINUTOS = [1, 5, 15, 30, 60];

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface Producto {
  nombre: string;
  descripcion: string | null;
  precio_venta: number;
  codigo_sku: string | null;
  codigo_barras: string | null;
  stock_actual: number;
  es_inventariable: boolean;
  publicar_ecommerce: boolean;
}

function armarPayloadCrear(p: Producto, imagenes: string[]) {
  const variante: Record<string, unknown> = {
    price: String(p.precio_venta ?? 0),
  };
  if (p.codigo_sku) variante.sku = p.codigo_sku;
  if (p.codigo_barras) variante.barcode = p.codigo_barras;
  // Solo mandar stock si el artículo maneja inventario (un servicio no).
  if (p.es_inventariable) variante.stock = p.stock_actual ?? 0;

  const payload: Record<string, unknown> = {
    name: { es: p.nombre },
    variants: [variante],
  };
  if (p.descripcion) payload.description = { es: p.descripcion };
  if (imagenes.length > 0) payload.images = imagenes.map(src => ({ src }));
  return payload;
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const { data: pendientes, error: fetchError } = await adminClient
    .from('integraciones_producto_pendiente')
    .select('id, empresa_id, producto_id, intentos, max_intentos')
    .eq('estado', 'pendiente')
    .lte('proximo_intento', new Date().toISOString())
    .order('proximo_intento', { ascending: true })
    .limit(LOTE);

  if (fetchError) {
    console.error('[tiendanube-catalogo-publicar] Error leyendo la cola:', fetchError);
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
  }

  if (!pendientes?.length) {
    return new Response(JSON.stringify({ ok: true, procesados: 0 }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const resultados: Array<{ id: string; resultado: string }> = [];

  for (const item of pendientes) {
    await adminClient.from('integraciones_producto_pendiente').update({ estado: 'procesando' }).eq('id', item.id);

    try {
      const { data: producto } = await adminClient
        .from('productos')
        .select('nombre, descripcion, precio_venta, codigo_sku, codigo_barras, stock_actual, es_inventariable, publicar_ecommerce')
        .eq('id', item.producto_id)
        .single();

      if (!producto) throw new Error('Producto no encontrado');

      // El usuario pudo destildar "publicar" desde que se encoló — no despublicamos
      // en TN (destildar no borra), solo dejamos de intentar.
      if (!producto.publicar_ecommerce) {
        await adminClient.from('integraciones_producto_pendiente').update({ estado: 'publicado' }).eq('id', item.id);
        resultados.push({ id: item.id, resultado: 'ya_no_aplica' });
        continue;
      }

      // Integración activa de Tiendanube para la empresa.
      const { data: integracion } = await adminClient
        .from('integraciones_canales')
        .select('id, external_store_id')
        .eq('empresa_id', item.empresa_id)
        .eq('canal', 'tiendanube')
        .eq('activo', true)
        .maybeSingle();

      if (!integracion?.external_store_id) {
        throw new Error('Sin integración de Tiendanube activa para la empresa');
      }

      const token = await leerTokenCanal(item.empresa_id, 'tiendanube');
      if (!token) throw new Error('Sin token vigente para la integración');

      const storeId = integracion.external_store_id;
      const headers = {
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
      };

      // ¿Ya está publicado (tiene mapeo con external_product_id)?
      const { data: mapeo } = await adminClient
        .from('integraciones_producto_mapeo')
        .select('id, external_id, external_product_id')
        .eq('producto_id', item.producto_id)
        .eq('integracion_id', integracion.id)
        .maybeSingle();

      if (mapeo?.external_product_id) {
        // ── ACTUALIZAR ──────────────────────────────────────────────────────
        const resProd = await fetch(`${TN_API_BASE}/${storeId}/products/${mapeo.external_product_id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            name: { es: producto.nombre },
            ...(producto.descripcion ? { description: { es: producto.descripcion } } : {}),
          }),
        });
        if (!resProd.ok) throw new Error(`TN PUT product ${resProd.status}: ${await resProd.text()}`);

        // Precio vive en la variante.
        if (mapeo.external_id) {
          const resVar = await fetch(
            `${TN_API_BASE}/${storeId}/products/${mapeo.external_product_id}/variants/${mapeo.external_id}`,
            { method: 'PUT', headers, body: JSON.stringify({ price: String(producto.precio_venta ?? 0) }) },
          );
          if (!resVar.ok) throw new Error(`TN PUT variant ${resVar.status}: ${await resVar.text()}`);
        }

        await adminClient.from('integraciones_producto_pendiente').update({ estado: 'publicado' }).eq('id', item.id);
        resultados.push({ id: item.id, resultado: 'actualizado' });
        console.log('[tiendanube-catalogo-publicar] ✓ Producto actualizado:', item.producto_id);
      } else {
        // ── CREAR ───────────────────────────────────────────────────────────
        const { data: imgs } = await adminClient
          .from('producto_imagenes')
          .select('url')
          .eq('producto_id', item.producto_id)
          .order('es_principal', { ascending: false })
          .order('orden', { ascending: true });
        const imagenes = (imgs ?? []).map(i => i.url as string).filter(Boolean);

        const res = await fetch(`${TN_API_BASE}/${storeId}/products`, {
          method: 'POST',
          headers,
          body: JSON.stringify(armarPayloadCrear(producto as Producto, imagenes)),
        });
        if (!res.ok) throw new Error(`TN POST product ${res.status}: ${await res.text()}`);

        const creado = await res.json();
        const externalProductId = creado?.id != null ? String(creado.id) : null;
        const primeraVariante = Array.isArray(creado?.variants) && creado.variants[0]?.id != null
          ? String(creado.variants[0].id) : null;

        if (!externalProductId) throw new Error('TN no devolvió id de producto al crear');

        // Guardar el mapeo (upsert: puede existir una fila de stock sin external_product_id).
        if (mapeo?.id) {
          await adminClient.from('integraciones_producto_mapeo').update({
            external_id: primeraVariante ?? mapeo.external_id ?? externalProductId,
            external_product_id: externalProductId,
            external_sku: producto.codigo_sku ?? null,
          }).eq('id', mapeo.id);
        } else {
          await adminClient.from('integraciones_producto_mapeo').insert({
            integracion_id: integracion.id,
            producto_id: item.producto_id,
            external_id: primeraVariante ?? externalProductId,
            external_product_id: externalProductId,
            external_sku: producto.codigo_sku ?? null,
            sincronizar_stock: producto.es_inventariable,
          });
        }

        await adminClient.from('integraciones_producto_pendiente').update({ estado: 'publicado' }).eq('id', item.id);
        resultados.push({ id: item.id, resultado: 'creado' });
        console.log('[tiendanube-catalogo-publicar] ✓ Producto creado en TN:', item.producto_id, '→', externalProductId);
      }
    } catch (e) {
      const intentos = item.intentos + 1;
      const mensaje = e instanceof Error ? e.message : String(e);

      if (intentos >= item.max_intentos) {
        await adminClient.from('integraciones_producto_pendiente').update({
          estado: 'error_definitivo', intentos, error_mensaje: mensaje,
        }).eq('id', item.id);
        console.error('[tiendanube-catalogo-publicar] Error definitivo:', item.producto_id, mensaje);
        resultados.push({ id: item.id, resultado: 'error_definitivo' });
      } else {
        const backoff = BACKOFF_MINUTOS[Math.min(intentos - 1, BACKOFF_MINUTOS.length - 1)];
        await adminClient.from('integraciones_producto_pendiente').update({
          estado: 'pendiente',
          intentos,
          error_mensaje: mensaje,
          proximo_intento: new Date(Date.now() + backoff * 60 * 1000).toISOString(),
        }).eq('id', item.id);
        console.warn('[tiendanube-catalogo-publicar] Reintento programado:', item.producto_id, `intento ${intentos}, en ${backoff}min`);
        resultados.push({ id: item.id, resultado: 'reintentando' });
      }
    }

    // Pausa chica entre productos — respeta el rate limit de Tiendanube (2 req/s).
    await sleep(400);
  }

  return new Response(JSON.stringify({ ok: true, procesados: resultados.length, resultados }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
