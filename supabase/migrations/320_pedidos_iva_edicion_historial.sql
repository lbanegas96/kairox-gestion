-- migration 320 — Pedidos: alícuota IVA por ítem + descuento global % + auditoría de ítems
--
-- Réplica del mismo patrón ya construido en Cotizaciones (mig.318/319), pedido explícito de
-- Luciano (13/08): "en pedido me gustaria aplicar lo que tengamos en cotizacion... todo lo que
-- construimos". Mismo criterio en los tres puntos:
--
--   1. IVA por línea — pedido_items nunca tuvo alicuota_iva (cotizacion_items sí desde mig.318,
--      comprobante_items/devolucion_items desde mig.262). Mismo patrón/constraint.
--   2. Descuento global — pedidos YA tiene una columna `descuento` (mig.252), pero esa guarda el
--      MONTO $ ya calculado (subtotal - total), no un porcentaje de entrada — significado
--      distinto al de cotizaciones.descuento (que SÍ es el % que carga el usuario). No se
--      reutiliza para no romper esa semántica ya usada; se agrega `descuento_global_pct` nueva
--      específicamente para el campo de entrada del formulario.
--   3. Auditoría de ítems — pedidos YA está enganchada a trg_audit_pedidos (mig.017, sobrevivió
--      la limpieza de duplicados de mig.056); pedido_items nunca lo estuvo. Se agrega acá.
--
-- A diferencia de la primera versión de Cotizaciones (mig.318, corregida en mig.319 tras el bug
-- real de historial con ruido), la RPC de edición de Pedido arranca YA con diffing por id —
-- no se repite el error de borrar y reinsertar todo en cada guardado.
--
-- Guard de edición: se mantiene la regla YA existente en TablaPedidos.jsx (`canEdit = estado ===
-- 'borrador'`) — más estricta que Cotizaciones a propósito: un Pedido confirmado/en_preparación
-- puede ya tener Entregas generadas (cantidad_entregada > 0), y no hay guard de negocio pensado
-- para permitir editar cantidades después de eso. No se amplía esa ventana en esta migración.

-- 1. Alícuota IVA por ítem — mismo patrón que cotizacion_items (mig.318).
ALTER TABLE public.pedido_items
  ADD COLUMN IF NOT EXISTS alicuota_iva TEXT DEFAULT '21';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pedido_items_alicuota_iva_check'
  ) THEN
    ALTER TABLE public.pedido_items
      ADD CONSTRAINT pedido_items_alicuota_iva_check
      CHECK (alicuota_iva IN ('21', '10.5', '0', 'exento', 'no_gravado'));
  END IF;
END $$;

-- 2. Descuento global % — campo de entrada, separado de `descuento` (monto $ ya calculado).
ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS descuento_global_pct NUMERIC NOT NULL DEFAULT 0;

-- 3. Auditoría de ítems — reusa fn_audit_trigger() (mig.001).
DROP TRIGGER IF EXISTS trg_audit_pedido_items ON public.pedido_items;
CREATE TRIGGER trg_audit_pedido_items
  AFTER INSERT OR UPDATE OR DELETE ON public.pedido_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- 4. RPC de edición atómica con diffing por id desde el inicio (ver mig.319 para el porqué).
CREATE OR REPLACE FUNCTION public.actualizar_pedido(
  p_pedido_id         uuid,
  p_cliente_id        uuid,
  p_cliente_nombre    text,
  p_items             jsonb,   -- [{id?, producto_id, descripcion, cantidad, precio_unitario, descuento_item, alicuota_iva, unidad_medida}]
  p_notas             text DEFAULT NULL,
  p_fecha_entrega     date DEFAULT NULL,
  p_referencia_cliente text DEFAULT NULL,
  p_moneda            text DEFAULT 'ARS',
  p_tipo_cambio_tasa  numeric DEFAULT 1,
  p_descuento_global_pct numeric DEFAULT 0
)
RETURNS public.pedidos
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id    uuid;
  v_estado        text;
  v_item          jsonb;
  v_item_id       uuid;
  v_subtotal      numeric := 0;    -- neto de descuentos por línea, antes del global (igual criterio que ya usaba el insert manual)
  v_item_subtotal numeric;
  v_total         numeric;
  v_descuento_monto numeric;
  v_pedido        public.pedidos;
  v_keep_ids      uuid[];
BEGIN
  SELECT empresa_id, estado INTO v_empresa_id, v_estado
  FROM public.pedidos
  WHERE id = p_pedido_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM public.get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el pedido no pertenece a tu empresa';
  END IF;
  IF v_estado <> 'borrador' THEN
    RAISE EXCEPTION 'Solo se puede editar un pedido en estado Borrador — una vez confirmado puede tener entregas generadas.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El pedido necesita al menos un ítem';
  END IF;

  v_keep_ids := ARRAY(
    SELECT (elem->>'id')::uuid FROM jsonb_array_elements(p_items) elem WHERE elem->>'id' IS NOT NULL
  );

  DELETE FROM public.pedido_items
  WHERE pedido_id = p_pedido_id
    AND id <> ALL(COALESCE(v_keep_ids, ARRAY[]::uuid[]));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := NULLIF(v_item->>'id', '')::uuid;
    v_item_subtotal := (COALESCE((v_item->>'cantidad')::numeric, 0) * COALESCE((v_item->>'precio_unitario')::numeric, 0))
                        * (1 - COALESCE((v_item->>'descuento_item')::numeric, 0) / 100);
    v_subtotal := v_subtotal + v_item_subtotal;

    IF v_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.pedido_items WHERE id = v_item_id AND pedido_id = p_pedido_id
    ) THEN
      UPDATE public.pedido_items SET
        producto_id     = NULLIF(v_item->>'producto_id', '')::uuid,
        descripcion     = COALESCE(v_item->>'descripcion', ''),
        cantidad        = COALESCE((v_item->>'cantidad')::numeric, 0),
        precio_unitario = COALESCE((v_item->>'precio_unitario')::numeric, 0),
        descuento_item  = COALESCE((v_item->>'descuento_item')::numeric, 0),
        subtotal        = v_item_subtotal,
        unidad_medida   = v_item->>'unidad_medida',
        alicuota_iva    = COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
      WHERE id = v_item_id
        AND (
          producto_id     IS DISTINCT FROM NULLIF(v_item->>'producto_id', '')::uuid OR
          descripcion     IS DISTINCT FROM COALESCE(v_item->>'descripcion', '') OR
          cantidad        IS DISTINCT FROM COALESCE((v_item->>'cantidad')::numeric, 0) OR
          precio_unitario IS DISTINCT FROM COALESCE((v_item->>'precio_unitario')::numeric, 0) OR
          descuento_item  IS DISTINCT FROM COALESCE((v_item->>'descuento_item')::numeric, 0) OR
          subtotal        IS DISTINCT FROM v_item_subtotal OR
          unidad_medida   IS DISTINCT FROM (v_item->>'unidad_medida') OR
          alicuota_iva    IS DISTINCT FROM COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
        );
    ELSE
      INSERT INTO public.pedido_items (
        pedido_id, empresa_id, producto_id, descripcion, cantidad, precio_unitario,
        descuento_item, subtotal, unidad_medida, alicuota_iva
      ) VALUES (
        p_pedido_id, v_empresa_id,
        NULLIF(v_item->>'producto_id', '')::uuid,
        COALESCE(v_item->>'descripcion', ''),
        COALESCE((v_item->>'cantidad')::numeric, 0),
        COALESCE((v_item->>'precio_unitario')::numeric, 0),
        COALESCE((v_item->>'descuento_item')::numeric, 0),
        v_item_subtotal,
        v_item->>'unidad_medida',
        COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
      );
    END IF;
  END LOOP;

  v_total := v_subtotal * (1 - COALESCE(p_descuento_global_pct, 0) / 100);
  v_descuento_monto := v_subtotal - v_total;  -- mismo significado ($) que ya tenía pedidos.descuento

  UPDATE public.pedidos SET
    cliente_id           = p_cliente_id,
    cliente_nombre        = p_cliente_nombre,
    notas                 = p_notas,
    fecha_entrega         = p_fecha_entrega,
    referencia_cliente    = p_referencia_cliente,
    moneda                = p_moneda,
    tipo_cambio_tasa      = p_tipo_cambio_tasa,
    descuento_global_pct  = COALESCE(p_descuento_global_pct, 0),
    subtotal              = v_subtotal,
    descuento             = v_descuento_monto,
    total                 = v_total,
    updated_at            = now()
  WHERE id = p_pedido_id
  RETURNING * INTO v_pedido;

  RETURN v_pedido;
END;
$$;

REVOKE ALL ON FUNCTION public.actualizar_pedido(uuid, uuid, text, jsonb, text, date, text, text, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.actualizar_pedido(uuid, uuid, text, jsonb, text, date, text, text, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.actualizar_pedido(uuid, uuid, text, jsonb, text, date, text, text, numeric, numeric) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.actualizar_pedido(uuid, uuid, text, jsonb, text, date, text, text, numeric, numeric);
-- DROP TRIGGER IF EXISTS trg_audit_pedido_items ON public.pedido_items;
-- ALTER TABLE public.pedidos DROP COLUMN IF EXISTS descuento_global_pct;
-- ALTER TABLE public.pedido_items DROP CONSTRAINT IF EXISTS pedido_items_alicuota_iva_check;
-- ALTER TABLE public.pedido_items DROP COLUMN IF EXISTS alicuota_iva;
