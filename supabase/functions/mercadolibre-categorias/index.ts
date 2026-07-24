import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyAdmin, buildCorsHeaders, errorResponse, okResponse } from '../_shared/auth.ts';
import { obtenerTokenValido } from '../_shared/integraciones.ts';

/**
 * Ayudante para el formulario de publicación a MercadoLibre (Fase 5/6). Modos:
 *
 *   { action: 'predict', q }        → predictor de categorías desde el nombre.
 *     GET /sites/MLA/domain_discovery/search?q=... → [{category_id, category_name, ...}]
 *     (endpoint público, no necesita token)
 *
 *   { action: 'attributes', category_id } → atributos de la categoría, marcando
 *     cuáles son obligatorios para publicar.
 *     GET /categories/{id}/attributes → [{id, name, tags, values, value_type}]
 *     (endpoint público, no necesita token)
 *
 *   { action: 'catalog_search', category_id, q } → busca fichas del catálogo
 *     oficial de MELI (Fase 6 — ver CONTEXT.md: la mayoría de las categorías
 *     reales exigen enganchar la publicación a una de estas fichas, no dejan
 *     crear un ítem libre). GET /products/search?category_id=...&q=...
 *     (requiere token del vendedor — a diferencia de predict/attributes).
 *
 * Se hace del lado del servidor (en vez de pegarle a MELI desde el browser) para
 * evitar CORS y centralizar el site (MLA = Argentina). verify_jwt=true + verifyAdmin:
 * es una herramienta de la UI del admin, no un webhook.
 */
const ML_API_BASE = 'https://api.mercadolibre.com';
const SITE_ID = 'MLA'; // Argentina

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405, req);

  const auth = await verifyAdmin(req);
  if (!auth.ok) return errorResponse(auth.error!, 401, req);

  let body: { action?: string; q?: string; category_id?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('Body inválido', 400, req);
  }

  try {
    // ── Predictor de categorías desde el nombre del producto ────────────────
    if (body.action === 'predict') {
      const q = (body.q ?? '').trim();
      if (!q) return okResponse({ categorias: [] }, req);

      const res = await fetch(
        `${ML_API_BASE}/sites/${SITE_ID}/domain_discovery/search?limit=8&q=${encodeURIComponent(q)}`,
      );
      if (!res.ok) {
        console.error('[mercadolibre-categorias] predict API', res.status, await res.text());
        return errorResponse('No se pudo predecir la categoría', 502, req);
      }
      const data = await res.json();
      const categorias = (Array.isArray(data) ? data : []).map((c: Record<string, unknown>) => ({
        category_id: c.category_id,
        category_name: c.category_name,
      })).filter((c: { category_id?: unknown }) => c.category_id);
      return okResponse({ categorias }, req);
    }

    // ── Atributos de una categoría (para armar el formulario) ────────────────
    if (body.action === 'attributes') {
      const categoryId = (body.category_id ?? '').trim();
      if (!categoryId) return errorResponse('Falta category_id', 400, req);

      const res = await fetch(`${ML_API_BASE}/categories/${categoryId}/attributes`);
      if (!res.ok) {
        console.error('[mercadolibre-categorias] attributes API', res.status, await res.text());
        return errorResponse('No se pudieron leer los atributos de la categoría', 502, req);
      }
      const data = await res.json();

      // Nos quedamos con los relevantes para el formulario: obligatorios para
      // publicar (tags.required) + los "catalog required" comunes (marca/modelo).
      // Devolvemos también los valores permitidos si es una lista cerrada, para
      // mostrar un dropdown en vez de texto libre.
      const atributos = (Array.isArray(data) ? data : [])
        .map((a: Record<string, unknown>) => {
          const tags = (a.tags ?? {}) as Record<string, unknown>;
          const obligatorio = tags.required === true || tags.catalog_required === true;
          const valores = Array.isArray(a.values)
            ? (a.values as Array<Record<string, unknown>>).map(v => ({ id: v.id, name: v.name }))
            : [];
          return {
            id: a.id,
            name: a.name,
            obligatorio,
            value_type: a.value_type,      // string / number / list / boolean ...
            valores,                        // valores predefinidos (dropdown) si los hay
            // Si tiene valores predefinidos → dropdown; si no → texto libre.
            usa_dropdown: valores.length > 0,
          };
        })
        // Priorizar obligatorios primero; limitar para no abrumar el formulario.
        .sort((a: { obligatorio: boolean }, b: { obligatorio: boolean }) => Number(b.obligatorio) - Number(a.obligatorio));

      return okResponse({ atributos }, req);
    }

    // ── Búsqueda en el catálogo oficial de MELI (Fase 6) ─────────────────────
    if (body.action === 'catalog_search') {
      const categoryId = (body.category_id ?? '').trim();
      const q = (body.q ?? '').trim();
      if (!categoryId || !q) return errorResponse('Falta category_id o q', 400, req);

      const token = await obtenerTokenValido(auth.empresaId!, 'mercadolibre');
      if (!token) return errorResponse('Sin token vigente de MercadoLibre — reconectá la integración', 401, req);

      const url = `${ML_API_BASE}/products/search?status=active&site_id=${SITE_ID}` +
        `&category_id=${encodeURIComponent(categoryId)}&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        console.error('[mercadolibre-categorias] catalog_search API', res.status, await res.text());
        return errorResponse('No se pudo buscar en el catálogo de MercadoLibre', 502, req);
      }
      const data = await res.json();
      const resultados = (Array.isArray(data?.results) ? data.results : []).map((p: Record<string, unknown>) => ({
        catalog_product_id: p.id,
        name: p.name,
        pictures: Array.isArray(p.pictures) ? (p.pictures as Array<Record<string, unknown>>).slice(0, 1).map(pic => pic.url) : [],
      }));
      return okResponse({ resultados }, req);
    }

    return errorResponse('action no soportada (predict | attributes | catalog_search)', 400, req);
  } catch (e) {
    console.error('[mercadolibre-categorias] Error inesperado:', e);
    return errorResponse('Error consultando MercadoLibre', 502, req);
  }
});
