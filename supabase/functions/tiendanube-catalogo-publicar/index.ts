import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { adminClient } from '../_shared/auth.ts';
import { leerTokenCanal } from '../_shared/integraciones.ts';

/**
 * Worker de PUBLICACIÓN de catálogo KAIROX → Tiendanube.
 * Se dispara de 2 formas: inmediato desde el frontend al guardar (fire-and-
 * forget, dispararPublicacionCatalogo) y por pg_cron cada 1 min como red de
 * seguridad (migración 238) para lo que el disparo inmediato no cubrió.
 * Dirección ÚNICA KAIROX → TN (KAIROX es la fuente de verdad). Por cada
 * producto encolado:
 *   - CREA (POST /products) si no tiene mapeo con external_product_id, o
 *   - ACTUALIZA (PUT product + PUT variant) si ya está publicado.
 * En AMBOS casos reconcilia imágenes: sube las nuevas, borra las que se quitaron
 * en KAIROX, sin re-subir las que ya están (mig.237, external_image_id).
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

type Headers = Record<string, string>;

/**
 * Reconcilia las imágenes del producto en Tiendanube con las de KAIROX (fuente
 * de verdad). Sube las que faltan (guardando el id que devuelve TN), borra las
 * que ya no están en KAIROX, y no re-sube las que ya tienen external_image_id.
 * Corre tanto en CREAR como en ACTUALIZAR.
 */
async function sincronizarImagenes(
  storeId: string,
  externalProductId: string,
  headers: Headers,
  productoId: string,
): Promise<void> {
  // Imágenes en KAIROX (principal primero, luego por orden).
  const { data: kx } = await adminClient
    .from('producto_imagenes')
    .select('id, url, external_image_id, es_principal, orden')
    .eq('producto_id', productoId)
    .order('es_principal', { ascending: false })
    .order('orden', { ascending: true });
  const kxImgs = kx ?? [];

  // Imágenes actualmente en Tiendanube.
  const tnRes = await fetch(`${TN_API_BASE}/${storeId}/products/${externalProductId}/images`, { headers });
  const tnImgs: Array<{ id: number | string }> = tnRes.ok ? await tnRes.json() : [];

  const kxExternalIds = new Set(kxImgs.map(i => i.external_image_id).filter(Boolean).map(String));

  // Borrar de TN las imágenes que ya no existen en KAIROX (quitadas por el usuario).
  for (const t of tnImgs) {
    if (!kxExternalIds.has(String(t.id))) {
      await fetch(`${TN_API_BASE}/${storeId}/products/${externalProductId}/images/${t.id}`, {
        method: 'DELETE', headers,
      });
      await sleep(250);
    }
  }

  // Subir a TN las imágenes de KAIROX que todavía no están (sin external_image_id).
  for (const img of kxImgs) {
    if (img.external_image_id) continue;
    const r = await fetch(`${TN_API_BASE}/${storeId}/products/${externalProductId}/images`, {
      method: 'POST', headers, body: JSON.stringify({ src: img.url }),
    });
    if (r.ok) {
      const creada = await r.json();
      if (creada?.id != null) {
        // Este UPDATE NO re-encola (el trigger fn_queue_publicar_imagenes ignora
        // cambios que solo tocan external_image_id — mig.237).
        await adminClient.from('producto_imagenes')
          .update({ external_image_id: String(creada.id) })
          .eq('id', img.id);
      }
    } else {
      console.warn('[tiendanube-catalogo-publicar] No se pudo subir imagen:', r.status, await r.text());
    }
    await sleep(250);
  }
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
    // CAS (compare-and-swap): solo toma el ítem si su estado sigue siendo
    // 'pendiente'. Necesario porque ahora el worker se dispara tanto por cron
    // (cada 1 min) como inmediatamente al guardar desde el frontend — sin este
    // guard, dos invocaciones podrían leer el mismo ítem antes de que ninguna lo
    // bloquee y publicarlo DUPLICADO en Tiendanube (mismo patrón que el lock de
    // arca-worker, mig.201, para el mismo tipo de condición de carrera).
    const { data: tomado } = await adminClient
      .from('integraciones_producto_pendiente')
      .update({ estado: 'procesando' })
      .eq('id', item.id)
      .eq('estado', 'pendiente')
      .select('id');

    if (!tomado?.length) {
      resultados.push({ id: item.id, resultado: 'skip (otra invocación lo tomó)' });
      continue;
    }

    try {
      const { data: p } = await adminClient
        .from('productos')
        .select('nombre, descripcion, precio_venta, codigo_sku, codigo_barras, stock_actual, es_inventariable, publicar_ecommerce')
        .eq('id', item.producto_id)
        .single();

      if (!p) throw new Error('Producto no encontrado');
      const producto = p as Producto;

      if (!producto.publicar_ecommerce) {
        await adminClient.from('integraciones_producto_pendiente').update({ estado: 'publicado' }).eq('id', item.id);
        resultados.push({ id: item.id, resultado: 'ya_no_aplica' });
        continue;
      }

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
      const headers: Headers = {
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
      };

      const { data: mapeo } = await adminClient
        .from('integraciones_producto_mapeo')
        .select('id, external_id, external_product_id')
        .eq('producto_id', item.producto_id)
        .eq('integracion_id', integracion.id)
        .maybeSingle();

      let externalProductId: string;

      if (mapeo?.external_product_id) {
        // ── ACTUALIZAR ──────────────────────────────────────────────────────
        externalProductId = mapeo.external_product_id;

        const resProd = await fetch(`${TN_API_BASE}/${storeId}/products/${externalProductId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            name: { es: producto.nombre },
            ...(producto.descripcion ? { description: { es: producto.descripcion } } : {}),
          }),
        });
        if (!resProd.ok) throw new Error(`TN PUT product ${resProd.status}: ${await resProd.text()}`);

        // Variante: precio + SKU + código de barras. El stock lo maneja su propia
        // cola (fn_queue_stock_tiendanube) — no se toca acá para no pisarlo.
        if (mapeo.external_id) {
          const variante: Record<string, unknown> = { price: String(producto.precio_venta ?? 0) };
          if (producto.codigo_sku) variante.sku = producto.codigo_sku;
          if (producto.codigo_barras) variante.barcode = producto.codigo_barras;
          const resVar = await fetch(
            `${TN_API_BASE}/${storeId}/products/${externalProductId}/variants/${mapeo.external_id}`,
            { method: 'PUT', headers, body: JSON.stringify(variante) },
          );
          if (!resVar.ok) throw new Error(`TN PUT variant ${resVar.status}: ${await resVar.text()}`);
        }
      } else {
        // ── CREAR ───────────────────────────────────────────────────────────
        // Sin imágenes inline: se suben después con sincronizarImagenes para
        // capturar el external_image_id de cada una (create y update comparten
        // la misma reconciliación).
        const variante: Record<string, unknown> = { price: String(producto.precio_venta ?? 0) };
        if (producto.codigo_sku) variante.sku = producto.codigo_sku;
        if (producto.codigo_barras) variante.barcode = producto.codigo_barras;
        if (producto.es_inventariable) variante.stock = producto.stock_actual ?? 0;

        const payload: Record<string, unknown> = { name: { es: producto.nombre }, variants: [variante] };
        if (producto.descripcion) payload.description = { es: producto.descripcion };

        const res = await fetch(`${TN_API_BASE}/${storeId}/products`, {
          method: 'POST', headers, body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`TN POST product ${res.status}: ${await res.text()}`);

        const creado = await res.json();
        externalProductId = creado?.id != null ? String(creado.id) : '';
        const primeraVariante = Array.isArray(creado?.variants) && creado.variants[0]?.id != null
          ? String(creado.variants[0].id) : null;
        if (!externalProductId) throw new Error('TN no devolvió id de producto al crear');

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
      }

      // Reconciliar imágenes (crear y actualizar).
      await sincronizarImagenes(storeId, externalProductId, headers, item.producto_id);

      await adminClient.from('integraciones_producto_pendiente').update({ estado: 'publicado' }).eq('id', item.id);
      resultados.push({ id: item.id, resultado: mapeo?.external_product_id ? 'actualizado' : 'creado' });
      console.log('[tiendanube-catalogo-publicar] ✓ Publicado:', item.producto_id, '→', externalProductId);
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

    await sleep(400);
  }

  return new Response(JSON.stringify({ ok: true, procesados: resultados.length, resultados }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
