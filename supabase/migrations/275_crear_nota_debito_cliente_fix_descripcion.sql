-- migration 275 — crear_nota_debito_cliente: no guardaba la descripción del ítem
--
-- HALLAZGO (verificación cruzada Ventas↔Compras, 2026-07-29 tarde): a diferencia
-- de crear_nota_credito (que sí recibe y guarda p_item.descripcion en
-- comprobante_items.descripcion), crear_nota_debito_cliente (mig.269, de hoy
-- mismo) nunca tuvo un parámetro de descripción — ni el RPC lo esperaba ni
-- NuevaNDModal.jsx lo mandaba, a pesar de que la UI lo pide y lo valida
-- (`items.filter(i => i.descripcion.trim() ...)`). Como todo ítem de ND es de
-- tipo "servicio libre" (producto_id siempre null, no hay selector de producto
-- en el modal — es la naturaleza del documento: "flete", "diferencia de
-- precio", etc.), sin este campo cada línea queda sin ningún texto
-- identificable en comprobante_items. Verificado en la base: cero ND reales
-- creadas todavía (los datos de prueba de hoy se limpiaron), así que no hay
-- historial afectado — se corrige antes de que la tarea #38 (testear ND real)
-- lo pise.
--
-- Fix: nuevo INSERT de comprobante_items con descripcion, tomada de
-- v_item->>'descripcion'. Copia fiel del resto de la función (mig.269).

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
    INSERT INTO public.comprobante_items (comprobante_id, empresa_id, producto_id, descripcion, cantidad, precio_unitario, subtotal, alicuota_iva)
    VALUES (v_comp_id, p_empresa_id, NULLIF(v_item->>'producto_id', '')::UUID, NULLIF(v_item->>'descripcion', ''), v_cantidad, v_precio, v_cantidad * v_precio, COALESCE(v_item->>'alicuota_iva', '21'));
  END LOOP;

  IF p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha)
    VALUES (p_empresa_id, p_user_id, p_cliente_id, v_comp_id, 'DEBE', v_total, 'ND ' || v_numero || ' — ' || p_concepto, now());
  END IF;

  RETURN jsonb_build_object('comprobante_id', v_comp_id, 'numero_venta', v_numero, 'total', v_total);
END;
$function$;

-- ROLLBACK (comentado): recrear con el cuerpo de mig.269 (INSERT de
-- comprobante_items sin la columna/valor descripcion).
