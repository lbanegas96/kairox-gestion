import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { adminClient, buildCorsHeaders } from '../_shared/auth.ts';
import { obtenerTokenValido } from '../_shared/integraciones.ts';

/**
 * Worker de PUBLICACIÓN de catálogo KAIROX → MercadoLibre (Fase 5).
 * Espejo del de Tiendanube (tiendanube-catalogo-publicar) con las diferencias de
 * MELI: para CREAR una publicación hace falta categoría + atributos obligatorios
 * (marca/modelo/etc.), que salen de producto_mercadolibre_config (lo carga el
 * usuario en el formulario). Dirección ÚNICA KAIROX → MELI.
 *
 * Se dispara igual que el de Tiendanube: inmediato desde el frontend al guardar
 * (fire-and-forget) y por pg_cron cada 5 min como red de seguridad (mig.240).
 * Toma solo la cola canal='mercadolibre'.
 *
 * Por producto:
 *   - CREA (POST /items) si no hay mapeo con external_product_id.
 *   - ACTUALIZA (PUT /items/{id}) si ya está publicado (título/precio/fotos/atributos;
 *     el stock lo maneja su propia cola, no se toca acá para no pisarlo).
 *
 * API MELI: POST /items  https://api.mercadolibre.com/items  (token del vendedor).
 *
 * FASE 6 — enganche a catálogo (2026-07-24): se confirmó contra la API real
 * que la inmensa mayoría de las categorías de MELI (ropa, mates, electrodomésticos)
 * exigen `family_name` en el body y, en cuanto se lo manda, rechazan el `title`
 * propio ("body.invalid_fields [title]") — MELI exige engancharse a una ficha de
 * su catálogo oficial en vez de crear un ítem libre. Por eso `producto_mercadolibre_config`
 * ahora tiene `catalog_product_id` (elegido por el usuario en el formulario, que
 * busca con la acción `catalog_search` de `mercadolibre-categorias`). Si está
 * presente, CREAR arma un body mínimo enganchado a esa ficha (MELI trae título/
 * fotos de ahí — KAIROX solo pone precio/stock/condición + SELLER_SKU). Si NO
 * está presente, se intenta el camino viejo (title propio) — que en la práctica
 * solo sirve para las pocas categorías sin catalog_domain.
 */
const ML_API_BASE = 'https://api.mercadolibre.com';
const CURRENCY = 'ARS';
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
  stock_actual: number;
  es_inventariable: boolean;
  publicar_mercadolibre: boolean;
}

interface MeliConfig {
  category_id: string | null;
  condicion: string;
  listing_type_id: string;
  atributos: Array<{ id: string; value_name?: string; value_id?: string }>;
  catalog_product_id: string | null;
}

type Hdrs = Record<string, string>;

async function urlsImagenes(productoId: string): Promise<string[]> {
  const { data } = await adminClient
    .from('producto_imagenes')
    .select('url, es_principal, orden')
    .eq('producto_id', productoId)
    .order('es_principal', { ascending: false })
    .order('orden', { ascending: true });
  return (data ?? []).map(i => i.url).filter(Boolean);
}

// Arma la lista de atributos para MELI: los que cargó el usuario + SELLER_SKU
// (para que el mapeo/stock por SKU matchee después), sin duplicar. Nota:
// FAMILY_NAME como atributo NO satisface el requisito de MELI (probado
// 2026-07-23) — lo que hace falta es catalog_product_id, ver Fase 6 arriba.
function construirAtributos(config: MeliConfig, codigoSku: string | null) {
  const attrs = (config.atributos ?? []).filter(a => a && a.id);
  const yaTieneSku = attrs.some(a => a.id === 'SELLER_SKU');
  if (codigoSku && !yaTieneSku) {
    attrs.push({ id: 'SELLER_SKU', value_name: codigoSku });
  }
  return attrs;
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });

  const { data: pendientes, error: fetchError } = await adminClient
    .from('integraciones_producto_pendiente')
    .select('id, empresa_id, producto_id, intentos, max_intentos')
    .eq('estado', 'pendiente')
    .eq('canal', 'mercadolibre')
    .lte('proximo_intento', new Date().toISOString())
    .order('proximo_intento', { ascending: true })
    .limit(LOTE);

  if (fetchError) {
    console.error('[mercadolibre-catalogo-publicar] Error leyendo la cola:', fetchError);
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  if (!pendientes?.length) {
    return new Response(JSON.stringify({ ok: true, procesados: 0 }), {
      status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const resultados: Array<{ id: string; resultado: string }> = [];

  for (const item of pendientes) {
    // CAS: solo tomar si sigue 'pendiente' (cron + disparo inmediato pueden coincidir).
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
        .select('nombre, descripcion, precio_venta, codigo_sku, stock_actual, es_inventariable, publicar_mercadolibre')
        .eq('id', item.producto_id)
        .single();
      if (!p) throw new Error('Producto no encontrado');
      const producto = p as Producto;

      if (!producto.publicar_mercadolibre) {
        await adminClient.from('integraciones_producto_pendiente').update({ estado: 'publicado' }).eq('id', item.id);
        resultados.push({ id: item.id, resultado: 'ya_no_aplica' });
        continue;
      }

      const { data: cfg } = await adminClient
        .from('producto_mercadolibre_config')
        .select('category_id, condicion, listing_type_id, atributos, catalog_product_id')
        .eq('producto_id', item.producto_id)
        .maybeSingle();
      const config = cfg as MeliConfig | null;
      if (!config?.category_id) {
        throw new Error('Falta completar la categoría de MercadoLibre para este producto');
      }

      const { data: integracion } = await adminClient
        .from('integraciones_canales')
        .select('id')
        .eq('empresa_id', item.empresa_id)
        .eq('canal', 'mercadolibre')
        .eq('activo', true)
        .maybeSingle();
      if (!integracion) throw new Error('Sin integración de MercadoLibre activa para la empresa');

      const token = await obtenerTokenValido(item.empresa_id, 'mercadolibre');
      if (!token) throw new Error('Sin token vigente para la integración de MercadoLibre');

      const headers: Hdrs = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const pics = (await urlsImagenes(item.producto_id)).map(url => ({ source: url }));

      const { data: mapeo } = await adminClient
        .from('integraciones_producto_mapeo')
        .select('id, external_id, external_product_id')
        .eq('producto_id', item.producto_id)
        .eq('integracion_id', integracion.id)
        .maybeSingle();

      const precio = Number(producto.precio_venta) || 0;

      if (mapeo?.external_product_id) {
        // ── ACTUALIZAR ─────────────────────────────────────────────────────
        // No se toca available_quantity: lo maneja la cola de stock.
        // Enganchado al catálogo: title Y pictures son de la ficha compartida y
        // MELI los rechaza con 400 "field_not_updatable" si se los manda acá
        // (probado contra la API real 2026-07-24) — solo se actualiza precio +
        // atributos propios (SKU).
        const bodyUpd: Record<string, unknown> = config.catalog_product_id
          ? { price: precio, attributes: construirAtributos(config, producto.codigo_sku) }
          : { title: producto.nombre, price: precio, attributes: construirAtributos(config, producto.codigo_sku) };
        if (!config.catalog_product_id && pics.length) bodyUpd.pictures = pics;

        const res = await fetch(`${ML_API_BASE}/items/${mapeo.external_product_id}`, {
          method: 'PUT', headers, body: JSON.stringify(bodyUpd),
        });
        if (!res.ok) throw new Error(`MELI PUT item ${res.status}: ${await res.text()}`);
      } else {
        // ── CREAR ──────────────────────────────────────────────────────────
        const stock = Math.max(0, Math.trunc(Number(producto.stock_actual ?? 0)));
        const atributosSku = producto.codigo_sku ? [{ id: 'SELLER_SKU', value_name: producto.codigo_sku }] : [];

        let bodyNew: Record<string, unknown>;
        if (config.catalog_product_id) {
          // Enganchado al catálogo oficial: título Y fotos son de la ficha
          // compartida entre todos los vendedores — MELI no deja poner las
          // propias (probado: PUT con pictures da 400 field_not_updatable).
          // "Sugerir corrección" en la web de MELI no es "mi foto para mi
          // publicación": es proponerle a MELI un cambio a la ficha compartida,
          // sujeto a su revisión y visible para todos los que vendan ese mismo
          // producto — no lo hacemos automático desde acá.
          bodyNew = {
            catalog_product_id: config.catalog_product_id,
            catalog_listing: true,
            category_id: config.category_id,
            price: precio,
            currency_id: CURRENCY,
            available_quantity: producto.es_inventariable ? stock : 1,
            condition: config.condicion || 'new',
            listing_type_id: config.listing_type_id || 'bronze',
            attributes: atributosSku,
          };
        } else {
          if (!pics.length) {
            throw new Error('MercadoLibre exige al menos una foto — agregá una imagen al producto');
          }
          bodyNew = {
            title: producto.nombre,
            category_id: config.category_id,
            price: precio,
            currency_id: CURRENCY,
            available_quantity: producto.es_inventariable ? stock : 1,
            buying_mode: 'buy_it_now',
            listing_type_id: config.listing_type_id || 'bronze',
            condition: config.condicion || 'new',
            pictures: pics,
            attributes: construirAtributos(config, producto.codigo_sku),
          };
        }

        const res = await fetch(`${ML_API_BASE}/items`, {
          method: 'POST', headers, body: JSON.stringify(bodyNew),
        });
        if (!res.ok) throw new Error(`MELI POST item ${res.status}: ${await res.text()}`);

        const creado = await res.json();
        const itemId = creado?.id != null ? String(creado.id) : '';
        if (!itemId) throw new Error('MELI no devolvió id de publicación al crear');

        // Descripción (endpoint aparte en MELI: POST /items/{id}/description).
        // Enganchado al catálogo, MELI ya trae su propia ficha — no se pisa.
        if (producto.descripcion && !config.catalog_product_id) {
          await fetch(`${ML_API_BASE}/items/${itemId}/description`, {
            method: 'POST', headers, body: JSON.stringify({ plain_text: producto.descripcion }),
          });
        }

        // Variación si la hubiera (publicaciones simples no tienen): external_id = item id.
        const primeraVar = Array.isArray(creado?.variations) && creado.variations[0]?.id != null
          ? String(creado.variations[0].id) : null;

        if (mapeo?.id) {
          await adminClient.from('integraciones_producto_mapeo').update({
            external_id: primeraVar ?? itemId,
            external_product_id: itemId,
            external_sku: producto.codigo_sku ?? null,
          }).eq('id', mapeo.id);
        } else {
          await adminClient.from('integraciones_producto_mapeo').insert({
            integracion_id: integracion.id,
            producto_id: item.producto_id,
            external_id: primeraVar ?? itemId,
            external_product_id: itemId,
            external_sku: producto.codigo_sku ?? null,
            sincronizar_stock: producto.es_inventariable,
          });
        }
      }

      await adminClient.from('integraciones_producto_pendiente').update({ estado: 'publicado' }).eq('id', item.id);
      resultados.push({ id: item.id, resultado: mapeo?.external_product_id ? 'actualizado' : 'creado' });
      console.log('[mercadolibre-catalogo-publicar] ✓ Publicado:', item.producto_id);
    } catch (e) {
      const intentos = item.intentos + 1;
      const mensaje = e instanceof Error ? e.message : String(e);

      if (intentos >= item.max_intentos) {
        await adminClient.from('integraciones_producto_pendiente').update({
          estado: 'error_definitivo', intentos, error_mensaje: mensaje,
        }).eq('id', item.id);
        console.error('[mercadolibre-catalogo-publicar] Error definitivo:', item.producto_id, mensaje);
        resultados.push({ id: item.id, resultado: 'error_definitivo' });
      } else {
        const backoff = BACKOFF_MINUTOS[Math.min(intentos - 1, BACKOFF_MINUTOS.length - 1)];
        await adminClient.from('integraciones_producto_pendiente').update({
          estado: 'pendiente',
          intentos,
          error_mensaje: mensaje,
          proximo_intento: new Date(Date.now() + backoff * 60 * 1000).toISOString(),
        }).eq('id', item.id);
        console.warn('[mercadolibre-catalogo-publicar] Reintento programado:', item.producto_id, `intento ${intentos}, en ${backoff}min`);
        resultados.push({ id: item.id, resultado: 'reintentando' });
      }
    }

    await sleep(400);
  }

  return new Response(JSON.stringify({ ok: true, procesados: resultados.length, resultados }), {
    status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
  });
});
