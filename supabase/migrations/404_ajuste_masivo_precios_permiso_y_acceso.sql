-- 404 — Ajuste masivo de precios: permiso de módulo y sin acceso público
--
-- Auditoría 24/09/2026, hallazgo SEG-4. Las dos funciones de ajuste masivo de precios son
-- SECURITY DEFINER (saltean el RLS) y no chequeaban el permiso de módulo:
--   - `ajustar_precios_masivo_catalogo` (precio de venta base de los productos): además tenía
--     EXECUTE para PUBLIC (o sea, también para `anon`). Sin sesión era inerte porque
--     `get_my_empresa_id()` devuelve NULL, pero rompe la regla del proyecto (REVOKE FROM PUBLIC).
--   - `ajustar_precios_masivo` (precios de una lista): mismo faltante de permiso.
-- Consecuencia: cualquier usuario de la empresa, aunque no tenga el módulo, podía cambiar todos
-- los precios llamando a la función por API.
--
-- Arreglo (cuerpo idéntico + los chequeos): exige sesión con empresa y el permiso del módulo que
-- ya exige el RLS de las tablas que modifican (`productos` y `clientes` = Listas de Precios, ver
-- Sidebar.jsx). Firma, DEFAULTs, tipo de retorno y search_path se conservan.

CREATE OR REPLACE FUNCTION public.ajustar_precios_masivo_catalogo(
  p_tipo_ajuste text,
  p_valor numeric,
  p_categoria_id uuid DEFAULT NULL::uuid,
  p_busqueda text DEFAULT NULL::text,
  p_redondeo text DEFAULT 'ninguno'::text,
  p_aplicar boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
  v_resultado jsonb;
BEGIN
  v_empresa_id := get_my_empresa_id();
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF NOT has_module_permission('productos') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo productos';
  END IF;

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
$$;

CREATE OR REPLACE FUNCTION public.ajustar_precios_masivo(
  p_lista_precio_id uuid,
  p_tipo_ajuste text,
  p_valor numeric,
  p_categoria_id uuid DEFAULT NULL::uuid,
  p_busqueda text DEFAULT NULL::text,
  p_redondeo text DEFAULT 'ninguno'::text,
  p_aplicar boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
  v_resultado jsonb;
BEGIN
  v_empresa_id := get_my_empresa_id();
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF NOT has_module_permission('clientes') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo clientes (listas de precios)';
  END IF;

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
$$;

-- Solo usuarios con sesión: sin acceso público ni anónimo.
REVOKE ALL ON FUNCTION public.ajustar_precios_masivo_catalogo(text, numeric, uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_precios_masivo_catalogo(text, numeric, uuid, text, text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.ajustar_precios_masivo(uuid, text, numeric, uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_precios_masivo(uuid, text, numeric, uuid, text, text, boolean) TO authenticated;
