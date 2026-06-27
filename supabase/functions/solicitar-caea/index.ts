/**
 * solicitar-caea — Edge Function para obtener el CAEA de la quincena.
 *
 * POST { empresa_id: string }
 *   → { caea, periodo, orden, fecha_desde, fecha_hasta, fecha_tope_inf }
 *
 * Flujo:
 *   1. Verificar auth (admin de la empresa)
 *   2. Cargar config AFIP + certificados del vault
 *   3. Calcular qué quincena solicitar según la fecha actual ARS (-03:00)
 *   4. FECAEASolicitar en WSFE
 *   5. Upsert en caea_registros (idempotente: un CAEA por empresa+periodo+orden+tipo+pv)
 *   6. Retornar datos del CAEA
 *
 * Errores AFIP relevantes:
 *   - 15008: "No existe CAEA para el período" → aún no está habilitado (muy temprano)
 *   - 15004: CAEA ya solicitado → devolver el existente consultando FECAEAConsultar
 */

import { adminClient, buildCorsHeaders, errorResponse, okResponse, verifyAdmin } from '../_shared/auth.ts';
import { getValidTA } from '../_shared/wsaa.ts';
import { feCAEASolicitar, feCAEAConsultar } from '../_shared/wsfe.ts';
import { voucherTypeAfip } from '../_shared/afip.ts';

/** Fecha actual en zona AR (UTC-3). */
function nowAR(): Date {
  return new Date(Date.now() - 3 * 60 * 60 * 1000);
}

/**
 * Determina qué quincena solicitar según el día del mes en ARS.
 *
 * Reglas AFIP:
 *   Día 12-26: solicitar 2da quincena del mes actual
 *   Día 27-31: solicitar 1ra quincena del mes siguiente
 *   Día 1-11 : dentro de la 1ra quincena vigente; solicitar la actual
 *              (AFIP retorna 15008 si la quincena no está habilitada aún)
 */
function calcularQuincena(date: Date): { periodo: string; orden: 1 | 2; fechaDesde: Date; fechaHasta: Date } {
  const year  = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;  // 1-12
  const day   = date.getUTCDate();

  let tgtYear  = year;
  let tgtMonth = month;
  let orden: 1 | 2;
  let diaDesde: number;
  let diaHasta: number;

  if (day >= 27) {
    // Solicitar 1ra quincena del mes siguiente
    tgtMonth = month === 12 ? 1 : month + 1;
    tgtYear  = month === 12 ? year + 1 : year;
    orden    = 1;
    diaDesde = 1;
    diaHasta = 15;
  } else if (day >= 12) {
    // Solicitar 2da quincena del mes actual
    orden    = 2;
    diaDesde = 16;
    // Último día del mes
    diaHasta = new Date(year, month, 0).getUTCDate();
  } else {
    // Dentro de la 1ra quincena (aún vigente)
    orden    = 1;
    diaDesde = 1;
    diaHasta = 15;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  const periodo   = `${tgtYear}${pad(tgtMonth)}`;
  const fechaDesde = new Date(`${tgtYear}-${pad(tgtMonth)}-${pad(diaDesde)}`);
  const fechaHasta = new Date(`${tgtYear}-${pad(tgtMonth)}-${pad(diaHasta)}`);

  return { periodo, orden, fechaDesde, fechaHasta };
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

  // Solo el admin de la empresa puede solicitar su propio CAEA
  if (auth.empresaId !== empresa_id) {
    return errorResponse('No autorizado para esta empresa', 403, req);
  }

  try {
    // ── Cargar config AFIP ────────────────────────────────────────────────
    const { data: empresa, error: empErr } = await adminClient
      .from('empresas')
      .select('afip_cuit, afip_pv_numero, afip_ambiente, afip_usa_caea, condicion_iva')
      .eq('id', empresa_id)
      .single();

    if (empErr || !empresa) return errorResponse('Empresa no encontrada', 404, req);
    if (!empresa.afip_usa_caea) return errorResponse('CAEA no habilitado para esta empresa', 400, req);
    if (!empresa.afip_cuit)     return errorResponse('CUIT AFIP no configurado', 400, req);
    if (!empresa.afip_pv_numero) return errorResponse('Punto de venta AFIP no configurado', 400, req);

    const environment: 'production' | 'sandbox' =
      empresa.afip_ambiente === 'production' ? 'production' : 'sandbox';

    // ── Certificados del vault ────────────────────────────────────────────
    const { data: certPem } = await adminClient.rpc('vault_secret_read', {
      p_name: `afip_cert_${empresa_id}`,
    });
    const { data: keyPem } = await adminClient.rpc('vault_secret_read', {
      p_name: `afip_key_${empresa_id}`,
    });
    if (!certPem || !keyPem) return errorResponse('Certificados AFIP no configurados', 400, req);

    // ── TA WSAA ───────────────────────────────────────────────────────────
    const ta = await getValidTA(adminClient, empresa_id, environment, certPem, keyPem);
    const wsfeAuth = { token: ta.token, sign: ta.sign, cuit: empresa.afip_cuit };

    // ── Determinar quincena + tipo de comprobante ──────────────────────────
    const { periodo, orden, fechaDesde, fechaHasta } = calcularQuincena(nowAR());

    // Tipo de comprobante: derivado de condicion_iva (C para no inscriptos)
    const condIva = empresa.condicion_iva ?? 'Responsable Inscripto';
    const tipoLabel = condIva.toLowerCase().includes('monotributo') ||
                      condIva.toLowerCase().includes('exento') ||
                      condIva.toLowerCase().includes('consumidor')
      ? 'C' : 'B';
    const cbteTipo = voucherTypeAfip(tipoLabel);
    const pvNumero = empresa.afip_pv_numero as number;

    // ── Solicitar CAEA ────────────────────────────────────────────────────
    let caeaResult;
    try {
      caeaResult = await feCAEASolicitar(environment, wsfeAuth, pvNumero, cbteTipo);
    } catch (err) {
      const msg = (err as Error).message;
      // Error 15004 = ya fue solicitado → consultar el existente
      if (msg.includes('15004')) {
        const existente = await feCAEAConsultar(environment, wsfeAuth, periodo, orden);
        if (!existente) return errorResponse('CAEA ya solicitado pero no se pudo consultar', 500, req);
        caeaResult = existente;
      } else if (msg.includes('15008')) {
        return errorResponse(
          'El CAEA para esta quincena aún no está habilitado por AFIP. ' +
          'Se puede solicitar la 2da quincena a partir del día 12, ' +
          'y la 1ra del mes siguiente a partir del día 27.',
          400,
          req
        );
      } else {
        throw err;
      }
    }

    // ── Persistir en caea_registros (upsert idempotente) ─────────────────
    const { data: registro, error: upsertErr } = await adminClient
      .from('caea_registros')
      .upsert(
        {
          empresa_id,
          caea:          caeaResult.caea,
          periodo:       caeaResult.periodo || periodo,
          orden:         caeaResult.orden   || orden,
          fecha_desde:   caeaResult.fechaDesde  || fechaDesde.toISOString().slice(0, 10),
          fecha_hasta:   caeaResult.fechaHasta  || fechaHasta.toISOString().slice(0, 10),
          fecha_proceso: caeaResult.fechaProceso || new Date().toISOString().slice(0, 10),
          fecha_tope_inf: caeaResult.fechaTopeInf || null,
          tipo_cbte:     cbteTipo,
          punto_venta:   pvNumero,
          estado:        'activo',
          updated_at:    new Date().toISOString(),
        },
        { onConflict: 'empresa_id,periodo,orden,tipo_cbte,punto_venta' }
      )
      .select()
      .single();

    if (upsertErr) {
      console.error('[solicitar-caea] upsert error:', upsertErr.message);
      return errorResponse('Error guardando CAEA: ' + upsertErr.message, 500, req);
    }

    return okResponse({
      caea:          caeaResult.caea,
      periodo:       registro?.periodo,
      orden:         registro?.orden,
      fecha_desde:   registro?.fecha_desde,
      fecha_hasta:   registro?.fecha_hasta,
      fecha_tope_inf: registro?.fecha_tope_inf,
      registro_id:   registro?.id,
    }, req);

  } catch (err) {
    console.error('[solicitar-caea]', (err as Error).message);
    return errorResponse((err as Error).message, 500, req);
  }
});
