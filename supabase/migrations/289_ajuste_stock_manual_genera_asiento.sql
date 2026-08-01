-- migration 289 — Ajuste manual de stock ahora genera asiento contable
--
-- HALLAZGO (auditoría de Inventario/COGS, continuación de mig.287/288):
-- `ajustar_stock_manual` (mig.059) cambia `productos.stock_actual` y registra
-- en `movimientos_inventario`, pero nunca generaba ningún asiento — igual que
-- el gap de COGS en ventas, pero para ajustes manuales (rotura, faltante,
-- corrección de inventario físico). Decisión de negocio (Luciano): SIEMPRE
-- generar asiento, sin distinguir motivo por ahora.
--
-- Fix: `ajustar_stock_manual` ahora devuelve jsonb con el delta de stock y el
-- costo unitario del producto, para que el frontend (asientosAutoService,
-- patrón idéntico a Ventas/NC) genere el asiento — no bloqueante, mismo
-- criterio que el resto del sistema.
--   Faltante (stock baja): Debe 5.8 Otros Gastos / Haber 1.1.3 Mercaderías-Inventario
--   Sobrante (stock sube): Debe 1.1.3 Mercaderías-Inventario / Haber 4.3 Otros Ingresos

-- CREATE OR REPLACE no permite cambiar el tipo de retorno (void -> jsonb)
DROP FUNCTION IF EXISTS public.ajustar_stock_manual(uuid, text, integer, text);

CREATE FUNCTION public.ajustar_stock_manual(
  p_producto_id uuid,
  p_tipo text,
  p_cantidad integer,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_stock_actual integer;
  v_nuevo_stock integer;
  v_costo_unitario numeric;
BEGIN
  v_empresa_id := get_my_empresa_id();

  IF p_tipo NOT IN ('entrada', 'salida', 'ajuste') THEN
    RAISE EXCEPTION 'Tipo de movimiento inválido: %', p_tipo;
  END IF;

  IF p_cantidad < 0 THEN
    RAISE EXCEPTION 'Cantidad inválida: %', p_cantidad;
  END IF;

  SELECT stock_actual, costo_compra INTO v_stock_actual, v_costo_unitario
  FROM public.productos
  WHERE id = p_producto_id AND empresa_id = v_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', p_producto_id;
  END IF;

  IF p_tipo = 'entrada' THEN
    v_nuevo_stock := v_stock_actual + p_cantidad;
  ELSIF p_tipo = 'salida' THEN
    v_nuevo_stock := v_stock_actual - p_cantidad;
  ELSE
    v_nuevo_stock := p_cantidad; -- ajuste: valor absoluto (inventario físico)
  END IF;

  IF v_nuevo_stock < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente para el producto: %', p_producto_id;
  END IF;

  UPDATE public.productos
  SET stock_actual = v_nuevo_stock
  WHERE id = p_producto_id;

  INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
  VALUES (v_empresa_id, p_producto_id, p_tipo, p_cantidad, p_motivo, auth.uid());

  RETURN jsonb_build_object(
    'delta', v_nuevo_stock - v_stock_actual,
    'costo_unitario', COALESCE(v_costo_unitario, 0)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.ajustar_stock_manual(uuid, text, integer, text) TO authenticated;

-- ROLLBACK (comentado): CREATE OR REPLACE ajustar_stock_manual con el body
-- previo a esta migration (RETURNS void, sin el jsonb de delta/costo).
