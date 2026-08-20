-- Migration 336 -- Revalorización de Inventario (actualizar costo unitario en
-- stock + asiento por la diferencia de VALOR, estilo SAP B1 Inventory
-- Revaluation).
--
-- A diferencia del Recuento (335), esto NO es un evento físico -- no toca
-- movimientos_inventario ni productos.stock_actual, solo productos.costo_compra.
-- Regla 8 de sap-reference ("el stock se mueve en el evento físico") sigue
-- intacta: acá no hay evento físico, solo una corrección de valuación.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.anular_revalorizacion_inventario(uuid);
--   DROP FUNCTION IF EXISTS public.confirmar_revalorizacion_inventario(uuid);
--   DROP FUNCTION IF EXISTS public.crear_revalorizacion_inventario(uuid);
--   DROP FUNCTION IF EXISTS public.set_asiento_revalorizacion_inventario(uuid, uuid);
--   DROP TABLE IF EXISTS public.revalorizacion_inventario_items;
--   DROP TABLE IF EXISTS public.revalorizaciones_inventario;

CREATE TABLE IF NOT EXISTS public.revalorizaciones_inventario (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  numero         TEXT NOT NULL,
  fecha          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estado         TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'confirmado', 'anulado')),
  categoria_id   UUID REFERENCES public.categorias(id) ON DELETE SET NULL,
  observaciones  TEXT,
  asiento_id     UUID REFERENCES public.asientos_contables(id) ON DELETE SET NULL,
  user_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmado_at  TIMESTAMPTZ,
  UNIQUE (empresa_id, numero)
);

ALTER TABLE public.revalorizaciones_inventario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "revalorizaciones_inventario_all" ON public.revalorizaciones_inventario
  FOR ALL USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE TABLE IF NOT EXISTS public.revalorizacion_inventario_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revalorizacion_id  UUID NOT NULL REFERENCES public.revalorizaciones_inventario(id) ON DELETE CASCADE,
  empresa_id         UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id        UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  stock_al_momento   INTEGER NOT NULL,        -- snapshot, define cuánto pesa el cambio de costo
  costo_anterior     NUMERIC(12, 2) NOT NULL, -- snapshot de productos.costo_compra
  costo_nuevo        NUMERIC(12, 2),          -- NULL hasta que el usuario lo carga
  CONSTRAINT chk_costo_nuevo_no_negativo CHECK (costo_nuevo IS NULL OR costo_nuevo >= 0)
);

ALTER TABLE public.revalorizacion_inventario_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "revalorizacion_inventario_items_all" ON public.revalorizacion_inventario_items
  FOR ALL USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_revalorizacion_items_revalorizacion ON public.revalorizacion_inventario_items(revalorizacion_id);

-- ── crear_revalorizacion_inventario: hoja con costo actual snapshoteado ─────
CREATE OR REPLACE FUNCTION public.crear_revalorizacion_inventario(
  p_categoria_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID := get_my_empresa_id();
  v_revalorizacion_id UUID;
  v_numero TEXT;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_numero := obtener_proximo_numero(v_empresa_id, 'revalorizacion_inventario');

  INSERT INTO public.revalorizaciones_inventario (empresa_id, numero, categoria_id, user_id)
  VALUES (v_empresa_id, v_numero, p_categoria_id, auth.uid())
  RETURNING id INTO v_revalorizacion_id;

  INSERT INTO public.revalorizacion_inventario_items (revalorizacion_id, empresa_id, producto_id, stock_al_momento, costo_anterior)
  SELECT v_revalorizacion_id, v_empresa_id, p.id, p.stock_actual, p.costo_compra
  FROM public.productos p
  WHERE p.empresa_id = v_empresa_id
    AND p.activo = true
    AND (p_categoria_id IS NULL OR p.categoria_id = p_categoria_id);

  RETURN v_revalorizacion_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_revalorizacion_inventario(UUID) TO authenticated;

-- ── confirmar_revalorizacion_inventario: aplica el nuevo costo, NO toca stock ─
CREATE OR REPLACE FUNCTION public.confirmar_revalorizacion_inventario(
  p_revalorizacion_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID := get_my_empresa_id();
  v_revalorizacion RECORD;
  v_item RECORD;
  v_diferencia_unitaria NUMERIC;
  v_total_perdida NUMERIC := 0;
  v_total_ganancia NUMERIC := 0;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT * INTO v_revalorizacion FROM public.revalorizaciones_inventario
  WHERE id = p_revalorizacion_id AND empresa_id = v_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revalorización no encontrada';
  END IF;
  IF v_revalorizacion.estado <> 'borrador' THEN
    RAISE EXCEPTION 'La revalorización ya está %', v_revalorizacion.estado;
  END IF;
  IF fecha_en_periodo_cerrado(v_empresa_id, v_revalorizacion.fecha::date) THEN
    RAISE EXCEPTION 'Período cerrado: la fecha % pertenece a un período contable cerrado.', v_revalorizacion.fecha::date;
  END IF;

  FOR v_item IN
    SELECT * FROM public.revalorizacion_inventario_items
    WHERE revalorizacion_id = p_revalorizacion_id
      AND costo_nuevo IS NOT NULL
      AND costo_nuevo <> costo_anterior
    FOR UPDATE
  LOOP
    v_diferencia_unitaria := v_item.costo_nuevo - v_item.costo_anterior;

    UPDATE public.productos
    SET costo_compra = v_item.costo_nuevo
    WHERE id = v_item.producto_id AND empresa_id = v_empresa_id;

    IF v_diferencia_unitaria < 0 THEN
      v_total_perdida := v_total_perdida + (ABS(v_diferencia_unitaria) * v_item.stock_al_momento);
    ELSE
      v_total_ganancia := v_total_ganancia + (v_diferencia_unitaria * v_item.stock_al_momento);
    END IF;
  END LOOP;

  UPDATE public.revalorizaciones_inventario
  SET estado = 'confirmado', confirmado_at = NOW()
  WHERE id = p_revalorizacion_id;

  RETURN jsonb_build_object(
    'total_perdida', ROUND(v_total_perdida, 2),
    'total_ganancia', ROUND(v_total_ganancia, 2)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_revalorizacion_inventario(UUID) TO authenticated;

-- ── anular_revalorizacion_inventario: solo si sigue en borrador ─────────────
CREATE OR REPLACE FUNCTION public.anular_revalorizacion_inventario(
  p_revalorizacion_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID := get_my_empresa_id();
  v_estado TEXT;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT estado INTO v_estado FROM public.revalorizaciones_inventario
  WHERE id = p_revalorizacion_id AND empresa_id = v_empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revalorización no encontrada';
  END IF;
  IF v_estado <> 'borrador' THEN
    RAISE EXCEPTION 'Solo se puede anular una revalorización en borrador (nunca tocó costo)';
  END IF;

  UPDATE public.revalorizaciones_inventario SET estado = 'anulado' WHERE id = p_revalorizacion_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.anular_revalorizacion_inventario(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_asiento_revalorizacion_inventario(
  p_revalorizacion_id UUID, p_asiento_id UUID
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.revalorizaciones_inventario
  SET asiento_id = p_asiento_id
  WHERE id = p_revalorizacion_id AND empresa_id = get_my_empresa_id();
$$;

GRANT EXECUTE ON FUNCTION public.set_asiento_revalorizacion_inventario(UUID, UUID) TO authenticated;
