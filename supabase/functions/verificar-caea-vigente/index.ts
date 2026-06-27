/**
 * verificar-caea-vigente — Edge Function liviana para que el POS consulte si
 * hay un CAEA activo disponible antes de intentar facturar offline.
 *
 * POST { empresa_id: string }
 *   → { tiene_caea: true,  caea, fecha_hasta, registro_id, tipo_cbte, punto_venta }
 *   → { tiene_caea: false }
 *
 * Esta función es intencionalmente solo-DB (sin llamada a AFIP) porque se invoca
 * exactamente cuando AFIP puede no estar disponible. Responde en <100ms.
 *
 * Semántica de "vigente": estado='activo' AND fecha_hasta >= TODAY (en zona AR).
 */

import { adminClient, buildCorsHeaders, errorResponse, okResponse, verifyAdmin } from '../_shared/auth.ts';

/** Fecha de hoy en zona ARS (UTC-3), como string YYYY-MM-DD. */
function todayAR(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await verifyAdmin(req);
  if (!auth.ok) return errorResponse(auth.error ?? 'No autorizado', 401, req);

  const { empresa_id } = await req.json().catch(() => ({}));
  if (!empresa_id) return errorResponse('empresa_id requerido', 400, req);

  if (auth.empresaId !== empresa_id) {
    return errorResponse('No autorizado para esta empresa', 403, req);
  }

  try {
    const today = todayAR();

    // Buscar el CAEA activo más reciente cuya vigencia no haya vencido.
    // Si hay varios tipos de comprobante, devolver el más específico
    // (el POS seleccionará el tipo según la condición IVA del cliente).
    const { data: registros, error } = await adminClient
      .from('caea_registros')
      .select('id, caea, fecha_hasta, fecha_tope_inf, tipo_cbte, punto_venta, periodo, orden, comprobantes_emitidos')
      .eq('empresa_id', empresa_id)
      .eq('estado', 'activo')
      .gte('fecha_hasta', today)
      .order('fecha_hasta', { ascending: false });

    if (error) {
      console.error('[verificar-caea-vigente]', error.message);
      return errorResponse('Error consultando CAEA: ' + error.message, 500, req);
    }

    if (!registros?.length) {
      return okResponse({ tiene_caea: false }, req);
    }

    // Devolver todos los CAEAs vigentes (puede haber uno por tipo A, B, C)
    // El frontend elige el correcto según el tipo de comprobante a emitir.
    const primero = registros[0];

    return okResponse({
      tiene_caea:            true,
      caea:                  primero.caea,
      fecha_hasta:           primero.fecha_hasta,
      fecha_tope_inf:        primero.fecha_tope_inf,
      registro_id:           primero.id,
      tipo_cbte:             primero.tipo_cbte,
      punto_venta:           primero.punto_venta,
      periodo:               primero.periodo,
      orden:                 primero.orden,
      comprobantes_emitidos: primero.comprobantes_emitidos,
      // Si hay múltiples CAEAs (por tipo), devolverlos todos
      todos:                 registros.map((r) => ({
        registro_id: r.id,
        caea:        r.caea,
        tipo_cbte:   r.tipo_cbte,
        punto_venta: r.punto_venta,
        fecha_hasta: r.fecha_hasta,
      })),
    }, req);

  } catch (err) {
    console.error('[verificar-caea-vigente]', (err as Error).message);
    return errorResponse((err as Error).message, 500, req);
  }
});
