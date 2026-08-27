-- migration 359 — compras_saldo_pendiente respeta compras.estado_pago = 'pagada'
--
-- HALLAZGO (Nadia, Fase 2 prueba integral Ferretería NADIA, 27/08): la vista
-- (mig.170) calcula saldo_pendiente SOLO a partir de las imputaciones en
-- cuenta_corriente_proveedores_imputaciones, ignorando compras.estado_pago por
-- completo. Una Compra Rápida pagada en el momento (Efectivo/Transferencia,
-- estado_pago='pagada' seteado directo, sin pasar por CC/imputaciones — mismo
-- patrón que una Factura de venta al contado, ver el fix del Mapa de Relaciones
-- del 27/08) sigue apareciendo con el saldo COMPLETO pendiente. Riesgo real:
-- `paymentRunService.ts` ("Pagar varias facturas") filtra directo por
-- `saldo_pendiente > 0` contra esta vista — confirmado con Bianchi Herrajes
-- ($102.000 ya pagados, seguía figurando ahí con el saldo entero).
--
-- Fix acotado: si estado_pago='pagada', saldo_pendiente=0 sin importar lo que
-- diga la suma de imputaciones (fuente de verdad más fuerte para el caso
-- "pagada" — evita el riesgo de pago duplicado). 'pendiente'/'parcial' siguen
-- calculándose igual que siempre (imputaciones reales vía CC/cheque) — compras.
-- estado_pago solo admite esos 3 valores (CHECK, mig.003), no hay 'cancelada'
-- que contemplar acá.

CREATE OR REPLACE VIEW public.compras_saldo_pendiente
WITH (security_invoker = true) AS
SELECT
  co.id           AS compra_id,
  co.empresa_id,
  co.proveedor_id,
  co.total,
  COALESCE(i.total_imputado, 0)                                          AS total_imputado,
  CASE WHEN co.estado_pago = 'pagada' THEN 0
       ELSE co.total - COALESCE(i.total_imputado, 0)
  END                                                                     AS saldo_pendiente,
  co.moneda,
  co.tipo_cambio_tasa,
  co.monto_moneda_original
FROM public.compras co
LEFT JOIN (
  SELECT factura_compra_id, SUM(monto) AS total_imputado
  FROM public.cuenta_corriente_proveedores_imputaciones
  GROUP BY factura_compra_id
) i ON i.factura_compra_id = co.id;

-- ROLLBACK (comentado): recrear la vista como en mig.170 (sin el CASE de estado_pago).
