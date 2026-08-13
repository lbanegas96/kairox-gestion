-- migration 319 — actualizar_cotizacion: diffear ítems en vez de borrar y recrear todo
--
-- Bug real reportado por Luciano (13/08): el Historial de cambios de una cotización
-- editada mostraba TODOS los ítems como "quitado" + "agregado" en cada guardado, aunque
-- solo se hubiera tocado uno. Causa: mig.318 hacía DELETE de todos los cotizacion_items
-- y volvía a INSERTarlos enteros en cada llamada a actualizar_cotizacion — el trigger de
-- auditoría (trg_audit_cotizacion_items) fielmente registraba ese DELETE+INSERT masivo,
-- generando volumen inútil e inentendible en vez de mostrar solo lo que cambió de verdad.
--
-- Fix: el frontend ahora manda el `id` de cada ítem preexistente (cotizacionesService.ts).
-- Con eso, la RPC puede:
--   - DELETE solo los ítems que existían y ya no vienen en el payload (el usuario los sacó)
--   - UPDATE solo los ítems cuyo contenido realmente cambió (IS DISTINCT FROM campo a campo)
--   - INSERT solo los ítems sin id (nuevos, agregados durante la edición)
-- Un ítem que no se tocó no genera ninguna fila de auditoría.

CREATE OR REPLACE FUNCTION public.actualizar_cotizacion(
  p_cotizacion_id   uuid,
  p_cliente_id      uuid,
  p_cliente_nombre  text,
  p_items           jsonb,   -- [{id?, producto_id, descripcion, cantidad, precio_unitario, descuento_item, alicuota_iva, unidad_medida}]
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
  v_empresa_id    uuid;
  v_estado        text;
  v_item          jsonb;
  v_item_id       uuid;
  v_subtotal      numeric := 0;
  v_item_subtotal numeric;
  v_total         numeric;
  v_cotizacion    public.cotizaciones;
  v_keep_ids      uuid[];
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

  -- Ítems preexistentes que el payload sigue trayendo (por id) — todo lo demás que
  -- hoy exista en la tabla para esta cotización y no esté en esta lista se borra.
  v_keep_ids := ARRAY(
    SELECT (elem->>'id')::uuid FROM jsonb_array_elements(p_items) elem WHERE elem->>'id' IS NOT NULL
  );

  DELETE FROM public.cotizacion_items
  WHERE cotizacion_id = p_cotizacion_id
    AND id <> ALL(COALESCE(v_keep_ids, ARRAY[]::uuid[]));

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := NULLIF(v_item->>'id', '')::uuid;
    v_item_subtotal := (COALESCE((v_item->>'cantidad')::numeric, 0) * COALESCE((v_item->>'precio_unitario')::numeric, 0))
                        * (1 - COALESCE((v_item->>'descuento_item')::numeric, 0) / 100);
    v_subtotal := v_subtotal + v_item_subtotal;

    IF v_item_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.cotizacion_items WHERE id = v_item_id AND cotizacion_id = p_cotizacion_id
    ) THEN
      -- Ítem existente: UPDATE solo si algo cambió de verdad — si no, ni se toca
      -- (evita una fila de auditoría "modificado" para ítems intactos).
      UPDATE public.cotizacion_items SET
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
      -- Sin id (o id que no pertenece a esta cotización) = ítem nuevo agregado durante
      -- la edición. gen_random_uuid() por default de la tabla — nunca se usa el id que
      -- venga del cliente para el INSERT.
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
    END IF;
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

REVOKE ALL ON FUNCTION public.actualizar_cotizacion(uuid, uuid, text, jsonb, text, text, date, text, numeric, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.actualizar_cotizacion(uuid, uuid, text, jsonb, text, text, date, text, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.actualizar_cotizacion(uuid, uuid, text, jsonb, text, text, date, text, numeric, numeric) TO authenticated;

-- ROLLBACK (comentado): restaura el comportamiento delete-all+insert-all de mig.318.
-- (ver esa migración para el CREATE OR REPLACE original)
