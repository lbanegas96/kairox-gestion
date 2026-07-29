-- migration 269 — RPC crear_nota_debito_cliente: ND emitida con ítems + IVA + Open Item
--
-- Mirror de crear_nota_credito (mig.266) adaptado a débito:
--   - cuenta_corriente_movimientos: DEBE (aumenta la deuda) en vez de HABER.
--   - estado_pago: 'pendiente' (es una deuda nueva que espera cobro — Open Item
--     real, a diferencia de NC que se marca 'pagada' porque no espera nada).
--   - Sin lógica de imputación contra un comprobante origen: una ND no reduce
--     el saldo de nada, solo lo aumenta. comprobante_origen_id es puramente
--     de trazabilidad (Document Flow / "Factura relacionada"), no dispara
--     ningún cálculo de saldo pendiente.
--   - Mismo criterio precio-final-IVA-incluido (FACTOR_IVA) que toda la app.
--   - Sin CAE automático: el frontend decide igual que en Factura/NC, vía
--     UPDATE de seguimiento a cae_estado='pendiente' — nunca dentro de esta
--     RPC. Después de lo de hoy con las NC mal declaradas, más motivo para
--     mantener esto explícito y separado.

CREATE OR REPLACE FUNCTION public.crear_nota_debito_cliente(
  p_empresa_id            uuid,
  p_user_id               uuid,
  p_cliente_id            uuid,
  p_cliente_nombre        text,
  p_concepto              text,
  p_items                 jsonb,
  p_comprobante_origen_id uuid DEFAULT NULL::uuid,
  p_referencia_cliente    text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp_id UUID; v_numero TEXT; v_item JSONB; v_subtotal_neto NUMERIC := 0; v_total_iva NUMERIC := 0;
  v_total NUMERIC; v_cantidad NUMERIC; v_precio NUMERIC; v_alicuota NUMERIC; v_bruto_item NUMERIC;
  v_neto_item NUMERIC; v_factor NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'cliente_id no pertenece a la empresa';
  END IF;
  IF p_comprobante_origen_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.comprobantes WHERE id = p_comprobante_origen_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'comprobante_origen_id no pertenece a la empresa';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'La ND debe tener al menos un ítem'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC; v_precio := (v_item->>'precio_unitario')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_bruto_item := v_cantidad * v_precio;
    v_factor := CASE v_alicuota WHEN 21 THEN 1.21 WHEN 10.5 THEN 1.105 ELSE 1 END;
    v_neto_item := v_bruto_item / v_factor;
    v_subtotal_neto := v_subtotal_neto + v_neto_item;
    v_total_iva      := v_total_iva + (v_bruto_item - v_neto_item);
  END LOOP;
  v_total := v_subtotal_neto + v_total_iva;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total de la ND debe ser mayor a cero'; END IF;

  v_numero := public.obtener_proximo_numero(p_empresa_id, 'nota_debito_venta');

  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total, neto_gravado,
    iva_discriminado, forma_pago, estado_pago, moneda, tipo_cambio_tasa, tipo, comprobante_origen_id,
    motivo_nc, referencia_cliente
  )
  VALUES (
    p_empresa_id, p_empresa_id, v_numero, now(), p_cliente_id, COALESCE(p_cliente_nombre, 'Consumidor Final'),
    v_total, v_subtotal_neto, v_total_iva, 'Nota de Débito', 'pendiente', 'ARS', 1, 'nota_debito',
    p_comprobante_origen_id, p_concepto, NULLIF(p_referencia_cliente, '')
  )
  RETURNING id INTO v_comp_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC; v_precio := (v_item->>'precio_unitario')::NUMERIC;
    INSERT INTO public.comprobante_items (comprobante_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal, alicuota_iva)
    VALUES (v_comp_id, p_empresa_id, NULLIF(v_item->>'producto_id', '')::UUID, v_cantidad, v_precio, v_cantidad * v_precio, COALESCE(v_item->>'alicuota_iva', '21'));
  END LOOP;

  IF p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha)
    VALUES (p_empresa_id, p_user_id, p_cliente_id, v_comp_id, 'DEBE', v_total, 'ND ' || v_numero || ' — ' || p_concepto, now());
  END IF;

  RETURN jsonb_build_object('comprobante_id', v_comp_id, 'numero_venta', v_numero, 'total', v_total);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_nota_debito_cliente(uuid, uuid, uuid, text, text, jsonb, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_nota_debito_cliente(uuid, uuid, uuid, text, text, jsonb, uuid, text) TO authenticated;

-- ROLLBACK (comentado): DROP FUNCTION IF EXISTS public.crear_nota_debito_cliente(uuid, uuid, uuid, text, text, jsonb, uuid, text);
