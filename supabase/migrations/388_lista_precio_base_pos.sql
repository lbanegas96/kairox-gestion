-- Migration 388 -- Listas de Precio, Fase B: lista "base" para Modo Caja +
-- recálculo automático del precio de venta en cada compra.
--
-- Sigue a la Fase A (mig.387, listas "por Factor"). Acá se conecta el motor
-- de esa fase al catálogo real: se marca UNA lista (tipo 'factor') como
-- "lista base" de la empresa (empresas.lista_precio_base_id). A partir de
-- ese momento, cada vez que costo_compra de un producto cambia por una
-- compra real -- los DOS puntos donde eso pasa hoy, fn_oc_update_stock()
-- (recepción de OC, mig.049) y aplicar_compra_producto() (Compra Rápida,
-- mig.049) -- su precio_venta se recalcula solo (costo × factor de su
-- categoría en la lista base). Objetivo de Luciano: no tener que tocar
-- precio_venta a mano después de cada compra.
--
-- Distinto de recalcular_precios_lista_factor (Fase A): esa función escribe
-- en lista_precio_items (para listas secundarias tipo Mayorista/VIP, sin
-- tocar el catálogo). Acá, al ser LA lista base, el resultado va directo a
-- productos.precio_venta -- es el precio estándar que ve todo el sistema
-- por defecto.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.recalcular_catalogo_lista_base(uuid, boolean);
--   DROP FUNCTION IF EXISTS public.fn_recalcular_precio_venta_por_lista_base(uuid, numeric);
--   (recrear fn_oc_update_stock/aplicar_compra_producto con el texto de mig.049)
--   ALTER TABLE public.empresas DROP COLUMN IF EXISTS lista_precio_base_id;

-- ═══════════════════════════════════════════════════════════════════════
-- 1) Config: qué lista es "la base" (NULL = apagado, comportamiento actual)
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS lista_precio_base_id UUID REFERENCES public.listas_precio(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.empresas.lista_precio_base_id IS
  'Lista de precios (tipo factor) que alimenta productos.precio_venta automáticamente '
  'en cada compra. NULL = apagado, precio_venta se sigue editando a mano como siempre.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2) Helper interno -- recalcula el precio_venta de UN producto según la
--    lista base de su empresa. No hace nada si no hay lista base, o si esa
--    lista no tiene factor aplicable para este producto (ni de su categoría
--    ni el default) -- mismo criterio "no inventar un valor" de la Fase A.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_recalcular_precio_venta_por_lista_base(
  p_producto_id UUID,
  p_costo_nuevo NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id    UUID;
  v_categoria_id  UUID;
  v_lista_base_id UUID;
  v_factor        NUMERIC;
BEGIN
  SELECT empresa_id, categoria_id INTO v_empresa_id, v_categoria_id
  FROM public.productos WHERE id = p_producto_id;

  IF v_empresa_id IS NULL THEN RETURN; END IF;

  SELECT lista_precio_base_id INTO v_lista_base_id
  FROM public.empresas WHERE id = v_empresa_id;

  IF v_lista_base_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(
    (SELECT fc.factor FROM public.lista_precio_factores_categoria fc
      WHERE fc.lista_precio_id = v_lista_base_id AND fc.categoria_id = v_categoria_id),
    (SELECT fd.factor FROM public.lista_precio_factores_categoria fd
      WHERE fd.lista_precio_id = v_lista_base_id AND fd.categoria_id IS NULL)
  ) INTO v_factor;

  IF v_factor IS NULL THEN RETURN; END IF;

  UPDATE public.productos
  SET precio_venta = ROUND(p_costo_nuevo * v_factor, 2)
  WHERE id = p_producto_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_recalcular_precio_venta_por_lista_base(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3) Enganchar el helper en los 2 puntos reales donde se escribe
--    costo_compra hoy (mismo texto de mig.049 + una línea al final).
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.aplicar_compra_producto(
  p_producto_id UUID,
  p_cantidad NUMERIC,
  p_costo_nuevo NUMERIC
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id   UUID;
  v_stock_previo NUMERIC;
  v_costo_previo NUMERIC;
  v_metodo       TEXT;
  v_costo_final  NUMERIC;
BEGIN
  SELECT empresa_id, stock_actual, costo_compra
    INTO v_empresa_id, v_stock_previo, v_costo_previo
  FROM public.productos
  WHERE id = p_producto_id AND empresa_id = get_my_empresa_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', p_producto_id;
  END IF;

  SELECT metodo_valoracion_stock INTO v_metodo
  FROM public.empresas WHERE id = v_empresa_id;

  v_costo_final := public.fn_calcular_costo_valoracion(
    COALESCE(v_metodo, 'ultimo_costo'), v_stock_previo, v_costo_previo, p_cantidad, p_costo_nuevo
  );

  UPDATE public.productos
  SET stock_actual = COALESCE(stock_actual, 0) + p_cantidad,
      costo_compra  = v_costo_final
  WHERE id = p_producto_id;

  -- Fase B: si hay una lista base configurada, el precio de venta se
  -- recalcula solo con el costo nuevo.
  PERFORM public.fn_recalcular_precio_venta_por_lista_base(p_producto_id, v_costo_final);

  RETURN v_costo_final;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_oc_update_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  delta          NUMERIC;
  v_stock_previo NUMERIC;
  v_costo_previo NUMERIC;
  v_metodo       TEXT;
  v_costo_final  NUMERIC;
BEGIN
  delta := NEW.cantidad_recibida - OLD.cantidad_recibida;
  IF delta > 0 AND NEW.producto_id IS NOT NULL THEN
    SELECT stock_actual, costo_compra INTO v_stock_previo, v_costo_previo
    FROM public.productos WHERE id = NEW.producto_id;

    SELECT metodo_valoracion_stock INTO v_metodo
    FROM public.empresas WHERE id = NEW.empresa_id;

    v_costo_final := public.fn_calcular_costo_valoracion(
      COALESCE(v_metodo, 'ultimo_costo'), COALESCE(v_stock_previo, 0), COALESCE(v_costo_previo, 0),
      delta, NEW.costo_unitario
    );

    UPDATE public.productos
    SET stock_actual = COALESCE(stock_actual, 0) + delta,
        costo_compra  = v_costo_final
    WHERE id = NEW.producto_id;

    -- Fase B: idem aplicar_compra_producto.
    PERFORM public.fn_recalcular_precio_venta_por_lista_base(NEW.producto_id, v_costo_final);
  END IF;
  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 4) Recalcular TODO el catálogo de una vez -- para cuando se activa la
--    lista base por primera vez (decisión de Luciano: recalcular todo el
--    catálogo activo en ese momento, y de ahí en más se mantiene solo con
--    cada compra vía el helper de arriba). Mismo patrón preview/aplicar de
--    siempre, pero escribe en productos.precio_venta directo, no en
--    lista_precio_items -- es LA lista base, no una secundaria.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.recalcular_catalogo_lista_base(
  p_lista_precio_id UUID,
  p_aplicar BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id UUID;
  v_tipo       TEXT;
  v_resultado  JSONB;
BEGIN
  v_empresa_id := get_my_empresa_id();

  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado: recalcular el catálogo completo requiere rol admin';
  END IF;

  SELECT tipo INTO v_tipo FROM public.listas_precio
  WHERE id = p_lista_precio_id AND empresa_id = v_empresa_id;

  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'Lista de precios no encontrada o sin permiso: %', p_lista_precio_id;
  END IF;
  IF v_tipo <> 'factor' THEN
    RAISE EXCEPTION 'Esta lista es de tipo "%", no "factor"', v_tipo;
  END IF;

  WITH base AS (
    SELECT
      p.id AS producto_id,
      p.nombre,
      p.costo_compra,
      p.precio_venta AS precio_actual,
      COALESCE(
        (SELECT fc.factor FROM public.lista_precio_factores_categoria fc
          WHERE fc.lista_precio_id = p_lista_precio_id AND fc.categoria_id = p.categoria_id),
        (SELECT fd.factor FROM public.lista_precio_factores_categoria fd
          WHERE fd.lista_precio_id = p_lista_precio_id AND fd.categoria_id IS NULL)
      ) AS factor_aplicado
    FROM public.productos p
    WHERE p.empresa_id = v_empresa_id AND p.activo = true
  ),
  calculado AS (
    SELECT producto_id, nombre, costo_compra, precio_actual, factor_aplicado,
           ROUND(costo_compra * factor_aplicado, 2) AS precio_nuevo
    FROM base
    WHERE factor_aplicado IS NOT NULL
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'producto_id', producto_id, 'nombre', nombre, 'costo_compra', costo_compra,
      'factor_aplicado', factor_aplicado, 'precio_actual', precio_actual, 'precio_nuevo', precio_nuevo
    ) ORDER BY nombre
  )
  INTO v_resultado
  FROM calculado;

  v_resultado := COALESCE(v_resultado, '[]'::jsonb);

  IF p_aplicar THEN
    UPDATE public.productos p
    SET precio_venta = (item->>'precio_nuevo')::numeric
    FROM jsonb_array_elements(v_resultado) AS item
    WHERE p.id = (item->>'producto_id')::uuid;
  END IF;

  RETURN jsonb_build_object('items', v_resultado, 'aplicado', p_aplicar);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.recalcular_catalogo_lista_base(UUID, BOOLEAN) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.recalcular_catalogo_lista_base(UUID, BOOLEAN) FROM PUBLIC, anon;
