-- migration 271 — usar_caea_para_comprobante: respeta clase de documento
--
-- Mismo bug de fondo que el arreglado hoy en voucherTypeAfip (_shared/afip.ts,
-- sesión 2026-07-29): v_tipo_cbte solo miraba la letra (A/B/C) y siempre
-- devolvía el código de Factura (1/6/11) — nunca contemplaba
-- comprobantes.tipo. Si algún día se usa CAEA para autorizar manualmente una
-- NC o ND trabada (botón "Usar CAEA" en el Monitor de Facturación AFIP, o el
-- arca-worker como service_role vía mig.225), se declararía ante ARCA como
-- Factura. Repo-only / afip_usa_caea=false para todas las empresas reales
-- hoy — sin impacto en producción, se cierra el gap ahora que se encontró
-- de nuevo, no por incidente en vivo.
--
-- Segundo hallazgo al investigar (verificado contra el manual del
-- desarrollador WSFE y documentación pública de AFIP): el CAEA NO es por
-- tipo de comprobante — la AFIP entrega UN SOLO código por CUIT+quincena,
-- válido para Factura/NC/ND de cualquier letra en cualquier punto de venta.
-- `usar_caea_en_venta` (mig.103) ya es agnóstico al tipo (solo valida
-- empresa+estado+vigencia), pero este RPC filtraba el lookup de
-- caea_registros por `tipo_cbte = v_tipo_cbte` — con eso, una empresa que
-- pidió su único CAEA bajo el código de Factura (6/B, lo único que pide
-- solicitar-caea) jamás iba a encontrarlo al intentar autorizar una NC/ND
-- con ese mismo CAEA, aunque sea perfectamente válido para eso. Se saca el
-- filtro por tipo del lookup.
--
-- Copia fiel del resto de la función, incluido el bypass service_role de
-- mig.225 (necesario para que el arca-worker automático la siga pudiendo
-- llamar sin usuario logueado) — solo se tocan las dos partes de arriba.

CREATE OR REPLACE FUNCTION public.usar_caea_para_comprobante(p_comprobante_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id       uuid;
  v_estado_actual     text;
  v_tipo_afip         text;   -- 'A' | 'B' | 'C'
  v_clase_doc         text;   -- 'venta' | 'nota_credito' | 'nota_debito'
  v_tipo_cbte         integer;
  v_total             numeric;
  v_neto               numeric;
  v_iva                numeric;
  v_fecha              date;
  v_cliente_id         uuid;
  v_documento          text;
  v_doc_digits         text;
  v_doc_tipo           integer;
  v_doc_nro            text;
  v_caea_registro_id   uuid;
  v_caea               varchar(14);
  v_fecha_hasta        date;
  v_nro_cbte           integer;
  v_fila_cola_id       uuid;
BEGIN
  SELECT empresa_id, cae_estado, tipo_comprobante_afip, total, neto_gravado,
         iva_discriminado, fecha::date, cliente_id, tipo
    INTO v_empresa_id, v_estado_actual, v_tipo_afip, v_total, v_neto,
         v_iva, v_fecha, v_cliente_id, v_clase_doc
    FROM public.comprobantes
   WHERE id = p_comprobante_id;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado: comprobante no encontrado';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: comprobante no encontrado o de otra empresa';
    END IF;
    IF NOT has_module_permission('ventas') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
    END IF;
  END IF;
  IF v_estado_actual NOT IN ('error', 'error_definitivo') THEN
    RAISE EXCEPTION 'El comprobante no está en error (estado actual: %). Solo se puede usar CAEA sobre un comprobante en error o error_definitivo.', v_estado_actual;
  END IF;

  -- Código AFIP según letra + clase de documento (igual tabla que voucherTypeAfip
  -- en _shared/afip.ts: venta A/B/C=1/6/11, nota_credito=3/8/13, nota_debito=2/7/12).
  v_tipo_cbte := CASE COALESCE(v_clase_doc, 'venta')
    WHEN 'nota_credito' THEN CASE COALESCE(v_tipo_afip, 'B') WHEN 'A' THEN 3 WHEN 'C' THEN 13 ELSE 8 END
    WHEN 'nota_debito'  THEN CASE COALESCE(v_tipo_afip, 'B') WHEN 'A' THEN 2 WHEN 'C' THEN 12 ELSE 7 END
    ELSE                     CASE COALESCE(v_tipo_afip, 'B') WHEN 'A' THEN 1 WHEN 'C' THEN 11 ELSE 6 END
  END;

  -- ── CAEA vigente de la empresa, con lock de numeración ───────────────────
  -- Sin filtro por tipo_cbte: un CAEA cubre Factura/NC/ND de cualquier letra
  -- (ver nota arriba) — el tipo real de ESTE comprobante ya quedó resuelto
  -- en v_tipo_cbte y es lo que se declara al usarlo y al informarlo después.
  SELECT id, caea, fecha_hasta
    INTO v_caea_registro_id, v_caea, v_fecha_hasta
    FROM public.caea_registros
   WHERE empresa_id = v_empresa_id
     AND estado      = 'activo'
     AND fecha_hasta >= CURRENT_DATE
   ORDER BY fecha_hasta DESC
   LIMIT 1
   FOR UPDATE;

  IF v_caea_registro_id IS NULL THEN
    RAISE EXCEPTION 'No hay un CAEA vigente para esta empresa. Solicitalo primero desde Configuración → Facturación.';
  END IF;

  -- Próximo número dentro de este CAEA (mismo patrón de lock que obtener_proximo_numero).
  SELECT comprobantes_emitidos + 1 INTO v_nro_cbte
    FROM public.caea_registros WHERE id = v_caea_registro_id;

  -- ── Documento del receptor (mismo mapeo que docTipoAfip en el edge function) ──
  v_documento := NULL;
  IF v_cliente_id IS NOT NULL THEN
    SELECT documento INTO v_documento FROM public.clientes WHERE id = v_cliente_id;
  END IF;
  v_doc_digits := regexp_replace(COALESCE(v_documento, ''), '\D', '', 'g');
  IF length(v_doc_digits) = 11 THEN
    v_doc_tipo := 80; v_doc_nro := v_doc_digits;              -- CUIT
  ELSIF length(v_doc_digits) BETWEEN 7 AND 8 THEN
    v_doc_tipo := 96; v_doc_nro := v_doc_digits;              -- DNI
  ELSE
    v_doc_tipo := 99; v_doc_nro := '0';                        -- Consumidor Final
  END IF;

  -- ── Delegar en usar_caea_en_venta (mig.103/104/225) con el número ya reservado ──
  PERFORM public.usar_caea_en_venta(
    v_empresa_id,
    p_comprobante_id,
    v_caea_registro_id,
    v_tipo_cbte,
    v_nro_cbte,
    v_fecha,
    v_doc_tipo,
    v_doc_nro,
    COALESCE(v_total, 0),
    COALESCE(v_neto, v_total, 0),
    COALESCE(v_iva, 0)
  );

  -- ── Cerrar la cola de CAE — el worker ya no debe tocar este comprobante ──
  -- Mismo criterio que marcar_cae_resuelto_manual: solo la fila más reciente.
  SELECT id INTO v_fila_cola_id
    FROM public.facturas_pendientes_arca
   WHERE comprobante_id = p_comprobante_id
   ORDER BY created_at DESC LIMIT 1
   FOR UPDATE;

  IF v_fila_cola_id IS NOT NULL THEN
    UPDATE public.facturas_pendientes_arca
       SET estado = 'emitida', error_mensaje = NULL, updated_at = now()
     WHERE id = v_fila_cola_id;
  END IF;

  RETURN jsonb_build_object(
    'caea', v_caea,
    'nro_cbte', v_nro_cbte,
    'fecha_hasta', v_fecha_hasta
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.usar_caea_para_comprobante(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usar_caea_para_comprobante(uuid) TO authenticated;

-- ROLLBACK (comentado): recrear la función con el cuerpo de mig.225
-- (v_tipo_cbte solo por letra, lookup de caea_registros con filtro tipo_cbte,
-- sin SELECT de comprobantes.tipo).
