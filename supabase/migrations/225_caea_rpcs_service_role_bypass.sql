-- migration 225 — Atajo service_role en las 2 RPCs de CAEA
--
-- CONTEXTO (plan de contingencia AFIP, sesión 79): hoy CAEA solo se puede usar
-- MANUALMENTE — un humano logueado entra al Monitor de Facturación AFIP y aprieta
-- "Usar CAEA" sobre un comprobante trabado en error. El objetivo del plan es que
-- el arca-worker (cron, corre sin usuario) pueda hacerlo solo tras varios fallos
-- de CAE, en vez de rendirse a error_definitivo esperando intervención humana.
--
-- BLOQUEO que esta migration resuelve: usar_caea_para_comprobante y su interna
-- usar_caea_en_venta exigen hoy `empresa_id = get_my_empresa_id()` +
-- `has_module_permission('ventas')` — ambos derivan del JWT de un usuario humano.
-- El worker corre como service_role (sin usuario), así que get_my_empresa_id()
-- es NULL y las 2 funciones abortan. Se agrega el MISMO patrón de bypass que ya
-- usan registrar_cobro_cliente / registrar_pago_proveedor / los triggers de GL:
--   IF auth.role() IS DISTINCT FROM 'service_role' THEN <checks de tenant/permiso> END IF;
--
-- Seguridad: el bypass NO debilita el camino del usuario humano (los checks
-- siguen intactos para cualquier rol que no sea service_role). service_role solo
-- lo tiene el backend (edge functions con la service_role key, nunca el
-- frontend), así que esto no abre ninguna superficie nueva desde el cliente.
-- auth.role() se lee del JWT y NO cambia por SECURITY DEFINER, así que cuando
-- usar_caea_para_comprobante (invocada por el worker como service_role) hace
-- PERFORM usar_caea_en_venta, la interna también ve service_role — por eso el
-- bypass va en las DOS.

-- ── 1. usar_caea_en_venta (la interna) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.usar_caea_en_venta(p_empresa_id uuid, p_comprobante_id uuid, p_caea_registro_id uuid, p_tipo_cbte integer, p_nro_cbte integer, p_fecha_cbte date, p_doc_tipo integer, p_doc_nro character varying, p_imp_total numeric, p_imp_neto numeric, p_imp_iva numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pv integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM public.get_my_empresa_id() THEN RAISE EXCEPTION 'No autorizado'; END IF;
    IF NOT has_module_permission('ventas') THEN RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas'; END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.caea_registros WHERE id = p_caea_registro_id AND empresa_id = p_empresa_id AND estado = 'activo' AND fecha_hasta >= CURRENT_DATE) THEN
    RAISE EXCEPTION 'CAEA no vigente o no pertenece a la empresa';
  END IF;
  SELECT punto_venta INTO v_pv FROM public.caea_registros WHERE id = p_caea_registro_id;
  INSERT INTO public.caea_comprobantes (empresa_id, caea_registro_id, comprobante_id, tipo_cbte, punto_venta, nro_cbte_desde, nro_cbte_hasta, fecha_cbte, doc_tipo, doc_nro, imp_total, imp_neto, imp_iva)
  VALUES (p_empresa_id, p_caea_registro_id, p_comprobante_id, p_tipo_cbte, COALESCE(v_pv, 1), p_nro_cbte, p_nro_cbte, p_fecha_cbte, p_doc_tipo, p_doc_nro, p_imp_total, p_imp_neto, p_imp_iva);
  UPDATE public.comprobantes SET modo_autorizacion = 'CAEA', caea_registro_id = p_caea_registro_id, cae_estado = 'no_aplica' WHERE id = p_comprobante_id AND empresa_id = p_empresa_id;
  UPDATE public.caea_registros SET comprobantes_emitidos = comprobantes_emitidos + 1, updated_at = now() WHERE id = p_caea_registro_id;
END;
$function$;

-- ── 2. usar_caea_para_comprobante (la que llama el Monitor y llamará el worker) ─
CREATE OR REPLACE FUNCTION public.usar_caea_para_comprobante(p_comprobante_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id       uuid;
  v_estado_actual     text;
  v_tipo_afip         text;
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
         iva_discriminado, fecha::date, cliente_id
    INTO v_empresa_id, v_estado_actual, v_tipo_afip, v_total, v_neto,
         v_iva, v_fecha, v_cliente_id
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

  v_tipo_cbte := CASE COALESCE(v_tipo_afip, 'B') WHEN 'A' THEN 1 WHEN 'C' THEN 11 ELSE 6 END;

  SELECT id, caea, fecha_hasta
    INTO v_caea_registro_id, v_caea, v_fecha_hasta
    FROM public.caea_registros
   WHERE empresa_id = v_empresa_id
     AND tipo_cbte   = v_tipo_cbte
     AND estado      = 'activo'
     AND fecha_hasta >= CURRENT_DATE
   ORDER BY fecha_hasta DESC
   LIMIT 1
   FOR UPDATE;

  IF v_caea_registro_id IS NULL THEN
    RAISE EXCEPTION 'No hay un CAEA vigente para comprobantes tipo % de esta empresa. Solicitalo primero desde Configuración → Facturación.',
      COALESCE(v_tipo_afip, 'B');
  END IF;

  SELECT comprobantes_emitidos + 1 INTO v_nro_cbte
    FROM public.caea_registros WHERE id = v_caea_registro_id;

  v_documento := NULL;
  IF v_cliente_id IS NOT NULL THEN
    SELECT documento INTO v_documento FROM public.clientes WHERE id = v_cliente_id;
  END IF;
  v_doc_digits := regexp_replace(COALESCE(v_documento, ''), '\D', '', 'g');
  IF length(v_doc_digits) = 11 THEN
    v_doc_tipo := 80; v_doc_nro := v_doc_digits;
  ELSIF length(v_doc_digits) BETWEEN 7 AND 8 THEN
    v_doc_tipo := 96; v_doc_nro := v_doc_digits;
  ELSE
    v_doc_tipo := 99; v_doc_nro := '0';
  END IF;

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

-- ROLLBACK (comentado): CREATE OR REPLACE de ambas con el body previo (sin el
-- bloque `IF auth.role() IS DISTINCT FROM 'service_role'` envolviendo los checks).
