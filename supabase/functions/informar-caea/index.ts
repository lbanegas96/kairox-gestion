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
 *   3a. Si hay comprobantes pendientes → agrupar por (tipo_cbte, punto_venta)
 *       y por cada grupo → FECAEAInformarComprobante (batch de 250)
 *   3b. Si no hay comprobantes → FECAEASinMovimiento
 *   4. Actualizar estados en DB
 *   5. Retornar resumen
 *
 * Restricciones AFIP:
 *   - Solo se puede informar entre el último día de la quincena y fecha_tope_inf
 *   - Una vez informado no se puede re-informar (AFIP error 15006)
 *   - Máximo 250 comprobantes por llamada a FECAEAInformarComprobante
 *   - CbteTipo y PtoVta son header del request: un batch solo puede contener
 *     comprobantes que compartan ambos (de ahí el agrupamiento del paso 3a)
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
      // ── 3a. Informar comprobantes ──────────────────────────────────────
      // Se agrupa por (tipo_cbte, punto_venta) ANTES de batchear: ambos van
      // en el header del request de FECAEAInformarComprobante, así que un
      // lote solo puede contener comprobantes que compartan los dos.
      //
      // Antes se usaba `registro.tipo_cbte` para TODOS los pendientes — y ese
      // es el tipo con el que se PIDIÓ el CAEA, que `solicitar-caea` siempre
      // pide como Factura. Con eso, una NC/ND autorizada por CAEA se informaba
      // a AFIP declarada como Factura: la misma familia de bug que se arregló
      // en voucherTypeAfip (_shared/afip.ts) y en usar_caea_para_comprobante
      // (mig. 271). El tipo correcto de cada comprobante ya está guardado por
      // fila en caea_comprobantes.tipo_cbte (lo escribe usar_caea_en_venta) —
      // es lo que hay que usar acá.
      const grupos = new Map<string, NonNullable<typeof pendientes>>();
      for (const c of pendientes) {
        const clave = `${c.tipo_cbte}|${c.punto_venta}`;
        const grupo = grupos.get(clave);
        if (grupo) grupo.push(c);
        else grupos.set(clave, [c]);
      }

      for (const grupo of grupos.values()) {
        const tipoCbte   = grupo[0].tipo_cbte;
        const puntoVenta = grupo[0].punto_venta;

        for (let offset = 0; offset < grupo.length; offset += BATCH_SIZE) {
          const lote = grupo.slice(offset, offset + BATCH_SIZE);

          const items: CaeaComprobanteItem[] = lote.map((c) => {
            // Letra C (Factura 11, ND 12, NC 13) no discrimina IVA:
            // ImpNeto = ImpTotal, ImpIVA = 0, sin nodo Iva. Mismo criterio que
            // `esClaseC` en callArcaEmit (_shared/afip.ts) — antes acá se
            // miraba `registro.tipo_cbte === 11`, que además de leer el tipo
            // equivocado dejaba afuera NC-C y ND-C.
            const esClaseC = [11, 12, 13].includes(c.tipo_cbte);
            return {
              docTipo:   c.doc_tipo,
              docNro:    c.doc_nro,
              cbteDesde: c.nro_cbte_desde,
              cbteHasta: c.nro_cbte_hasta,
              cbteFch:   c.fecha_cbte.replace(/-/g, ''),  // YYYYMMDD
              impTotal:  Number(c.imp_total),
              impNeto:   esClaseC ? Number(c.imp_total) : Number(c.imp_neto),
              impIVA:    esClaseC ? 0 : Number(c.imp_iva),
              ivaId:     esClaseC ? null : (Number(c.imp_iva) > 0 ? 5 : 3),
            };
          });

          try {
            await feCAEAInformarComprobante(
              environment, wsfeAuth,
              registro.caea,
              puntoVenta,
              tipoCbte,
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
            errores.push(
              `Tipo ${tipoCbte} PV ${puntoVenta} lote ${offset}-${offset + lote.length}: ${msg}`,
            );

            // Marcar lote como error
            await adminClient
              .from('caea_comprobantes')
              .update({ estado_informado: 'error', error_mensaje: msg })
              .in('id', lote.map((c) => c.id));
          }
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
