-- migration 270 — facturas_saldo_pendiente incluye ND (Nota de Débito) emitida
--
-- HALLAZGO (verificación en vivo del rediseño de ND, mig.268/269): la vista
-- solo filtraba tipo='venta' — una ND recién creada con estado_pago='pendiente'
-- (Open Item real, misma semántica que una Factura impaga) no aparecía en
-- "Imputar a factura(s)" al Registrar Cobro. La promesa central del rediseño
-- ("la ND participa del Open Item real") no se cumplía sin este fix.
--
-- NC queda deliberadamente afuera: una NC no es algo "a cobrar" — ya tiene su
-- propio mecanismo de imputación contra la factura que reduce (comprobante_
-- origen_id + cuenta_corriente_imputaciones dentro de crear_nota_credito).
-- Copia fiel del resto de la vista (mig.246).

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
  WHERE c.tipo = ANY (ARRAY['venta'::text, 'nota_debito'::text]) AND c.cliente_id IS NOT NULL
    AND c.estado_pago <> 'pagada'::text;

-- ROLLBACK (comentado): recrear la vista con WHERE c.tipo = 'venta'::text (mig.246).
