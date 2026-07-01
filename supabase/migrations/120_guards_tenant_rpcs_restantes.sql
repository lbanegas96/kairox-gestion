-- migration 120 — guard de tenant faltante en calcular_ofertas_carrito
--
-- Auditoría de las 27 funciones SECURITY DEFINER del schema public que no habían sido
-- revisadas todavía (venta/compra/stock ya cubiertas en sesiones 36-46). Metodología:
-- para cada una que recibe p_empresa_id, confirmar que exista `p_empresa_id = get_my_empresa_id()`
-- ANTES de cualquier lectura/escritura.
--
-- HALLAZGO (real, no hipotético) — calcular_ofertas_carrito SIN NINGÚN guard:
-- cualquier usuario autenticado podía pasar el empresa_id de OTRA empresa y la función
-- devolvía sus ofertas activas (nombre, tipo/valor de descuento, medio de pago, vigencia) —
-- fuga de información comercial cross-tenant (un competidor podría ver tu estrategia de
-- descuentos). Confirmado leyendo el body: `FROM ofertas o WHERE o.empresa_id = p_empresa_id`
-- sin ninguna validación previa de que p_empresa_id coincida con el caller.
--
-- CASOS REVISADOS Y DESCARTADOS (no requieren cambio):
-- - crear_nota_debito, usar_caea_en_venta, reencolar_caes_pendientes,
--   insertar_movimiento_bancario_externo, fecha_en_periodo_cerrado, seed_plan_cuentas,
--   siguiente_numero_documento: guard correcto tal cual está.
-- - seed_maestros_default / seed_series_numeracion: el guard tiene una excepción cuando
--   profile.empresa_id del caller es NULL — ES INTENCIONAL: se disparan desde un trigger
--   `AFTER INSERT ON empresas` (dentro de create_tenant) en el instante en que el perfil
--   TODAVÍA no tiene empresa_id asignado. Sacar la excepción rompe el alta de toda empresa
--   nueva. Riesgo residual: mínimo (solo permite insertar filas default no sensibles con
--   ON CONFLICT DO NOTHING, nunca pisa datos reales). NO SE TOCA.
-- - check_rate_limit / record_attempt: no manejan datos de tenant expuestos (rate limiting
--   por identifier, no por empresa). Sin impacto explotable. NO SE TOCA.
-- - create_tenant: auto-scoped a auth.uid(), no puede targetear otra empresa. NO SE TOCA.
--
-- ROLLBACK: recrear calcular_ofertas_carrito sin el guard (ver git history de este archivo).

CREATE OR REPLACE FUNCTION public.calcular_ofertas_carrito(
  p_empresa_id uuid,
  p_items jsonb,
  p_medio_pago character varying DEFAULT NULL,
  p_total_carrito numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
        o.producto_id IS NULL
        OR o.producto_id = (v_item->>'producto_id')::uuid
        OR (
          o.categoria_nombre IS NOT NULL AND
          LOWER(o.categoria_nombre) = LOWER(v_item->>'categoria_nombre')
        )
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
$$;
