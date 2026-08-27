-- migration 360 — crear_nota_credito_proveedor acepta p_devolucion_id
--
-- HALLAZGO (Nadia, Fase 5 prueba integral Ferretería NADIA, 27/08): a diferencia
-- del lado cliente (crear_nota_credito, mig.264, ya recibe p_devolucion_id y
-- vincula devoluciones.nota_credito_id + compensacion='nota_credito'),
-- crear_nota_credito_proveedor nunca tuvo el parámetro equivalente. Una NC de
-- proveedor generada por una devolución con mercadería queda sin vínculo real —
-- el único puente es el texto libre "(ver DEV-XXXX)" en el motivo, sin FK. El
-- listado de Devoluciones a Proveedor muestra TODAS como "Sin definir" para
-- siempre, aunque la NC exista y ya haya compensado (confirmado con
-- DEV-2026-0001 / NC-20260827-001 en Ferretería NADIA: 7 horas después de
-- creada la NC, la devolución seguía en compensacion='pendiente').
--
-- Segunda causa del mismo síntoma, más chica: devoluciones.compensacion SÍ
-- admite el valor 'nota_credito' (CHECK, mig.035) pero el frontend
-- (DevolucionesProveedorSection.jsx) nunca tuvo esa clave en su mapa de badges
-- — aunque el backend lo hubiera seteado bien, se seguía viendo "Sin definir".
-- Se corrige en el mismo commit (fix de UI, no de esta migración).
--
-- devoluciones.nota_credito_id es FK a `comprobantes` (documentos de VENTA) —
-- no sirve para apuntar a una fila de `notas_credito_proveedor`, que es una
-- tabla completamente distinta (mig.277). Hace falta una columna propia.

ALTER TABLE public.devoluciones
  ADD COLUMN IF NOT EXISTS nota_credito_proveedor_id uuid
    REFERENCES public.notas_credito_proveedor(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_devoluciones_nota_credito_proveedor_id
  ON public.devoluciones(nota_credito_proveedor_id);

-- Cambia la firma (parámetro nuevo al final) — DROP explícito antes del
-- CREATE OR REPLACE, mismo patrón ya documentado en mig.208/212/215: sin esto
-- Postgres puede dejar un overload huérfano con la firma vieja en vez de
-- reemplazar la función (deuda técnica real ya encontrada una vez en este
-- proyecto, mig.308, con crear_nota_credito del lado cliente).
DROP FUNCTION IF EXISTS public.crear_nota_credito_proveedor(
  uuid, uuid, uuid, text, jsonb, uuid, boolean, uuid
);

CREATE OR REPLACE FUNCTION public.crear_nota_credito_proveedor(
  p_empresa_id         uuid,
  p_user_id            uuid,
  p_proveedor_id       uuid,
  p_motivo             text,
  p_items              jsonb,
  p_compra_id          uuid    DEFAULT NULL::uuid,
  p_reembolso_efectivo boolean DEFAULT false,
  p_caja_sesion_id     uuid    DEFAULT NULL::uuid,
  p_devolucion_id      uuid    DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ncp_id UUID; v_numero TEXT; v_cc_id UUID; v_caja_id UUID; v_descripcion TEXT;
  v_item JSONB; v_subtotal_neto NUMERIC := 0; v_total_iva NUMERIC := 0; v_total NUMERIC;
  v_cantidad NUMERIC; v_precio NUMERIC; v_alicuota NUMERIC; v_bruto_item NUMERIC;
  v_neto_item NUMERIC; v_factor NUMERIC;
  v_orden_compra_id UUID; v_oc_estado TEXT; v_oc_totalmente_facturada BOOLEAN; v_oc_reabrible BOOLEAN := false;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;
  IF p_proveedor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'proveedor_id no pertenece a la empresa';
  END IF;
  IF p_compra_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.compras WHERE id = p_compra_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'compra_id no pertenece a la empresa';
  END IF;
  -- mig.360: mismo guard que crear_nota_credito (mig.264) del lado cliente —
  -- la devolución tiene que ser de este tenant, de tipo 'proveedor', y no
  -- tener ya una NC generada (evita duplicar el vínculo).
  IF p_devolucion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.devoluciones
     WHERE id = p_devolucion_id AND empresa_id = p_empresa_id AND tipo = 'proveedor'
       AND nota_credito_proveedor_id IS NULL
  ) THEN
    RAISE EXCEPTION 'devolucion_id no pertenece a la empresa, no es de proveedor, o ya tiene una NC generada';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La NC debe tener al menos un ítem';
  END IF;
  IF p_reembolso_efectivo AND p_caja_sesion_id IS NULL THEN
    RAISE EXCEPTION 'Reembolso en efectivo requiere una caja abierta';
  END IF;
  IF p_caja_sesion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.caja_sesiones WHERE id = p_caja_sesion_id AND empresa_id = p_empresa_id AND estado = 'abierta'
  ) THEN
    RAISE EXCEPTION 'La caja indicada no pertenece a la empresa o no está abierta';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'precio_unitario')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_bruto_item := v_cantidad * v_precio;
    v_factor := CASE v_alicuota WHEN 21 THEN 1.21 WHEN 10.5 THEN 1.105 ELSE 1 END;
    v_neto_item := v_bruto_item / v_factor;
    v_subtotal_neto := v_subtotal_neto + v_neto_item;
    v_total_iva      := v_total_iva + (v_bruto_item - v_neto_item);
  END LOOP;
  v_total := v_subtotal_neto + v_total_iva;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total de la NC debe ser mayor a cero'; END IF;

  v_numero := public.obtener_proximo_numero(p_empresa_id, 'nota_credito_proveedor');
  v_descripcion := 'NC ' || v_numero || ' — ' || p_motivo;

  INSERT INTO public.notas_credito_proveedor (
    empresa_id, user_id, numero_ncp, proveedor_id, compra_id, motivo,
    monto, neto_gravado, iva_discriminado, reembolso_efectivo
  ) VALUES (
    p_empresa_id, p_user_id, v_numero, p_proveedor_id, p_compra_id, p_motivo,
    v_total, v_subtotal_neto, v_total_iva, p_reembolso_efectivo
  ) RETURNING id INTO v_ncp_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'precio_unitario')::NUMERIC;
    INSERT INTO public.notas_credito_proveedor_items (
      nota_credito_proveedor_id, empresa_id, producto_id, descripcion, cantidad, precio_unitario, subtotal, alicuota_iva
    ) VALUES (
      v_ncp_id, p_empresa_id, NULLIF(v_item->>'producto_id', '')::UUID, NULLIF(v_item->>'descripcion', ''),
      v_cantidad, v_precio, v_cantidad * v_precio, COALESCE(v_item->>'alicuota_iva', '21')
    );
  END LOOP;

  INSERT INTO public.cuenta_corriente_proveedores (
    empresa_id, user_id, proveedor_id, tipo, monto, descripcion,
    referencia_id, referencia_tipo, fecha
  ) VALUES (
    p_empresa_id, p_user_id, p_proveedor_id, 'nota_credito', v_total, v_descripcion,
    v_ncp_id, 'nc_proveedor', now()
  ) RETURNING id INTO v_cc_id;

  UPDATE public.notas_credito_proveedor SET cc_movimiento_id = v_cc_id WHERE id = v_ncp_id;

  IF p_reembolso_efectivo THEN
    INSERT INTO public.movimientos_caja (
      empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, is_automatic, fecha
    ) VALUES (
      p_empresa_id, p_user_id, p_caja_sesion_id, 'ingreso', 'NC Proveedor', v_descripcion, v_total, 'Efectivo', true, now()
    ) RETURNING id INTO v_caja_id;

    UPDATE public.notas_credito_proveedor SET caja_movimiento_id = v_caja_id WHERE id = v_ncp_id;
  END IF;

  -- mig.360: vincular la devolución de origen a esta NC — mismo patrón que
  -- crear_nota_credito (mig.264) del lado cliente.
  IF p_devolucion_id IS NOT NULL THEN
    UPDATE public.devoluciones
       SET nota_credito_proveedor_id = v_ncp_id, compensacion = 'nota_credito'
     WHERE id = p_devolucion_id AND empresa_id = p_empresa_id AND tipo = 'proveedor';
  END IF;

  -- Revertir cantidad_facturada en la OC de origen (mig.332) — mismo patrón
  -- que mig.331 del lado Ventas: parcial, solo lo que esta NC acredita.
  IF p_compra_id IS NOT NULL THEN
    SELECT orden_compra_id INTO v_orden_compra_id FROM public.compras WHERE id = p_compra_id;

    IF v_orden_compra_id IS NOT NULL THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        IF NULLIF(v_item->>'producto_id', '') IS NOT NULL THEN
          UPDATE public.ordenes_compra_items
             SET cantidad_facturada = GREATEST(0, COALESCE(cantidad_facturada, 0) - (v_item->>'cantidad')::NUMERIC)
           WHERE orden_id = v_orden_compra_id
             AND producto_id = (v_item->>'producto_id')::UUID
             AND empresa_id = p_empresa_id;
        END IF;
      END LOOP;

      SELECT estado INTO v_oc_estado FROM public.ordenes_compra WHERE id = v_orden_compra_id;
      SELECT bool_and(cantidad_facturada >= cantidad_pedida) INTO v_oc_totalmente_facturada
        FROM public.ordenes_compra_items WHERE orden_id = v_orden_compra_id;
      v_oc_reabrible := (v_oc_estado = 'facturada') AND NOT COALESCE(v_oc_totalmente_facturada, true);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'nota_credito_proveedor_id', v_ncp_id, 'numero_ncp', v_numero, 'total', v_total,
    'orden_compra_id', v_orden_compra_id, 'oc_reabrible', v_oc_reabrible
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_nota_credito_proveedor(uuid, uuid, uuid, text, jsonb, uuid, boolean, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_nota_credito_proveedor(uuid, uuid, uuid, text, jsonb, uuid, boolean, uuid, uuid) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION public.crear_nota_credito_proveedor(uuid, uuid, uuid, text, jsonb, uuid, boolean, uuid, uuid);
-- recrear con la firma de mig.332 (sin p_devolucion_id) + su GRANT.
-- ALTER TABLE public.devoluciones DROP COLUMN nota_credito_proveedor_id;
