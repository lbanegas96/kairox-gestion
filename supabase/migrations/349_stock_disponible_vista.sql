-- mig.349 — Stock Comprometido (Fase 1: sólo Factura de Reserva), a pedido de Nadia/Luciano.
--
-- CONTEXTO: la "Factura de Reserva" (mig.328) evita descontar stock dos veces al facturar un
-- Pedido antes de generar la Entrega, pero no reserva nada de verdad — ese stock sigue
-- apareciendo 100% libre para cualquier otra venta mientras tanto. Ver PLAN_STOCK_COMPROMETIDO.md.
--
-- DECISIÓN (Nadia + Luciano, 24/08): el compromiso BLOQUEA la venta a otra persona (no es un
-- simple aviso), sólo cuenta desde que se factura (no desde el Pedido confirmado sin facturar), y
-- por ahora sólo cubre Factura de Reserva — Órdenes de Compra/Recepción quedan para una fase 2.
--
-- DISEÑO: "comprometido" se CALCULA, no se guarda en una columna aparte — evita el riesgo de que
-- quede desincronizada si alguien agrega código nuevo que toque comprobante_items sin acordarse
-- de mantenerla (mismo tipo de bug que ya pasó con comprobantes.neto_gravado/iva_discriminado en
-- NULL para facturas viejas). Comprometido = suma de comprobante_items.cantidad -
-- cantidad_entregada, de facturas (tipo='venta') no canceladas, para lo que aún no se entregó.
--
-- LIMPIEZA DE DATOS (una sola vez, no repetible en el sentido de que ya no debería encontrar
-- filas después de esto): antes de esta migración, 81 líneas de comprobante_items quedaban con
-- cantidad_entregada < cantidad sin ser reservas reales (ninguna tenía pedido_id — una Factura de
-- Reserva real SIEMPRE requiere un Pedido, ver crear_venta) — eran datos de prueba de los
-- primeros meses del proyecto (jun-ago/2026, antes de que este concepto existiera), nunca hubo
-- uso real todavía (app no está en producción comercial). Confirmado con Nadia: se marcan como ya
-- entregadas (cantidad_entregada = cantidad) para no bloquear productos reales por ruido viejo —
-- ej. "Batidora Eléctrica" quedaba con stock_disponible = -15 por 20 unidades "comprometidas" de
-- ventas de prueba de junio. Quedan sólo 3 productos con compromiso real después de la limpieza:
-- Lapicera (1), Mate (3), Termo Stanley 1L Original (1) — las 2 Facturas de Reserva reales del
-- 15/08 y 18/08, ambas con pedido_id real.

UPDATE public.comprobante_items ci
SET cantidad_entregada = ci.cantidad
FROM public.comprobantes c
WHERE c.id = ci.comprobante_id
  AND c.tipo = 'venta' AND c.estado_pago <> 'cancelada'
  AND ci.cantidad > COALESCE(ci.cantidad_entregada, 0)
  AND c.pedido_id IS NULL;

-- security_invoker=true a propósito — mismo motivo que mig.340 (v_saldo_proveedores): sin esto,
-- la vista corre con privilegios del dueño (postgres), no del usuario que consulta, y se salta el
-- RLS de productos/comprobantes/comprobante_items por completo.
CREATE OR REPLACE VIEW public.productos_stock_disponible
WITH (security_invoker = true) AS
SELECT
  p.id AS producto_id,
  p.empresa_id,
  p.stock_actual,
  COALESCE(cmt.cantidad, 0) AS stock_comprometido,
  p.stock_actual - COALESCE(cmt.cantidad, 0) AS stock_disponible
FROM public.productos p
LEFT JOIN (
  SELECT ci.producto_id, ci.empresa_id,
         SUM(ci.cantidad - COALESCE(ci.cantidad_entregada, 0)) AS cantidad
  FROM public.comprobante_items ci
  JOIN public.comprobantes c ON c.id = ci.comprobante_id
  WHERE c.tipo = 'venta' AND c.estado_pago <> 'cancelada'
    AND ci.cantidad > COALESCE(ci.cantidad_entregada, 0)
  GROUP BY ci.producto_id, ci.empresa_id
) cmt ON cmt.producto_id = p.id AND cmt.empresa_id = p.empresa_id;
