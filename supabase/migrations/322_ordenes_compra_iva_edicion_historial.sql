-- migration 322 — Órdenes de Compra: alícuota IVA + descuento (línea y global) + edición con
-- historial de cambios, con diffing por id DESDE EL ARRANQUE (mismo patrón que mig.319/320,
-- sin repetir el error de delete-all+insert-all que tuvo la primera versión de Cotizaciones).
--
-- Fase 1 del plan PLAN_COMPROBANTES_ESTANDAR.md (13/08): OC es el candidato natural para el
-- "estándar Cotizaciones/Pedidos" — es un documento pre-transacción (como Cotización/Pedido),
-- ya anotado en memoria como el siguiente a replicar. A diferencia de Pedidos, OC no tenía
-- NINGUNA forma de editarse (solo cambiar estado o cancelar) — se agrega desde cero, ya con el
-- diseño correcto.
--
-- Guard de edición: editable mientras estado IN ('borrador', 'enviada') — es decir, mientras no
-- haya ninguna Recepción generada todavía (cantidad_recibida = 0 en todos sus ítems). Una vez que
-- entra en 'recibida_parcial'/'recibida' ya hubo movimiento de stock real, no se edita más.
--
-- Los triggers existentes de ordenes_compra_items (trg_oc_recalcular_estado, trg_oc_stock) son
-- `AFTER UPDATE OF cantidad_recibida` — la RPC de abajo nunca toca esa columna en su UPDATE, así
-- que no se disparan por una edición (verificado leyendo su definición antes de escribir esto).

-- 1. Alícuota IVA + descuento por línea — mismo patrón que cotizacion_items/pedido_items.
ALTER TABLE public.ordenes_compra_items
  ADD COLUMN IF NOT EXISTS alicuota_iva TEXT DEFAULT '21';
ALTER TABLE public.ordenes_compra_items
  ADD COLUMN IF NOT EXISTS descuento_item NUMERIC NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ordenes_compra_items_alicuota_iva_check'
  ) THEN
    ALTER TABLE public.ordenes_compra_items
      ADD CONSTRAINT ordenes_compra_items_alicuota_iva_check
      CHECK (alicuota_iva IN ('21', '10.5', '0', 'exento', 'no_gravado'));
  END IF;
END $$;

-- 2. Descuento global % — campo de entrada nuevo (OC no tenía ningún campo de descuento antes).
ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS descuento_global_pct NUMERIC NOT NULL DEFAULT 0;

-- 3. Auditoría de ítems — ordenes_compra ya está enganchada (trg_audit_ordenes_compra, previo a
-- esta migración); ordenes_compra_items nunca lo estuvo.
DROP TRIGGER IF EXISTS trg_audit_ordenes_compra_items ON public.ordenes_compra_items;
CREATE TRIGGER trg_audit_ordenes_compra_items
  AFTER INSERT OR UPDATE OR DELETE ON public.ordenes_compra_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- 4. RPC de edición atómica con diffing por id.
CREATE OR REPLACE FUNCTION public.actualizar_orden_compra(
  p_orden_id              uuid,
  p_proveedor_id          uuid,
  p_proveedor_nombre      text,
  p_items                 jsonb,   -- [{id?, producto_id, descripcion, cantidad_pedida, costo_unitario, descuento_item, alicuota_iva, unidad_medida}]
  p_notas                 text DEFAULT NULL,
  p_fecha_entrega_esperada date DEFAULT NULL,
  p_forma_pago            text DEFAULT 'Efectivo',
  p_moneda                text DEFAULT 'ARS',
  p_tipo_cambio_tasa      numeric DEFAULT 1,
  p_descuento_global_pct  numeric DEFAULT 0
)
RETURNS public.ordenes_compra
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id    uuid;
  v_estado        text;
  v_item          jsonb;
  v_item_id       uuid;
  v_subtotal      numeric := 0;
  v_item_subtotal numeric;
  v_total         numeric;
  v_oc            public.ordenes_compra;
  v_keep_ids      uuid[];
BEGIN
  SELECT empresa_id, estado INTO v_empresa_id, v_estado
  FROM public.ordenes_compra
  WHERE id = p_orden_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;
  IF v_empresa_id IS DISTINCT FROM public.get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: la orden de compra no pertenece a tu empresa';
  END IF;
  IF NOT public.has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;
  IF v_estado NOT IN ('borrador', 'enviada') THEN
    RAISE EXCEPTION 'Solo se puede editar una orden de compra en Borrador o Enviada — una vez que hay Recepción registrada ya hubo movimiento de stock real.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La orden de compra necesita al menos un ítem';
  END IF;

  v_keep_ids := ARRAY(
    SELECT (elem->>'id')::uuid FROM jsonb_array_elements(p_items) elem WHERE elem->>'id' IS NOT NULL
  );

  DELETE FROM public.ordenes_compra_items
  WHERE orden_id = p_orden_id
    AND id <> ALL(COALESCE(v_keep_ids, ARRAY[]::uuid[]));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := NULLIF(v_item->>'id', '')::uuid;
    v_item_subtotal := (COALESCE((v_item->>'cantidad_pedida')::numeric, 0) * COALESCE((v_item->>'costo_unitario')::numeric, 0))
                        * (1 - COALESCE((v_item->>'descuento_item')::numeric, 0) / 100);
    v_subtotal := v_subtotal + v_item_subtotal;

    IF v_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.ordenes_compra_items WHERE id = v_item_id AND orden_id = p_orden_id
    ) THEN
      -- UPDATE solo si algo cambió — nunca toca cantidad_recibida/cantidad_facturada/
      -- cantidad_devuelta (no están en el SET), así los triggers `AFTER UPDATE OF
      -- cantidad_recibida` no se disparan por una edición.
      UPDATE public.ordenes_compra_items SET
        producto_id     = NULLIF(v_item->>'producto_id', '')::uuid,
        descripcion     = COALESCE(v_item->>'descripcion', ''),
        cantidad_pedida = COALESCE((v_item->>'cantidad_pedida')::numeric, 0),
        costo_unitario  = COALESCE((v_item->>'costo_unitario')::numeric, 0),
        descuento_item  = COALESCE((v_item->>'descuento_item')::numeric, 0),
        subtotal        = v_item_subtotal,
        unidad_medida   = v_item->>'unidad_medida',
        alicuota_iva    = COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
      WHERE id = v_item_id
        AND (
          producto_id     IS DISTINCT FROM NULLIF(v_item->>'producto_id', '')::uuid OR
          descripcion     IS DISTINCT FROM COALESCE(v_item->>'descripcion', '') OR
          cantidad_pedida IS DISTINCT FROM COALESCE((v_item->>'cantidad_pedida')::numeric, 0) OR
          costo_unitario  IS DISTINCT FROM COALESCE((v_item->>'costo_unitario')::numeric, 0) OR
          descuento_item  IS DISTINCT FROM COALESCE((v_item->>'descuento_item')::numeric, 0) OR
          subtotal        IS DISTINCT FROM v_item_subtotal OR
          unidad_medida   IS DISTINCT FROM (v_item->>'unidad_medida') OR
          alicuota_iva    IS DISTINCT FROM COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
        );
    ELSE
      INSERT INTO public.ordenes_compra_items (
        orden_id, empresa_id, producto_id, descripcion, cantidad_pedida, cantidad_recibida,
        costo_unitario, subtotal, unidad_medida, alicuota_iva, descuento_item
      ) VALUES (
        p_orden_id, v_empresa_id,
        NULLIF(v_item->>'producto_id', '')::uuid,
        COALESCE(v_item->>'descripcion', ''),
        COALESCE((v_item->>'cantidad_pedida')::numeric, 0),
        0,
        COALESCE((v_item->>'costo_unitario')::numeric, 0),
        v_item_subtotal,
        v_item->>'unidad_medida',
        COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21'),
        COALESCE((v_item->>'descuento_item')::numeric, 0)
      );
    END IF;
  END LOOP;

  v_total := v_subtotal * (1 - COALESCE(p_descuento_global_pct, 0) / 100);

  UPDATE public.ordenes_compra SET
    proveedor_id            = p_proveedor_id,
    proveedor_nombre        = p_proveedor_nombre,
    notas                   = p_notas,
    fecha_entrega_esperada  = p_fecha_entrega_esperada,
    forma_pago              = COALESCE(p_forma_pago, forma_pago),
    moneda                  = p_moneda,
    tipo_cambio_tasa        = p_tipo_cambio_tasa,
    descuento_global_pct    = COALESCE(p_descuento_global_pct, 0),
    subtotal                = v_subtotal,
    total                   = v_total,
    updated_at              = now()
  WHERE id = p_orden_id
  RETURNING * INTO v_oc;

  RETURN v_oc;
END;
$$;

REVOKE ALL ON FUNCTION public.actualizar_orden_compra(uuid, uuid, text, jsonb, text, date, text, text, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.actualizar_orden_compra(uuid, uuid, text, jsonb, text, date, text, text, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.actualizar_orden_compra(uuid, uuid, text, jsonb, text, date, text, text, numeric, numeric) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.actualizar_orden_compra(uuid, uuid, text, jsonb, text, date, text, text, numeric, numeric);
-- DROP TRIGGER IF EXISTS trg_audit_ordenes_compra_items ON public.ordenes_compra_items;
-- ALTER TABLE public.ordenes_compra DROP COLUMN IF EXISTS descuento_global_pct;
-- ALTER TABLE public.ordenes_compra_items DROP CONSTRAINT IF EXISTS ordenes_compra_items_alicuota_iva_check;
-- ALTER TABLE public.ordenes_compra_items DROP COLUMN IF EXISTS alicuota_iva;
-- ALTER TABLE public.ordenes_compra_items DROP COLUMN IF EXISTS descuento_item;
