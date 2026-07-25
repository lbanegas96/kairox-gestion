-- migration 246 — facturas_saldo_pendiente excluye comprobantes ya pagados
--
-- CONTEXTO: construyendo antigüedad de saldos para el reporte de Cartera de
-- Clientes se encontró que esta vista (usada también por Cuenta Corriente >
-- Antigüedad, CuentaCorrienteSection.fetchAgingData — bug PRE-EXISTENTE, no
-- introducido en este pase) calcula saldo_pendiente para CUALQUIER venta,
-- sin chequear estado_pago. Ventas cobradas al momento (Efectivo/Tarjeta/
-- Transferencia) nunca generan fila en cuenta_corriente_movimientos ni
-- cuenta_corriente_imputaciones — nunca tuvieron ni van a tener una
-- "imputación" registrada — así que la vista las mostraba con
-- saldo_pendiente = total, como si debieran el 100%, para siempre.
--
-- Probado con datos reales de Nalux: Carlos Perez tenía ventas en Efectivo
-- (estado_pago='pagada') apareciendo como "pendientes" por su monto
-- completo. La suma de antigüedad de toda la cartera daba $4,3M cuando la
-- deuda real (clientes.saldo_actual) es $342.880.
--
-- FIX: excluir estado_pago='pagada'. Deja 'pendiente' y 'parcial' — los
-- únicos 2 estados que representan saldo real pendiente de cobro.
--
-- Validado con BEGIN...ROLLBACK contra datos reales de Nalux antes de
-- aplicar: la vista corregida ya no incluye las ventas en Efectivo/Tarjeta/
-- Transferencia de Carlos Perez.
--
-- NOTA — no es el único desajuste encontrado (ver migration siguiente/código
-- de reportería): la imputación granular a factura puntual es OPCIONAL en
-- registrar_cobro_cliente (p_imputaciones puede venir NULL — "pago
-- genérico" a cuenta sin elegir qué facturas cubre). Un cliente puede tener
-- clientes.saldo_actual correcto pero facturas_saldo_pendiente sigue
-- mostrando facturas viejas como abiertas si el cobro que las canceló nunca
-- se imputó a esa factura puntual. Esta migración NO resuelve ese segundo
-- problema (es una característica del diseño, no un bug de una línea) — el
-- reporte de Cartera de Clientes lo compensa reconciliando los buckets de
-- antigüedad contra el saldo real por cliente (ver reportDefinitions.jsx /
-- ReportesSection.jsx).

CREATE OR REPLACE VIEW public.facturas_saldo_pendiente AS
 SELECT c.id AS comprobante_id,
    c.empresa_id,
    c.cliente_id,
    c.numero_venta,
    c.fecha,
    c.fecha_vencimiento,
    c.total,
    COALESCE(i.total_imputado, 0::numeric) AS total_imputado,
    c.total - COALESCE(i.total_imputado, 0::numeric) AS saldo_pendiente,
    c.cliente_nombre,
    c.moneda,
    c.tipo_cambio_tasa,
    c.monto_moneda_original
   FROM comprobantes c
     LEFT JOIN ( SELECT cuenta_corriente_imputaciones.factura_comprobante_id,
            sum(cuenta_corriente_imputaciones.monto) AS total_imputado
           FROM cuenta_corriente_imputaciones
          GROUP BY cuenta_corriente_imputaciones.factura_comprobante_id) i ON i.factura_comprobante_id = c.id
  WHERE c.tipo = 'venta'::text AND c.cliente_id IS NOT NULL
    AND c.estado_pago <> 'pagada'::text;

-- ROLLBACK (comentado): recrear la vista sin el AND c.estado_pago <> 'pagada'.
