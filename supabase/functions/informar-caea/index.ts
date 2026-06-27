/**
 * informar-caea — Edge Function para informar a AFIP los comprobantes emitidos
 * offline con un CAEA, o declarar SinMovimiento si no hubo ninguno.
 *
 * POST { empresa_id: string, caea_registro_id: string }
 *   → { informados: number, sin_movimiento: boolean, errores: string[] }
 *
 * Flujo:
 *   1. Verificar auth (admin de la empresa)
 *   2. Cargar el registro CAEA y los comprobantes pendientes
 *   3a. Si hay comprobantes pendientes → FECAEAInformarComprobante (batch)
 *   3b. Si no hay comprobantes → FECAEASinMovimiento
 *   4. Actualizar estados en DB
 *   5. Retornar resumen
 *
 * Restricciones AFIP:
 *   - Solo se puede informar entre el último día de la quincena y fecha_tope_inf
 *   - Una vez informado no se puede re-informar (AFIP error 15006)
 *   - Máximo 250 comprobantes por llamada a FECAEAInformarComprobante
 */

import { adminClient, buildCorsHeaders, errorResponse, okResponse, verifyAdmin } from '../_shared/auth.ts';
import { getValidTA } from '../_shared/wsaa.ts';
import {
  feCAEAInformarComprobante,
  feCAEASinMovimiento,
  type CaeaComprobanteItem,
} from '../_shared/wsfe.ts';

const BATCH_SIZE = 250; // límite AFIP por llamada

Deno.serve(async (req: Request) => {
  const cors = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await verifyAdmin(req);
  if (!auth.ok) return errorResponse(auth.error ?? 'No autorizado', 401, req);

  const { empresa_id, caea_registro_id } = await req.json().catch(() => ({}));
  if (!empresa_id || !caea_registro_id) {
    return errorResponse('empresa_id y caea_registro_id requeridos', 400, req);
  }

  if (auth.empresaId !== empresa_id) {
    return errorResponse('No autorizado para esta empresa', 403, req);
  }

  try {
    // ── Cargar registro CAEA ──────────────────────────────────────────────
    const { data: registro, error: regErr } = await adminClient
      .from('caea_registros')
      .select('*')
      .eq('id', caea_registro_id)
      .eq('empresa_id', empresa_id)
      .single();

    if (regErr || !registro) return errorResponse('Registro CAEA no encontrado', 404, req);
    if (registro.estado === 'informado') {
      return errorResponse('Este CAEA ya fue informado a AFIP', 400, req);
    }

    // ── Cargar config AFIP ────────────────────────────────────────────────
    const { data: empresa } = await adminClient
      .from('empresas')
      .select('afip_cuit, afip_ambiente')
      .eq('id', empresa_id)
      .single();

    if (!empresa?.afip_cuit) return errorResponse('CUIT AFIP no configurado', 400, req);

    const environment: 'production' | 'sandbox' =
      empresa.afip_ambiente === 'production' ? 'production' : 'sandbox';

    const { data: certPem } = await adminClient.rpc('vault_secret_read', {
      p_name: `afip_cert_${empresa_id}`,
    });
    const { data: keyPem } = await adminClient.rpc('vault_secret_read', {
      p_name: `afip_key_${empresa_id}`,
    });
    if (!certPem || !keyPem) return errorResponse('Certificados AFIP no configurados', 400, req);

    const ta = await getValidTA(adminClient, empresa_id, environment, certPem, keyPem);
    const wsfeAuth = { token: ta.token, sign: ta.sign, cuit: empresa.afip_cuit };

    // ── Comprobantes pendientes ───────────────────────────────────────────
    const { data: pendientes } = await adminClient
      .from('caea_comprobantes')
      .select('*')
      .eq('caea_registro_id', caea_registro_id)
      .eq('empresa_id', empresa_id)
      .eq('estado_informado', 'pendiente')
      .order('nro_cbte_desde');

    const errores: string[] = [];
    let informados = 0;

    if (!pendientes?.length) {
      // ── 3b. SinMovimiento ──────────────────────────────────────────────
      try {
        await feCAEASinMovimiento(
          environment, wsfeAuth,
          registro.caea,
          registro.punto_venta,
          registro.tipo_cbte,
        );
      } catch (err) {
        return errorResponse('Error en FECAEASinMovimiento: ' + (err as Error).message, 500, req);
      }

    } else {
      // ── 3a. Informar comprobantes (batch de 250) ───────────────────────
      for (let offset = 0; offset < pendientes.length; offset += BATCH_SIZE) {
        const lote = pendientes.slice(offset, offset + BATCH_SIZE);

        const items: CaeaComprobanteItem[] = lote.map((c) => ({
          docTipo:   c.doc_tipo,
          docNro:    c.doc_nro,
          cbteDesde: c.nro_cbte_desde,
          cbteHasta: c.nro_cbte_hasta,
          cbteFch:   c.fecha_cbte.replace(/-/g, ''),  // YYYYMMDD
          impTotal:  Number(c.imp_total),
          impNeto:   Number(c.imp_neto),
          impIVA:    Number(c.imp_iva),
          // Factura C no discrimina IVA
          ivaId:     registro.tipo_cbte === 11 ? null : (Number(c.imp_iva) > 0 ? 5 : 3),
        }));

        try {
          await feCAEAInformarComprobante(
            environment, wsfeAuth,
            registro.caea,
            registro.punto_venta,
            registro.tipo_cbte,
            items,
          );

          // Marcar lote como informado
          await adminClient
            .from('caea_comprobantes')
            .update({ estado_informado: 'informado' })
            .in('id', lote.map((c) => c.id));

          informados += lote.length;

        } catch (err) {
          const msg = (err as Error).message;
          errores.push(`Lote ${offset}-${offset + lote.length}: ${msg}`);

          // Marcar lote como error
          await adminClient
            .from('caea_comprobantes')
            .update({ estado_informado: 'error', error_mensaje: msg })
            .in('id', lote.map((c) => c.id));
        }
      }
    }

    // ── Actualizar estado del registro CAEA ───────────────────────────────
    const nuevoEstado = errores.length === 0 ? 'informado' : 'activo'; // reintentable si hubo errores
    await adminClient
      .from('caea_registros')
      .update({ estado: nuevoEstado, updated_at: new Date().toISOString() })
      .eq('id', caea_registro_id);

    return okResponse({
      informados,
      sin_movimiento: !pendientes?.length,
      errores,
    }, req);

  } catch (err) {
    console.error('[informar-caea]', (err as Error).message);
    return errorResponse((err as Error).message, 500, req);
  }
});
