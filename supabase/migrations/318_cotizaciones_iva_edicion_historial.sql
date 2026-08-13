-- migration 318 — Cotizaciones: alícuota IVA por ítem + auditoría de ítems + RPC de edición
--
-- Pedido de Luciano (12/08), investigado contra SAP B1 y el mercado antes de construir:
--   1. Descuento global del documento — cotizaciones.descuento ya existía desde mig.002
--      (NUMERIC(5,2), "-- porcentaje"), nunca se conectó a la UI. No requiere columna nueva.
--   2. IVA por línea — cotizacion_items nunca tuvo alicuota_iva (a diferencia de
--      comprobante_items y devolucion_items, que ya la tienen desde mig.262). Se agrega acá
--      con el mismo patrón/constraint que esas dos tablas.
--   3. Edición con historial — cotizaciones YA está enganchada a trg_audit_cotizaciones
--      (fn_audit_trigger genérica, mig.001/143); cotizacion_items nunca lo estuvo. Se agrega
--      acá para que el historial de cambios cubra también ítems agregados/quitados/editados,
--      no solo la cabecera.
--
-- Regla de edición confirmada (SAP B1 + mercado — Salesforce/HubSpot/Zoho Estimates):
-- editable mientras el documento está "abierto" (borrador/enviada/aprobada/rechazada),
-- bloqueado una vez "convertida" (ya generó una venta real — editar después desincronizaría
-- el documento de esa venta). El guard vive en la RPC, no solo en el frontend.

-- 1. Alícuota IVA por ítem — mismo patrón que devolucion_items (mig.262) y comprobante_items.
ALTER TABLE public.cotizacion_items
  ADD COLUMN IF NOT EXISTS alicuota_iva TEXT DEFAULT '21';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cotizacion_items_alicuota_iva_check'
  ) THEN
    ALTER TABLE public.cotizacion_items
      ADD CONSTRAINT cotizacion_items_alicuota_iva_check
      CHECK (alicuota_iva IN ('21', '10.5', '0', 'exento', 'no_gravado'));
  END IF;
END $$;

-- 2. Auditoría de ítems — reusa fn_audit_trigger() ya existente (mig.001), mismo patrón
-- que el resto de las tablas *_items críticas.
DROP TRIGGER IF EXISTS trg_audit_cotizacion_items ON public.cotizacion_items;
CREATE TRIGGER trg_audit_cotizacion_items
  AFTER INSERT OR UPDATE OR DELETE ON public.cotizacion_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- 3. RPC de edición atómica — cabecera + ítems en una sola transacción (evita el estado a
-- medias que quedaría con updates separados desde el cliente: header actualizado pero items
-- no, o viceversa). Reemplaza todos los ítems (delete + insert) en vez de intentar diffear
-- fila por fila — más simple, y el trigger de auditoría igual deja registro de qué se sacó
-- y qué se agregó via los INSERT/DELETE resultantes.
CREATE OR REPLACE FUNCTION public.actualizar_cotizacion(
  p_cotizacion_id   uuid,
  p_cliente_id      uuid,
  p_cliente_nombre  text,
  p_items           jsonb,   -- [{producto_id, descripcion, cantidad, precio_unitario, descuento_item, alicuota_iva, unidad_medida}]
  p_notas           text DEFAULT NULL,
  p_condiciones_pago text DEFAULT NULL,
  p_fecha_vencimiento date DEFAULT NULL,
  p_moneda          text DEFAULT 'ARS',
  p_tipo_cambio_tasa numeric DEFAULT 1,
  p_descuento       numeric DEFAULT 0   -- porcentaje, sobre el total ya neto de descuentos por línea
)
RETURNS public.cotizaciones
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id   uuid;
  v_estado       text;
  v_item         jsonb;
  v_subtotal     numeric := 0;
  v_item_subtotal numeric;
  v_total        numeric;
  v_cotizacion   public.cotizaciones;
BEGIN
  SELECT empresa_id, estado INTO v_empresa_id, v_estado
  FROM public.cotizaciones
  WHERE id = p_cotizacion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cotización no encontrada';
  END IF;
  IF v_empresa_id IS DISTINCT FROM public.get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: la cotización no pertenece a tu empresa';
  END IF;
  IF v_estado = 'convertida' THEN
    RAISE EXCEPTION 'No se puede editar una cotización ya convertida en venta — el cambio debería hacerse en el documento generado, no acá.';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La cotización necesita al menos un ítem';
  END IF;

  -- Reemplazo completo de ítems — el trigger de auditoría deja registro de los que se
  -- sacaron (DELETE) y los que quedaron (INSERT), aunque no haya cambiado nada en el medio.
  DELETE FROM public.cotizacion_items WHERE cotizacion_id = p_cotizacion_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_subtotal := (COALESCE((v_item->>'cantidad')::numeric, 0) * COALESCE((v_item->>'precio_unitario')::numeric, 0))
                        * (1 - COALESCE((v_item->>'descuento_item')::numeric, 0) / 100);
    v_subtotal := v_subtotal + v_item_subtotal;

    INSERT INTO public.cotizacion_items (
      cotizacion_id, empresa_id, producto_id, descripcion, cantidad, precio_unitario,
      descuento_item, subtotal, unidad_medida, alicuota_iva
    ) VALUES (
      p_cotizacion_id, v_empresa_id,
      NULLIF(v_item->>'producto_id', '')::uuid,
      COALESCE(v_item->>'descripcion', ''),
      COALESCE((v_item->>'cantidad')::numeric, 0),
      COALESCE((v_item->>'precio_unitario')::numeric, 0),
      COALESCE((v_item->>'descuento_item')::numeric, 0),
      v_item_subtotal,
      v_item->>'unidad_medida',
      COALESCE(NULLIF(v_item->>'alicuota_iva', ''), '21')
    );
  END LOOP;

  v_total := v_subtotal * (1 - COALESCE(p_descuento, 0) / 100);

  UPDATE public.cotizaciones SET
    cliente_id         = p_cliente_id,
    cliente_nombre      = p_cliente_nombre,
    notas               = p_notas,
    condiciones_pago    = p_condiciones_pago,
    fecha_vencimiento   = p_fecha_vencimiento,
    moneda              = p_moneda,
    tipo_cambio_tasa    = p_tipo_cambio_tasa,
    descuento           = COALESCE(p_descuento, 0),
    subtotal            = v_subtotal,
    total               = v_total
  WHERE id = p_cotizacion_id
  RETURNING * INTO v_cotizacion;

  RETURN v_cotizacion;
END;
$$;

REVOKE ALL ON FUNCTION public.actualizar_cotizacion FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_cotizacion TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.actualizar_cotizacion(uuid, uuid, text, jsonb, text, text, date, text, numeric, numeric);
-- DROP TRIGGER IF EXISTS trg_audit_cotizacion_items ON public.cotizacion_items;
-- ALTER TABLE public.cotizacion_items DROP CONSTRAINT IF EXISTS cotizacion_items_alicuota_iva_check;
-- ALTER TABLE public.cotizacion_items DROP COLUMN IF EXISTS alicuota_iva;
