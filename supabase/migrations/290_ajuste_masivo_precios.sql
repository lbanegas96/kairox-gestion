-- migration 290 — Ajuste masivo de precios en una lista de precios
--
-- HALLAZGO (investigación de listas de precio, post-auditoría Inventario/COGS):
-- ListasPrecioSection permite editar el precio de cada producto SOLO uno por
-- uno. En contexto de PyME argentina (alta inflación), esto es inviable para
-- catálogos de tamaño real. Se agrega un RPC de ajuste masivo, filtrable por
-- categoría/búsqueda, con soporte de redondeo, que se puede invocar en modo
-- "preview" (p_aplicar=false, no escribe nada) o "aplicar" (p_aplicar=true,
-- hace upsert real) usando exactamente el mismo cálculo — evita que lo que el
-- usuario ve en el preview difiera de lo que efectivamente se graba.
--
-- Precio base tomado por producto: el precio ya guardado en la lista
-- (lista_precio_items.precio) si existe, si no el precio estándar
-- (productos.precio_venta) — mismo criterio que ya usa la UI hoy.

CREATE OR REPLACE FUNCTION public.ajustar_precios_masivo(
  p_lista_precio_id uuid,
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

  IF NOT EXISTS (
    SELECT 1 FROM public.listas_precio
    WHERE id = p_lista_precio_id AND empresa_id = v_empresa_id
  ) THEN
    RAISE EXCEPTION 'Lista de precios no encontrada o sin permiso: %', p_lista_precio_id;
  END IF;

  WITH base AS (
    SELECT
      p.id AS producto_id,
      p.nombre,
      COALESCE(lpi.precio, p.precio_venta) AS precio_actual
    FROM public.productos p
    LEFT JOIN public.lista_precio_items lpi
      ON lpi.producto_id = p.id AND lpi.lista_precio_id = p_lista_precio_id
    WHERE p.empresa_id = v_empresa_id
      AND p.activo = true
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
    INSERT INTO public.lista_precio_items (lista_precio_id, empresa_id, producto_id, precio)
    SELECT
      p_lista_precio_id,
      v_empresa_id,
      (item->>'producto_id')::uuid,
      (item->>'precio_nuevo')::numeric
    FROM jsonb_array_elements(v_resultado) AS item
    ON CONFLICT (lista_precio_id, producto_id)
    DO UPDATE SET precio = EXCLUDED.precio;
  END IF;

  RETURN jsonb_build_object('items', v_resultado, 'aplicado', p_aplicar);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ajustar_precios_masivo(uuid, text, numeric, uuid, text, text, boolean) TO authenticated;

-- ROLLBACK (comentado): DROP FUNCTION public.ajustar_precios_masivo(uuid, text, numeric, uuid, text, text, boolean);
