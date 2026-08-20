-- Migration 335 -- Recuento de Inventario (conteo físico masivo, estilo SAP B1
-- Inventory Counting Transaction).
--
-- Hoy `ajustar_stock_manual` (mig.289) solo ajusta UN producto a la vez y genera
-- un movimiento/asiento por cada uno. Un conteo físico real de un grupo de
-- productos necesita: (1) congelar una "hoja de conteo" con el stock del sistema
-- en ese momento, (2) cargar lo contado línea por línea, (3) aplicar TODAS las
-- diferencias de una sola vez con UN solo asiento contable (no uno por línea).
--
-- Reusa movimientos_inventario (tipo='ajuste') para cada línea con diferencia --
-- mismo ledger que ya usa ajustar_stock_manual, no se crea un sistema paralelo.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.anular_recuento_inventario(uuid);
--   DROP FUNCTION IF EXISTS public.confirmar_recuento_inventario(uuid);
--   DROP FUNCTION IF EXISTS public.crear_recuento_inventario(uuid);
--   DROP TABLE IF EXISTS public.recuento_inventario_items;
--   DROP TABLE IF EXISTS public.recuentos_inventario;

CREATE TABLE IF NOT EXISTS public.recuentos_inventario (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  numero         TEXT NOT NULL,
  fecha          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  estado         TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'confirmado', 'anulado')),
  categoria_id   UUID REFERENCES public.categorias(id) ON DELETE SET NULL, -- NULL = todo el catálogo activo
  observaciones  TEXT,
  asiento_id     UUID REFERENCES public.asientos_contables(id) ON DELETE SET NULL,
  user_id        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmado_at  TIMESTAMPTZ,
  UNIQUE (empresa_id, numero)
);

ALTER TABLE public.recuentos_inventario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recuentos_inventario_all" ON public.recuentos_inventario
  FOR ALL USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE TABLE IF NOT EXISTS public.recuento_inventario_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recuento_id        UUID NOT NULL REFERENCES public.recuentos_inventario(id) ON DELETE CASCADE,
  empresa_id         UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id        UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  stock_sistema      INTEGER NOT NULL,      -- snapshot de productos.stock_actual al generar la hoja
  costo_unitario     NUMERIC(12, 2) NOT NULL, -- snapshot de productos.costo_compra
  cantidad_contada   INTEGER,               -- NULL hasta que el usuario la carga
  CONSTRAINT chk_cantidad_contada_no_negativa CHECK (cantidad_contada IS NULL OR cantidad_contada >= 0)
);

ALTER TABLE public.recuento_inventario_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recuento_inventario_items_all" ON public.recuento_inventario_items
  FOR ALL USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_recuento_items_recuento ON public.recuento_inventario_items(recuento_id);

-- ── crear_recuento_inventario: genera la hoja de conteo (estado 'borrador') ──
CREATE OR REPLACE FUNCTION public.crear_recuento_inventario(
  p_categoria_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID := get_my_empresa_id();
  v_recuento_id UUID;
  v_numero TEXT;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_numero := obtener_proximo_numero(v_empresa_id, 'recuento_inventario');

  INSERT INTO public.recuentos_inventario (empresa_id, numero, categoria_id, user_id)
  VALUES (v_empresa_id, v_numero, p_categoria_id, auth.uid())
  RETURNING id INTO v_recuento_id;

  INSERT INTO public.recuento_inventario_items (recuento_id, empresa_id, producto_id, stock_sistema, costo_unitario)
  SELECT v_recuento_id, v_empresa_id, p.id, p.stock_actual, p.costo_compra
  FROM public.productos p
  WHERE p.empresa_id = v_empresa_id
    AND p.activo = true
    AND (p_categoria_id IS NULL OR p.categoria_id = p_categoria_id);

  RETURN v_recuento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_recuento_inventario(UUID) TO authenticated;

-- ── confirmar_recuento_inventario: aplica TODAS las diferencias de una vez ──
-- Devuelve {total_faltante, total_sobrante} en valor ($) para que el frontend
-- arme UN solo asiento (mismo patrón que crearAsientoAjusteStock en JS, pero
-- acá agregado para todo el recuento en vez de un producto).
CREATE OR REPLACE FUNCTION public.confirmar_recuento_inventario(
  p_recuento_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id UUID := get_my_empresa_id();
  v_recuento RECORD;
  v_item RECORD;
  v_diferencia INTEGER;
  v_total_faltante NUMERIC := 0;
  v_total_sobrante NUMERIC := 0;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT * INTO v_recuento FROM public.recuentos_inventario
  WHERE id = p_recuento_id AND empresa_id = v_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recuento no encontrado';
  END IF;
  IF v_recuento.estado <> 'borrador' THEN
    RAISE EXCEPTION 'El recuento ya está %', v_recuento.estado;
  END IF;
  IF fecha_en_periodo_cerrado(v_empresa_id, v_recuento.fecha::date) THEN
    RAISE EXCEPTION 'Período cerrado: la fecha % pertenece a un período contable cerrado.', v_recuento.fecha::date;
  END IF;

  FOR v_item IN
    SELECT * FROM public.recuento_inventario_items
    WHERE recuento_id = p_recuento_id
      AND cantidad_contada IS NOT NULL
      AND cantidad_contada <> stock_sistema
    FOR UPDATE
  LOOP
    v_diferencia := v_item.cantidad_contada - v_item.stock_sistema;

    UPDATE public.productos
    SET stock_actual = v_item.cantidad_contada
    WHERE id = v_item.producto_id AND empresa_id = v_empresa_id;

    INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
    VALUES (v_empresa_id, v_item.producto_id, 'ajuste', v_item.cantidad_contada,
            'Recuento ' || v_recuento.numero, auth.uid());

    IF v_diferencia < 0 THEN
      v_total_faltante := v_total_faltante + (ABS(v_diferencia) * v_item.costo_unitario);
    ELSE
      v_total_sobrante := v_total_sobrante + (v_diferencia * v_item.costo_unitario);
    END IF;
  END LOOP;

  UPDATE public.recuentos_inventario
  SET estado = 'confirmado', confirmado_at = NOW()
  WHERE id = p_recuento_id;

  RETURN jsonb_build_object(
    'total_faltante', ROUND(v_total_faltante, 2),
    'total_sobrante', ROUND(v_total_sobrante, 2)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_recuento_inventario(UUID) TO authenticated;

-- ── anular_recuento_inventario: solo si sigue en borrador (nunca tocó stock) ─
CREATE OR REPLACE FUNCTION public.anular_recuento_inventario(
  p_recuento_id UUID
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

  SELECT estado INTO v_estado FROM public.recuentos_inventario
  WHERE id = p_recuento_id AND empresa_id = v_empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recuento no encontrado';
  END IF;
  IF v_estado <> 'borrador' THEN
    RAISE EXCEPTION 'Solo se puede anular un recuento en borrador (nunca tocó stock)';
  END IF;

  UPDATE public.recuentos_inventario SET estado = 'anulado' WHERE id = p_recuento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.anular_recuento_inventario(UUID) TO authenticated;

-- ── set_asiento_recuento_inventario: el frontend arma el asiento en JS (mismo
-- patrón que asientosAutoService) y acá solo se guarda la referencia. Evita
-- que confirmar_recuento_inventario tenga que conocer las cuentas contables.
CREATE OR REPLACE FUNCTION public.set_asiento_recuento_inventario(
  p_recuento_id UUID, p_asiento_id UUID
) RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.recuentos_inventario
  SET asiento_id = p_asiento_id
  WHERE id = p_recuento_id AND empresa_id = get_my_empresa_id();
$$;

GRANT EXECUTE ON FUNCTION public.set_asiento_recuento_inventario(UUID, UUID) TO authenticated;
