-- Migration 387 -- Listas de Precio, Fase A: listas "por Factor" (costo × margen).
--
-- Pedido de Luciano (02/09), investigado contra SAP Business One antes de
-- diseñar (Último Precio de Compra + listas vinculadas por Factor —
-- https://community.sap.com/.../price-lists-in-sap-business-one). Hoy
-- listas_precio solo soporta el modelo "fija" (precio cargado a mano por
-- producto, mig.021). Se agrega un segundo tipo: "factor", donde el precio
-- de cada producto sale de `productos.costo_compra * factor`, con el factor
-- definido por categoría (`lista_precio_factores_categoria`) y un factor
-- "por defecto" (categoria_id NULL) para productos sin categoría o
-- categorías sin factor propio. Objetivo de fondo: que actualizar precios
-- ante inflación sea un solo número por categoría, no producto por producto.
--
-- Esta migración NO conecta nada más todavía (ni Modo Caja, ni un recálculo
-- automático en cada compra) -- eso son las Fases B/C/D del plan, a
-- construir después. Acá solo el motor: crear una lista "por factor",
-- cargar sus factores, y un botón de "Recalcular precios" (mismo patrón
-- preview/aplicar que ajustar_precios_masivo, mig.290) que escribe en
-- lista_precio_items -- así el resto del sistema (incluida la resolución
-- que ya existe en Convertir Cotización→Venta) no necesita saber si el
-- precio vino de una lista fija o de un cálculo por factor.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.recalcular_precios_lista_factor(uuid, boolean);
--   DROP TABLE IF EXISTS public.lista_precio_factores_categoria;
--   ALTER TABLE public.listas_precio DROP COLUMN IF EXISTS tipo;

-- ═══════════════════════════════════════════════════════════════════════
-- 1) Tipo de lista
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.listas_precio
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'fija' CHECK (tipo IN ('fija', 'factor'));

COMMENT ON COLUMN public.listas_precio.tipo IS
  'fija: precio cargado a mano por producto (lista_precio_items). '
  'factor: precio = productos.costo_compra * factor de su categoría '
  '(lista_precio_factores_categoria) -- se recalcula con el botón '
  '"Recalcular precios", que igual termina escribiendo en lista_precio_items.';

-- ═══════════════════════════════════════════════════════════════════════
-- 2) Factor por categoría (categoria_id NULL = factor por defecto de la lista)
-- ═══════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.lista_precio_factores_categoria (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lista_precio_id  UUID NOT NULL REFERENCES public.listas_precio(id) ON DELETE CASCADE,
  empresa_id       UUID NOT NULL,
  categoria_id     UUID REFERENCES public.categorias(id) ON DELETE CASCADE,
  factor           NUMERIC(6, 4) NOT NULL CHECK (factor > 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lista_precio_id, categoria_id)
);

-- Un solo factor "por defecto" (categoria_id NULL) por lista -- UNIQUE de
-- arriba no alcanza porque Postgres trata NULL <> NULL en constraints
-- normales; hace falta un índice parcial.
CREATE UNIQUE INDEX IF NOT EXISTS idx_factor_categoria_default_unico
  ON public.lista_precio_factores_categoria (lista_precio_id) WHERE categoria_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_factor_categoria_lista
  ON public.lista_precio_factores_categoria (lista_precio_id);

ALTER TABLE public.lista_precio_factores_categoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa_lista_precio_factores" ON public.lista_precio_factores_categoria;
CREATE POLICY "empresa_lista_precio_factores" ON public.lista_precio_factores_categoria
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

DROP TRIGGER IF EXISTS audit_lista_precio_factores_categoria ON public.lista_precio_factores_categoria;
CREATE TRIGGER audit_lista_precio_factores_categoria
  AFTER INSERT OR UPDATE OR DELETE ON public.lista_precio_factores_categoria
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

-- ═══════════════════════════════════════════════════════════════════════
-- 3) Recalcular precios de una lista "por factor" -- mismo patrón
--    preview/aplicar que ajustar_precios_masivo (mig.290): p_aplicar=false
--    no escribe nada, p_aplicar=true hace upsert real con el MISMO cálculo.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.recalcular_precios_lista_factor(
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

  SELECT tipo INTO v_tipo FROM public.listas_precio
  WHERE id = p_lista_precio_id AND empresa_id = v_empresa_id;

  IF v_tipo IS NULL THEN
    RAISE EXCEPTION 'Lista de precios no encontrada o sin permiso: %', p_lista_precio_id;
  END IF;
  IF v_tipo <> 'factor' THEN
    RAISE EXCEPTION 'Esta lista es de tipo "%", no "factor" -- el recálculo solo aplica a listas por factor', v_tipo;
  END IF;

  WITH base AS (
    SELECT
      p.id AS producto_id,
      p.nombre,
      p.costo_compra,
      COALESCE(lpi.precio, p.precio_venta) AS precio_actual,
      -- Factor de la categoría del producto; si no hay uno específico, el
      -- factor "por defecto" (categoria_id NULL) de la misma lista. Si el
      -- producto no tiene categoría, la primera búsqueda no encuentra nada
      -- (categoria_id = NULL nunca es true en SQL) y cae directo al default.
      COALESCE(
        (SELECT fc.factor FROM public.lista_precio_factores_categoria fc
          WHERE fc.lista_precio_id = p_lista_precio_id AND fc.categoria_id = p.categoria_id),
        (SELECT fd.factor FROM public.lista_precio_factores_categoria fd
          WHERE fd.lista_precio_id = p_lista_precio_id AND fd.categoria_id IS NULL)
      ) AS factor_aplicado
    FROM public.productos p
    LEFT JOIN public.lista_precio_items lpi
      ON lpi.producto_id = p.id AND lpi.lista_precio_id = p_lista_precio_id
    WHERE p.empresa_id = v_empresa_id AND p.activo = true
  ),
  calculado AS (
    -- Productos sin ningún factor aplicable (ni de su categoría ni el
    -- default) quedan afuera del resultado -- no hay con qué calcularles
    -- precio, mejor no incluirlos que inventar un valor.
    SELECT producto_id, nombre, costo_compra, precio_actual, factor_aplicado,
           ROUND(costo_compra * factor_aplicado, 2) AS precio_nuevo
    FROM base
    WHERE factor_aplicado IS NOT NULL
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'producto_id', producto_id,
      'nombre', nombre,
      'costo_compra', costo_compra,
      'factor_aplicado', factor_aplicado,
      'precio_actual', precio_actual,
      'precio_nuevo', precio_nuevo
    ) ORDER BY nombre
  )
  INTO v_resultado
  FROM calculado;

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

GRANT EXECUTE ON FUNCTION public.recalcular_precios_lista_factor(UUID, BOOLEAN) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.recalcular_precios_lista_factor(UUID, BOOLEAN) FROM PUBLIC, anon;
