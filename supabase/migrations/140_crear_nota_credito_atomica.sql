-- ════════════════════════════════════════════════════════════════════════════
-- migration 140 — Auditoria area #13 (Comprobantes — lifecycle)
-- RPC crear_nota_credito: atomiza comprobante + items + CC (mismo patron que
-- crear_nota_debito, mig.133)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hallazgo (confirmado por lectura de codigo, mismo patron ya visto y
-- fixeado 3 veces esta auditoria en CxC/CxP/ND): NuevaNCModal.jsx hacia
-- 3 escrituras SUELTAS — INSERT comprobantes, INSERT comprobante_items,
-- INSERT cuenta_corriente_movimientos (HABER) — y la 3ra ni siquiera
-- capturaba el error. Si el 3er insert fallaba, la NC quedaba creada pero
-- la deuda del cliente NUNCA bajaba: exactamente el mismo bug que
-- crear_nota_debito tenia para 'recibida' antes de mig.133.
--
-- Fix: RPC SECURITY DEFINER que hace las 3 escrituras en una sola
-- transaccion. El frontend (commit aparte) deja de hacer inserts sueltos.

CREATE OR REPLACE FUNCTION public.crear_nota_credito(
  p_empresa_id           uuid,
  p_user_id              uuid,
  p_cliente_id           uuid,
  p_cliente_nombre       text,
  p_motivo_nc            text,
  p_items                jsonb,
  p_comprobante_origen_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp_id       UUID;
  v_numero        TEXT;
  v_item          JSONB;
  v_subtotal_neto NUMERIC := 0;
  v_total_iva     NUMERIC := 0;
  v_total         NUMERIC;
  v_cantidad      NUMERIC;
  v_precio        NUMERIC;
  v_alicuota      NUMERIC;
  v_neto_item     NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  IF p_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'cliente_id no pertenece a la empresa';
  END IF;

  IF p_comprobante_origen_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.comprobantes WHERE id = p_comprobante_origen_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'comprobante_origen_id no pertenece a la empresa';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La NC debe tener al menos un ítem';
  END IF;

  -- Calcular totales
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_cantidad  := (v_item->>'cantidad')::NUMERIC;
    v_precio    := (v_item->>'precio_unitario')::NUMERIC;
    v_alicuota  := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_neto_item := v_cantidad * v_precio;
    v_subtotal_neto := v_subtotal_neto + v_neto_item;
    v_total_iva     := v_total_iva + (v_neto_item * v_alicuota / 100);
  END LOOP;

  v_total := v_subtotal_neto + v_total_iva;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'El total de la NC debe ser mayor a cero';
  END IF;

  v_numero := public.obtener_proximo_numero(p_empresa_id, 'nota_credito');

  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre,
    total, neto_gravado, iva_discriminado, forma_pago, estado_pago,
    moneda, tipo_cambio_tasa, tipo, comprobante_origen_id, motivo_nc
  ) VALUES (
    p_empresa_id, p_empresa_id, v_numero, now(), p_cliente_id,
    COALESCE(p_cliente_nombre, 'Consumidor Final'),
    v_total, v_subtotal_neto, v_total_iva, 'Nota de Crédito', 'pagada',
    'ARS', 1, 'nota_credito', p_comprobante_origen_id, p_motivo_nc
  ) RETURNING id INTO v_comp_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'precio_unitario')::NUMERIC;

    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id, producto_id, cantidad,
      precio_unitario, subtotal, alicuota_iva
    ) VALUES (
      v_comp_id, p_empresa_id, NULLIF(v_item->>'producto_id', '')::UUID, v_cantidad,
      v_precio, v_cantidad * v_precio, COALESCE(v_item->>'alicuota_iva', '21')
    );
  END LOOP;

  IF p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha
    ) VALUES (
      p_empresa_id, p_user_id, p_cliente_id, v_comp_id, 'HABER', v_total,
      'NC ' || v_numero || ' — ' || p_motivo_nc, now()
    );
  END IF;

  RETURN jsonb_build_object('comprobante_id', v_comp_id, 'numero_venta', v_numero, 'total', v_total);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_nota_credito(uuid, uuid, uuid, text, text, jsonb, uuid) FROM PUBLIC, anon;
