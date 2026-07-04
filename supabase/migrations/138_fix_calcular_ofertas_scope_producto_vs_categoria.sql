-- ════════════════════════════════════════════════════════════════════════════
-- migration 138 — Auditoria area #11 (Ofertas / Descuentos)
-- calcular_ofertas_carrito: producto_id y categoria_nombre se evaluaban con OR
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hallazgo (confirmado con BEGIN...ROLLBACK): la condicion de scope era
--   producto_id IS NULL OR producto_id = X OR categoria_nombre coincide
-- Si un admin configura una oferta para UN producto especifico Y TAMBIEN
-- completa categoria_nombre (la UI de OfertasSection.jsx permite ambos campos
-- simultaneamente, sin restriccion), la oferta terminaba aplicandose a
-- CUALQUIER producto de esa categoria, no solo al producto elegido. Probado:
-- oferta "solo para Producto Target" + categoria_nombre='Bebidas' descontaba
-- 50% en 'Producto Other' (misma categoria, producto distinto).
--
-- Fix: producto_id, cuando esta seteado, es excluyente (mas especifico gana).
-- categoria_nombre solo se evalua cuando la oferta NO tiene producto_id.

CREATE OR REPLACE FUNCTION public.calcular_ofertas_carrito(
  p_empresa_id uuid,
  p_items jsonb,
  p_medio_pago character varying DEFAULT NULL::character varying,
  p_total_carrito numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_item jsonb;
  v_oferta record;
  v_dia_actual smallint;
  v_descuento_monto numeric;
  v_precio_final numeric;
  v_item_result jsonb;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  v_dia_actual := EXTRACT(DOW FROM NOW()
    AT TIME ZONE 'America/Argentina/Buenos_Aires')::smallint;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT o.* INTO v_oferta
    FROM ofertas o
    WHERE o.empresa_id = p_empresa_id
      AND o.activo = true
      AND (o.fecha_desde IS NULL OR o.fecha_desde <= CURRENT_DATE)
      AND (o.fecha_hasta IS NULL OR o.fecha_hasta >= CURRENT_DATE)
      AND (
        CASE
          WHEN o.producto_id IS NOT NULL THEN
            o.producto_id = (v_item->>'producto_id')::uuid
          WHEN o.categoria_nombre IS NOT NULL THEN
            LOWER(o.categoria_nombre) = LOWER(v_item->>'categoria_nombre')
          ELSE true
        END
      )
      AND (o.medio_pago IS NULL OR o.medio_pago = p_medio_pago)
      AND (o.dia_semana IS NULL OR v_dia_actual = ANY(o.dia_semana))
      AND (o.monto_minimo_carrito IS NULL
           OR p_total_carrito >= o.monto_minimo_carrito)
      AND (o.cantidad_minima IS NULL
           OR (v_item->>'cantidad')::numeric >= o.cantidad_minima)
    ORDER BY o.prioridad DESC, o.created_at ASC
    LIMIT 1;

    IF FOUND THEN
      IF v_oferta.tipo_descuento = 'porcentaje' THEN
        v_descuento_monto := (v_item->>'precio_unitario')::numeric
                             * v_oferta.valor_descuento / 100;
        v_precio_final := (v_item->>'precio_unitario')::numeric
                          * (1 - v_oferta.valor_descuento / 100);
      ELSE
        v_descuento_monto := LEAST(
          v_oferta.valor_descuento,
          (v_item->>'precio_unitario')::numeric
        );
        v_precio_final := (v_item->>'precio_unitario')::numeric
                          - v_descuento_monto;
      END IF;

      v_item_result := jsonb_build_object(
        'producto_id', v_item->>'producto_id',
        'oferta_id', v_oferta.id,
        'oferta_nombre', v_oferta.nombre,
        'tipo_descuento', v_oferta.tipo_descuento,
        'valor_descuento', v_oferta.valor_descuento,
        'descuento_monto', ROUND(v_descuento_monto, 2),
        'precio_original', (v_item->>'precio_unitario')::numeric,
        'precio_final', ROUND(v_precio_final, 2),
        'acumulable', v_oferta.acumulable
      );
    ELSE
      v_item_result := jsonb_build_object(
        'producto_id', v_item->>'producto_id',
        'oferta_id', null,
        'oferta_nombre', null,
        'descuento_monto', 0,
        'precio_original', (v_item->>'precio_unitario')::numeric,
        'precio_final', (v_item->>'precio_unitario')::numeric,
        'acumulable', false
      );
    END IF;

    v_result := v_result || jsonb_build_array(v_item_result);
  END LOOP;

  RETURN v_result;
END;
$function$;
