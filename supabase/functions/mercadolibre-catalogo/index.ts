import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyAdmin, adminClient, buildCorsHeaders, errorResponse, okResponse } from '../_shared/auth.ts';
import { obtenerTokenValido } from '../_shared/integraciones.ts';

// Trae el catálogo de publicaciones de la cuenta de MercadoLibre conectada,
// aplanado al mismo formato que tiendanube-catalogo (external_id/external_product_id/
// external_sku/nombre/stock) para que MapeoProductosModal lo consuma igual sin
// importar el canal.
//
// Publicaciones SIN variaciones → una fila (external_id = external_product_id = item id).
// Publicaciones CON variaciones → una fila por variación (external_id = variation id,
// external_product_id = item id) — la actualización de stock de una variación
// necesita los dos ids (PUT /items/{item_id}/variations/{variation_id}).
//
// API: https://api.mercadolibre.com
//   - Listado de ids: /users/{seller_id}/items/search con search_type=scan + scroll_id,
//     evita el tope clásico de offset+limit<=1000 de la paginación normal.
//   - Detalle: /items?ids=... (multiget, máx 20 ids por llamada).
//   - Token: usa obtenerTokenValido (no leerTokenCanal) porque el access token
//     de MELI expira a las 6h — hay que renovarlo si está por vencer.

const ML_API_BASE = 'https://api.mercadolibre.com';
const SCAN_LIMIT = 100;
const MULTIGET_BATCH = 20;
const MAX_ITERACIONES = 100; // tope duro anti-loop (100 * 100 = 10.000 publicaciones)

interface VariantePlana {
  external_id: string;
  external_product_id: string;
  external_sku: string | null;
  nombre: string;
  stock: number | null;
}

// MercadoLibre guarda el SKU del vendedor en dos lugares según cómo se cargó la
// publicación: el campo legacy `seller_custom_field`, o como un atributo con
// id 'SELLER_SKU' dentro de `attributes` (publicaciones más nuevas). Buscamos en
// ambos — item y variación tienen la misma forma. Sin esto, el auto-match por SKU
// del modal de mapeo no encuentra nada en publicaciones nuevas.
function extraerSku(obj: Record<string, unknown>): string | null {
  const legacy = obj?.seller_custom_field;
  if (typeof legacy === 'string' && legacy.trim()) return legacy;

  const attrs = Array.isArray(obj?.attributes) ? obj.attributes : [];
  const skuAttr = attrs.find((a: Record<string, unknown>) => a?.id === 'SELLER_SKU');
  const val = skuAttr?.value_name;
  return typeof val === 'string' && val.trim() ? val : null;
}

function sufijoVariacion(combinaciones: unknown): string {
  if (!Array.isArray(combinaciones)) return '';
  const partes = combinaciones
    .map((c: Record<string, unknown>) => c?.value_name)
    .filter((v): v is string => typeof v === 'string');
  return partes.length ? ` — ${partes.join(' / ')}` : '';
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405, req);

  const auth = await verifyAdmin(req);
  if (!auth.ok) return errorResponse(auth.error!, 401, req);

  const { data: integracion } = await adminClient
    .from('integraciones_canales')
    .select('external_store_id')
    .eq('empresa_id', auth.empresaId!)
    .eq('canal', 'mercadolibre')
    .eq('activo', true)
    .maybeSingle();
  if (!integracion?.external_store_id) {
    return errorResponse('No hay una cuenta de MercadoLibre conectada', 400, req);
  }

  const token = await obtenerTokenValido(auth.empresaId!, 'mercadolibre');
  if (!token) {
    return errorResponse('No se encontró el token de MercadoLibre (reconectá la integración)', 400, req);
  }

  const sellerId = integracion.external_store_id;
  const headers = { Authorization: `Bearer ${token}` };
  const itemIds: string[] = [];

  try {
    let scrollId: string | null = null;
    for (let i = 0; i < MAX_ITERACIONES; i++) {
      const params = new URLSearchParams({ search_type: 'scan', limit: String(SCAN_LIMIT) });
      if (scrollId) params.set('scroll_id', scrollId);

      const res = await fetch(`${ML_API_BASE}/users/${sellerId}/items/search?${params}`, { headers });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[mercadolibre-catalogo] search API ${res.status}:`, body);
        return errorResponse(`MercadoLibre respondió ${res.status}`, 502, req);
      }

      const data = await res.json();
      const results: string[] = Array.isArray(data.results) ? data.results : [];
      if (results.length === 0) break;

      itemIds.push(...results);
      scrollId = data.scroll_id ?? null;
      if (!scrollId || results.length < SCAN_LIMIT) break;
    }
  } catch (e) {
    console.error('[mercadolibre-catalogo] Error listando publicaciones:', e);
    return errorResponse('No se pudo leer el catálogo de MercadoLibre', 502, req);
  }

  const variantes: VariantePlana[] = [];

  try {
    for (let i = 0; i < itemIds.length; i += MULTIGET_BATCH) {
      const lote = itemIds.slice(i, i + MULTIGET_BATCH);
      const res = await fetch(
        `${ML_API_BASE}/items?ids=${lote.join(',')}&attributes=id,title,available_quantity,variations,seller_custom_field,attributes`,
        { headers },
      );
      if (!res.ok) {
        const body = await res.text();
        console.error(`[mercadolibre-catalogo] multiget API ${res.status}:`, body);
        return errorResponse(`MercadoLibre respondió ${res.status}`, 502, req);
      }

      const lista = await res.json();
      for (const entry of Array.isArray(lista) ? lista : []) {
        if (entry.code !== 200 || !entry.body) continue;
        const item = entry.body;
        const variaciones = Array.isArray(item.variations) ? item.variations : [];
        const skuItem = extraerSku(item);

        if (variaciones.length === 0) {
          variantes.push({
            external_id: String(item.id),
            external_product_id: String(item.id),
            external_sku: skuItem,
            nombre: item.title ?? '(sin nombre)',
            stock: typeof item.available_quantity === 'number' ? item.available_quantity : null,
          });
        } else {
          for (const v of variaciones) {
            variantes.push({
              external_id: String(v.id),
              external_product_id: String(item.id),
              external_sku: extraerSku(v) ?? skuItem,
              nombre: (item.title ?? '(sin nombre)') + sufijoVariacion(v.attribute_combinations),
              stock: typeof v.available_quantity === 'number' ? v.available_quantity : null,
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('[mercadolibre-catalogo] Error consultando detalle de publicaciones:', e);
    return errorResponse('No se pudo leer el detalle del catálogo de MercadoLibre', 502, req);
  }

  return okResponse({ variantes }, req);
});
