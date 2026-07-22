import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyAdmin, adminClient, buildCorsHeaders, errorResponse, okResponse } from '../_shared/auth.ts';
import { leerTokenCanal } from '../_shared/integraciones.ts';

// Trae el catálogo de productos de la tienda Tiendanube conectada, aplanado a
// una variante por fila (id de variante + sku + stock + nombre del producto),
// para que MapeoProductosModal pueda auto-sugerir el match contra productos.codigo_barras
// / codigo_sku en vez de que el usuario pegue el id a mano.
//
// El id que nos importa para el mapeo es el de la VARIANTE, no el del producto:
// Tiendanube maneja stock a nivel variante, así que un pedido referencia variantes.
//
// API: https://api.tiendanube.com/2025-03/{store_id}/products
//   - Authorization: Bearer <token>   (token guardado en Vault, canal tiendanube)
//   - User-Agent obligatorio (si falta → 400)
//   - Paginación: header Link rel="next" + x-total-count. Default 30/pág, pedimos 200.
//   - Rate limit leaky bucket 2 req/s — con per_page=200 y catálogos PyME alcanza
//     de sobra sin acercarse al límite.

const TN_API_BASE = 'https://api.tiendanube.com/2025-03';
const USER_AGENT = 'KAIROX Gestion (soporte@kairox.app)';
const PER_PAGE = 200;
const MAX_PAGINAS = 50; // tope duro anti-loop (50 * 200 = 10.000 variantes)

interface VariantePlana {
  external_id: string;      // id de la variante en Tiendanube
  external_sku: string | null;
  nombre: string;           // nombre del producto (+ atributos de la variante si aplica)
  stock: number | null;
}

function nombreProducto(name: unknown): string {
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object') {
    const vals = Object.values(name as Record<string, unknown>).filter(v => typeof v === 'string');
    if (vals.length) return vals[0] as string;
  }
  return '(sin nombre)';
}

function sufijoVariante(values: unknown): string {
  if (!Array.isArray(values)) return '';
  const partes = values
    .map(v => (v && typeof v === 'object' ? Object.values(v as Record<string, unknown>)[0] : null))
    .filter(x => typeof x === 'string');
  return partes.length ? ` — ${partes.join(' / ')}` : '';
}

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405, req);

  const auth = await verifyAdmin(req);
  if (!auth.ok) return errorResponse(auth.error!, 401, req);

  // Store id + token de la integración de ESTA empresa
  const { data: integracion } = await adminClient
    .from('integraciones_canales')
    .select('external_store_id')
    .eq('empresa_id', auth.empresaId!)
    .eq('canal', 'tiendanube')
    .eq('activo', true)
    .maybeSingle();
  if (!integracion?.external_store_id) {
    return errorResponse('No hay una tienda de Tiendanube conectada', 400, req);
  }

  const token = await leerTokenCanal(auth.empresaId!, 'tiendanube');
  if (!token) {
    return errorResponse('No se encontró el token de Tiendanube (reconectá la integración)', 400, req);
  }

  const storeId = integracion.external_store_id;
  const variantes: VariantePlana[] = [];

  try {
    for (let page = 1; page <= MAX_PAGINAS; page++) {
      const res = await fetch(
        `${TN_API_BASE}/${storeId}/products?page=${page}&per_page=${PER_PAGE}&fields=id,name,variants`,
        { headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT } },
      );

      if (res.status === 404) break; // sin más páginas
      if (!res.ok) {
        const body = await res.text();
        console.error(`[tiendanube-catalogo] API ${res.status}:`, body);
        return errorResponse(`Tiendanube respondió ${res.status}`, 502, req);
      }

      const productos = await res.json();
      if (!Array.isArray(productos) || productos.length === 0) break;

      for (const p of productos) {
        const nombreBase = nombreProducto(p.name);
        for (const v of p.variants ?? []) {
          variantes.push({
            external_id: String(v.id),
            external_sku: v.sku ?? null,
            nombre: nombreBase + sufijoVariante(v.values),
            stock: typeof v.stock === 'number' ? v.stock : null,
          });
        }
      }

      // Si vino menos de una página llena, no hay más
      if (productos.length < PER_PAGE) break;
    }
  } catch (e) {
    console.error('[tiendanube-catalogo] Error consultando la API:', e);
    return errorResponse('No se pudo leer el catálogo de Tiendanube', 502, req);
  }

  return okResponse({ variantes }, req);
});
