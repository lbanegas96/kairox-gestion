-- =============================================================================
-- MIGRATION 049 — Método de Valoración de Stock (Último Costo / Promedio Ponderado)
-- =============================================================================
-- Agrega la configuración por empresa y centraliza en una única función SQL el
-- cálculo del nuevo `productos.costo_compra` tras una compra. Esa función la
-- reutilizan los DOS puntos reales donde hoy se escribe costo_compra:
--   1. fn_oc_update_stock()      — trigger de recepción de Órdenes de Compra
--   2. aplicar_compra_producto() — RPC nueva, usada por CompraRapidaSection
--      (flujo "Nueva Compra"; reemplaza el fetch+update manual desde el frontend)
--
-- NO escriben costo_compra (confirmado por inspección, solo lo leen para
-- prefill/display): NuevaFacturaProveedorModal.jsx, OrdenesCompraSection.jsx
-- (creación de OC). El modal de EDICIÓN de una compra ya registrada
-- (CompraRapidaSection → handleSaveEdit) sigue actualizando costo_compra con el
-- valor editado tal cual (semántica "último costo" fija) — un ajuste retroactivo
-- de una compra pasada no es una "nueva entrada de stock" y no tiene una
-- definición no ambigua bajo PPP, así que se deja fuera de propósito.
-- =============================================================================

-- 1. Configuración por empresa -------------------------------------------------
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS metodo_valoracion_stock TEXT NOT NULL DEFAULT 'ultimo_costo';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_metodo_valoracion_stock'
  ) THEN
    ALTER TABLE public.empresas
      ADD CONSTRAINT chk_metodo_valoracion_stock
      CHECK (metodo_valoracion_stock IN ('ultimo_costo', 'promedio_ponderado'));
  END IF;
END $$;
-- 'fifo' queda deliberadamente AFUERA del CHECK: es el próximo método a habilitar
-- (Fase B del roadmap de Inventario), pero todavía no tiene lógica de capas/lotes
-- de costo implementada. Cuando se implemente, agregar 'fifo' al CHECK arriba.

COMMENT ON COLUMN public.empresas.metodo_valoracion_stock IS
  'Método para recalcular productos.costo_compra al comprar. Activos: ultimo_costo, promedio_ponderado. Próximo a habilitar (no implementado): fifo.';

-- 2. Calculadora centralizada (pura, sin acceso a tablas) ---------------------
CREATE OR REPLACE FUNCTION public.fn_calcular_costo_valoracion(
  p_metodo TEXT,
  p_stock_previo NUMERIC,
  p_costo_previo NUMERIC,
  p_cantidad NUMERIC,
  p_costo_nuevo NUMERIC
) RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_metodo = 'promedio_ponderado' THEN
    IF COALESCE(p_stock_previo, 0) + COALESCE(p_cantidad, 0) = 0 THEN
      RETURN p_costo_nuevo;
    END IF;
    RETURN (COALESCE(p_stock_previo, 0) * COALESCE(p_costo_previo, 0)
            + COALESCE(p_cantidad, 0) * COALESCE(p_costo_nuevo, 0))
           / (COALESCE(p_stock_previo, 0) + COALESCE(p_cantidad, 0));
  END IF;

  -- 'ultimo_costo' (y cualquier valor no reconocido, por seguridad) = comportamiento histórico
  RETURN p_costo_nuevo;
END;
$$;

-- 3. RPC atómica para el flujo "Nueva Compra" (frontend) -----------------------
-- Reemplaza el patrón fetch-stock + update manual de CompraRapidaSection.jsx.
-- Hace fetch del stock/costo PREVIOS a la operación, calcula el nuevo costo según
-- el método configurado, y aplica stock+costo en una sola transacción atómica.
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

  RETURN v_costo_final;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aplicar_compra_producto(UUID, NUMERIC, NUMERIC) TO authenticated;

-- 4. Trigger de recepción de OC — ahora respeta metodo_valoracion_stock --------
-- Mismo comportamiento que antes (migration 003) cuando metodo = 'ultimo_costo';
-- usa fn_calcular_costo_valoracion en vez de pisar costo_compra directo.
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
  END IF;
  RETURN NEW;
END;
$$;
