-- 413 — Una compra anulada no es deuda pendiente
--
-- Hallazgo nuevo al armar el reporte de conciliación (auditoría 24/09, CON-5). La vista `compras_saldo_pendiente`
-- (los «Open Items» de proveedores) ponía saldo 0 solo a las compras `pagada`; a una `anulada` le dejaba
-- `total - imputado`, o sea que una factura anulada figuraba como deuda pendiente. Las 4 pantallas que leen
-- la vista (Registrar Pago, Orden de Pago masiva, Antigüedad de saldos en Proveedores y el reporte de Proveedores)
-- filtran solo por `saldo_pendiente > 0`, así que una compra anulada aparecía para pagarse y engordaba el aging.
-- Hoy hay 2 compras anuladas (Nalux, $ 1.331 en total) en esa situación; era una de las «tres cifras distintas»
-- de Cuentas a Pagar que mostraba la auditoría.
--
-- Arreglo: el saldo es 0 también para las anuladas. Todo lo demás de la vista queda igual: mismas columnas y orden,
-- `security_invoker` (obligatorio repetirlo: un CREATE OR REPLACE VIEW sin la opción la pierde) y los mismos permisos
-- (un REPLACE los conserva).

CREATE OR REPLACE VIEW public.compras_saldo_pendiente
WITH (security_invoker = true) AS
SELECT co.id AS compra_id,
       co.empresa_id,
       co.proveedor_id,
       co.total,
       COALESCE(i.total_imputado, (0)::numeric) AS total_imputado,
       CASE
         WHEN co.estado_pago IN ('pagada', 'anulada') THEN (0)::numeric
         ELSE (co.total - COALESCE(i.total_imputado, (0)::numeric))
       END AS saldo_pendiente,
       co.moneda,
       co.tipo_cambio_tasa,
       co.monto_moneda_original
FROM public.compras co
LEFT JOIN (
  SELECT cuenta_corriente_proveedores_imputaciones.factura_compra_id,
         sum(cuenta_corriente_proveedores_imputaciones.monto) AS total_imputado
  FROM public.cuenta_corriente_proveedores_imputaciones
  GROUP BY cuenta_corriente_proveedores_imputaciones.factura_compra_id
) i ON i.factura_compra_id = co.id;
