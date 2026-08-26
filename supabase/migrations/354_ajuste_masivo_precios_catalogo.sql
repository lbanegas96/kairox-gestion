-- migration 354 — Ajuste masivo de precios sobre el catálogo base (productos.precio_venta)
--
-- Pedido de Nadia (26/08): aumento general de precios por inflación. Las Listas de Precio
-- (mig.290) ya tienen "Ajuste masivo", pero ese RPC sólo toca `lista_precio_items` — en Nalux
-- real las 3 listas existentes (Cliente VIP, Mayorista, Precio VIP) cubren 2-4 productos cada
-- una, mientras que el catálogo tiene 68 productos activos. La inmensa mayoría de las ventas usa
-- `productos.precio_venta` directo, no una lista — por eso hace falta un RPC hermano que ajuste
-- ESE precio, no el de una lista.
--
-- Mismo patrón que ajustar_precios_masivo (mig.290): preview (p_aplicar=false, no escribe nada)
-- y aplicar (p_aplicar=true, UPDATE real) comparten el mismo cálculo, para que preview y
-- resultado nunca diverjan. Filtrable por categoría/búsqueda, con el mismo soporte de redondeo.
--
-- DIFERENCIA a propósito vs mig.290: excluye productos con precio_venta = 0. En Nalux real
-- 50 de 68 productos activos están en $0 (import de Open Food Facts del 19/08, precio pendiente
-- de carga manual, ver CONTEXT.md) — un "aumento por inflación" sobre $0 sigue siendo $0
-- matemáticamente, PERO el redondeo 'terminar_99' (FLOOR(0/100)*100+99) los convertiría en $99
-- de la nada, que no es un aumento real sino un precio inventado. Se filtran en el WHERE en vez
-- de dejar que el usuario se encuentre 50 "aumentos" de $0→$99 en el preview.

CREATE OR REPLACE FUNCTION public.ajustar_precios_masivo_catalogo(
  p_tipo_ajuste text,        -- 'porcentaje' | 'monto_fijo'
  p_valor numeric,           -- ej 10 = +10% ó +$10 según tipo (negativo = baja)
  p_categoria_id uuid DEFAULT NULL,
  p_busqueda text DEFAULT NULL,
  p_redondeo text DEFAULT 'ninguno',  -- 'ninguno' | 'decena' | 'centena' | 'terminar_99'
  p_aplicar boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_resultado jsonb;
BEGIN
  v_empresa_id := get_my_empresa_id();

  IF p_tipo_ajuste NOT IN ('porcentaje', 'monto_fijo') THEN
    RAISE EXCEPTION 'Tipo de ajuste inválido: %', p_tipo_ajuste;
  END IF;

  IF p_redondeo NOT IN ('ninguno', 'decena', 'centena', 'terminar_99') THEN
    RAISE EXCEPTION 'Redondeo inválido: %', p_redondeo;
  END IF;

  WITH base AS (
    SELECT
      p.id AS producto_id,
      p.nombre,
      p.precio_venta AS precio_actual
    FROM public.productos p
    WHERE p.empresa_id = v_empresa_id
      AND p.activo = true
      AND p.precio_venta > 0
      AND (p_categoria_id IS NULL OR p.categoria_id = p_categoria_id)
      AND (p_busqueda IS NULL OR p_busqueda = '' OR p.nombre ILIKE '%' || p_busqueda || '%')
  ),
  calculado AS (
    SELECT
      producto_id,
      nombre,
      precio_actual,
      GREATEST(
        CASE p_tipo_ajuste
          WHEN 'porcentaje' THEN precio_actual * (1 + p_valor / 100.0)
          ELSE precio_actual + p_valor
        END,
        0
      ) AS precio_sin_redondeo
    FROM base
  ),
  redondeado AS (
    SELECT
      producto_id,
      nombre,
      precio_actual,
      ROUND(
        CASE p_redondeo
          WHEN 'decena' THEN ROUND(precio_sin_redondeo / 10) * 10
          WHEN 'centena' THEN ROUND(precio_sin_redondeo / 100) * 100
          WHEN 'terminar_99' THEN FLOOR(precio_sin_redondeo / 100) * 100 + 99
          ELSE precio_sin_redondeo
        END,
      2) AS precio_nuevo
    FROM calculado
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'producto_id', producto_id,
      'nombre', nombre,
      'precio_actual', precio_actual,
      'precio_nuevo', precio_nuevo
    ) ORDER BY nombre
  )
  INTO v_resultado
  FROM redondeado;

  v_resultado := COALESCE(v_resultado, '[]'::jsonb);

  IF p_aplicar THEN
    UPDATE public.productos p
    SET precio_venta = (item->>'precio_nuevo')::numeric
    FROM jsonb_array_elements(v_resultado) AS item
    WHERE p.id = (item->>'producto_id')::uuid
      AND p.empresa_id = v_empresa_id;
  END IF;

  RETURN jsonb_build_object('items', v_resultado, 'aplicado', p_aplicar);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ajustar_precios_masivo_catalogo(text, numeric, uuid, text, text, boolean) TO authenticated;

-- ROLLBACK (comentado): DROP FUNCTION public.ajustar_precios_masivo_catalogo(text, numeric, uuid, text, text, boolean);
