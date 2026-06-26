-- Migration 098: Índices para FKs sin cobertura + DROP de índices sin uso
-- Fuente: Supabase Performance Advisors (2026-06-25)
--
-- 75 FKs reportadas sin índice → CREATE INDEX CONCURRENTLY no disponible en migrations,
-- se usan CREATE INDEX IF NOT EXISTS (idempotente).
-- 38 índices sin uso → DROP INDEX IF EXISTS (idempotente).
--
-- Todos los índices de FK son BTREE (default), suficiente para lookup por UUID.
-- Ningún DROP toca un índice usado por una constraint (PK/UNIQUE) — solo índices creados manualmente.

-- ════════════════════════════════════════════════════════════
-- PARTE 1: CREAR índices faltantes para FKs
-- ════════════════════════════════════════════════════════════

-- caja_sesiones
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_abierto_por  ON public.caja_sesiones(abierto_por);
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_cerrado_por  ON public.caja_sesiones(cerrado_por);
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_tenant_id    ON public.caja_sesiones(tenant_id);
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_user_id      ON public.caja_sesiones(user_id);

-- cajas
CREATE INDEX IF NOT EXISTS idx_cajas_empresa_id ON public.cajas(empresa_id);

-- cheques
CREATE INDEX IF NOT EXISTS idx_cheques_cliente_id       ON public.cheques(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cheques_compra_id        ON public.cheques(compra_id);
CREATE INDEX IF NOT EXISTS idx_cheques_comprobante_id   ON public.cheques(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_cheques_cuenta_bancaria_id ON public.cheques(cuenta_bancaria_id);
CREATE INDEX IF NOT EXISTS idx_cheques_proveedor_id     ON public.cheques(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_cheques_user_id          ON public.cheques(user_id);

-- cheques_historial
CREATE INDEX IF NOT EXISTS idx_cheques_historial_cheque_id  ON public.cheques_historial(cheque_id);
CREATE INDEX IF NOT EXISTS idx_cheques_historial_empresa_id ON public.cheques_historial(empresa_id);
CREATE INDEX IF NOT EXISTS idx_cheques_historial_user_id    ON public.cheques_historial(user_id);

-- clientes
CREATE INDEX IF NOT EXISTS idx_clientes_condicion_pago_id ON public.clientes(condicion_pago_id);
CREATE INDEX IF NOT EXISTS idx_clientes_user_id           ON public.clientes(user_id);

-- compras
CREATE INDEX IF NOT EXISTS idx_compras_user_id ON public.compras(user_id);

-- comprobante_items
CREATE INDEX IF NOT EXISTS idx_comprobante_items_empresa_id  ON public.comprobante_items(empresa_id);
CREATE INDEX IF NOT EXISTS idx_comprobante_items_producto_id ON public.comprobante_items(producto_id);

-- comprobantes
CREATE INDEX IF NOT EXISTS idx_comprobantes_cliente_id    ON public.comprobantes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_punto_venta_id ON public.comprobantes(punto_venta_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_tenant_id     ON public.comprobantes(tenant_id);

-- cotizacion_items
CREATE INDEX IF NOT EXISTS idx_cotizacion_items_producto_id ON public.cotizacion_items(producto_id);

-- cotizaciones
CREATE INDEX IF NOT EXISTS idx_cotizaciones_comprobante_id ON public.cotizaciones(comprobante_id);

-- cuenta_corriente_movimientos
CREATE INDEX IF NOT EXISTS idx_ccm_comprobante_id ON public.cuenta_corriente_movimientos(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_ccm_proveedor_id   ON public.cuenta_corriente_movimientos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_ccm_user_id        ON public.cuenta_corriente_movimientos(user_id);

-- cuentas_bancarias
CREATE INDEX IF NOT EXISTS idx_cuentas_bancarias_empresa_id    ON public.cuentas_bancarias(empresa_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_bancarias_plan_cuenta_id ON public.cuentas_bancarias(plan_cuenta_id);

-- detalle_compras
CREATE INDEX IF NOT EXISTS idx_detalle_compras_empresa_id  ON public.detalle_compras(empresa_id);
CREATE INDEX IF NOT EXISTS idx_detalle_compras_producto_id ON public.detalle_compras(producto_id);

-- devolucion_items
CREATE INDEX IF NOT EXISTS idx_devolucion_items_comprobante_item_id   ON public.devolucion_items(comprobante_item_id);
CREATE INDEX IF NOT EXISTS idx_devolucion_items_detalle_compra_item_id ON public.devolucion_items(detalle_compra_item_id);
CREATE INDEX IF NOT EXISTS idx_devolucion_items_empresa_id             ON public.devolucion_items(empresa_id);
CREATE INDEX IF NOT EXISTS idx_devolucion_items_producto_id            ON public.devolucion_items(producto_id);

-- devoluciones
CREATE INDEX IF NOT EXISTS idx_devoluciones_compra_id            ON public.devoluciones(compra_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_comprobante_id       ON public.devoluciones(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_entrega_id           ON public.devoluciones(entrega_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_entrega_reemplazo_id ON public.devoluciones(entrega_reemplazo_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_nota_credito_id      ON public.devoluciones(nota_credito_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_recepcion_id         ON public.devoluciones(recepcion_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_recepcion_reemplazo_id ON public.devoluciones(recepcion_reemplazo_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_user_id              ON public.devoluciones(user_id);

-- entrega_items
CREATE INDEX IF NOT EXISTS idx_entrega_items_empresa_id    ON public.entrega_items(empresa_id);
CREATE INDEX IF NOT EXISTS idx_entrega_items_pedido_item_id ON public.entrega_items(pedido_item_id);
CREATE INDEX IF NOT EXISTS idx_entrega_items_producto_id   ON public.entrega_items(producto_id);

-- entregas
CREATE INDEX IF NOT EXISTS idx_entregas_user_id ON public.entregas(user_id);

-- extracto_lineas
CREATE INDEX IF NOT EXISTS idx_extracto_lineas_empresa_id   ON public.extracto_lineas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_extracto_lineas_movimiento_id ON public.extracto_lineas(movimiento_id);

-- facturas_pendientes_arca
CREATE INDEX IF NOT EXISTS idx_fpa_punto_venta_id ON public.facturas_pendientes_arca(punto_venta_id);

-- facturas_proveedor
CREATE INDEX IF NOT EXISTS idx_facturas_proveedor_proveedor_id ON public.facturas_proveedor(proveedor_id);

-- integraciones_bancarias
CREATE INDEX IF NOT EXISTS idx_integraciones_bancarias_cuenta_id ON public.integraciones_bancarias(cuenta_bancaria_id);

-- movimientos_bancarios
CREATE INDEX IF NOT EXISTS idx_movimientos_bancarios_asiento_id ON public.movimientos_bancarios(asiento_id);

-- movimientos_caja
CREATE INDEX IF NOT EXISTS idx_movimientos_caja_user_id ON public.movimientos_caja(user_id);

-- movimientos_inventario
CREATE INDEX IF NOT EXISTS idx_movimientos_inventario_tenant_id ON public.movimientos_inventario(tenant_id);
CREATE INDEX IF NOT EXISTS idx_movimientos_inventario_user_id   ON public.movimientos_inventario(user_id);

-- notas_debito
CREATE INDEX IF NOT EXISTS idx_notas_debito_compra_id      ON public.notas_debito(compra_id);
CREATE INDEX IF NOT EXISTS idx_notas_debito_comprobante_id ON public.notas_debito(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_notas_debito_user_id        ON public.notas_debito(user_id);

-- ordenes_compra
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_compra_id ON public.ordenes_compra(compra_id);

-- ordenes_compra_items
CREATE INDEX IF NOT EXISTS idx_ordenes_compra_items_producto_id ON public.ordenes_compra_items(producto_id);

-- pedido_items
CREATE INDEX IF NOT EXISTS idx_pedido_items_producto_id ON public.pedido_items(producto_id);

-- pedidos
CREATE INDEX IF NOT EXISTS idx_pedidos_comprobante_id ON public.pedidos(comprobante_id);

-- periodos_contables
CREATE INDEX IF NOT EXISTS idx_periodos_contables_cerrado_por ON public.periodos_contables(cerrado_por);

-- plan_cuentas
CREATE INDEX IF NOT EXISTS idx_plan_cuentas_cuenta_padre_id ON public.plan_cuentas(cuenta_padre_id);

-- productos
CREATE INDEX IF NOT EXISTS idx_productos_proveedor_id    ON public.productos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_productos_unidad_medida_id ON public.productos(unidad_medida_id);
CREATE INDEX IF NOT EXISTS idx_productos_user_id         ON public.productos(user_id);

-- rate_limit_attempts
CREATE INDEX IF NOT EXISTS idx_rla_empresa_id ON public.rate_limit_attempts(empresa_id);

-- recepcion_items
CREATE INDEX IF NOT EXISTS idx_recepcion_items_empresa_id           ON public.recepcion_items(empresa_id);
CREATE INDEX IF NOT EXISTS idx_recepcion_items_orden_compra_item_id ON public.recepcion_items(orden_compra_item_id);
CREATE INDEX IF NOT EXISTS idx_recepcion_items_producto_id          ON public.recepcion_items(producto_id);

-- recepciones
CREATE INDEX IF NOT EXISTS idx_recepciones_user_id ON public.recepciones(user_id);

-- retenciones
CREATE INDEX IF NOT EXISTS idx_retenciones_compra_id      ON public.retenciones(compra_id);
CREATE INDEX IF NOT EXISTS idx_retenciones_comprobante_id ON public.retenciones(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_retenciones_user_id        ON public.retenciones(user_id);

-- tipos_comprobante_afip
CREATE INDEX IF NOT EXISTS idx_tipos_comprobante_afip_punto_venta_id ON public.tipos_comprobante_afip(punto_venta_id);


-- ════════════════════════════════════════════════════════════
-- PARTE 2: DROP índices sin uso
-- ════════════════════════════════════════════════════════════

-- extracto_lineas (4 sin uso — la tabla tiene índices por empresa/cuenta que la cubren)
DROP INDEX IF EXISTS public.idx_el_fecha;
DROP INDEX IF EXISTS public.idx_el_conciliado;
DROP INDEX IF EXISTS public.idx_el_extracto;
DROP INDEX IF EXISTS public.idx_el_cuenta;

-- profiles / empresas
DROP INDEX IF EXISTS public.idx_profiles_modo_caja;
DROP INDEX IF EXISTS public.idx_empresas_onboarding;

-- recepciones
DROP INDEX IF EXISTS public.idx_recepciones_compra;
DROP INDEX IF EXISTS public.idx_recepciones_proveedor;

-- productos
DROP INDEX IF EXISTS public.idx_productos_categoria;

-- movimientos_uala
DROP INDEX IF EXISTS public.idx_movimientos_uala_fecha;

-- facturas_proveedor
DROP INDEX IF EXISTS public.idx_fp_estado;

-- ordenes_compra
DROP INDEX IF EXISTS public.idx_oc_fecha;

-- cotizaciones
DROP INDEX IF EXISTS public.idx_cotizaciones_cliente;
DROP INDEX IF EXISTS public.idx_cotizaciones_fecha;

-- audit_log
DROP INDEX IF EXISTS public.idx_audit_log_empresa_id;
DROP INDEX IF EXISTS public.idx_audit_log_created_at;

-- comprobantes
DROP INDEX IF EXISTS public.idx_comprobantes_empresa_fecha_paralelo;
DROP INDEX IF EXISTS public.idx_comprobantes_cotizacion;
DROP INDEX IF EXISTS public.idx_comprobantes_pedido;
DROP INDEX IF EXISTS public.idx_comprobantes_cae_estado;

-- proveedores
DROP INDEX IF EXISTS public.idx_prov_nombre;
DROP INDEX IF EXISTS public.idx_prov_activo;

-- cuenta_corriente_proveedores
DROP INDEX IF EXISTS public.idx_ccp_fecha;

-- rate_limit_attempts
DROP INDEX IF EXISTS public.idx_rla_action_id;

-- comprobante_pagos
DROP INDEX IF EXISTS public.idx_comprobante_pagos_empresa;

-- pedidos
DROP INDEX IF EXISTS public.idx_pedidos_cliente;
DROP INDEX IF EXISTS public.idx_pedidos_estado;
DROP INDEX IF EXISTS public.idx_pedidos_fecha;

-- lista_precio_items
DROP INDEX IF EXISTS public.idx_lista_items_producto;

-- clientes
DROP INDEX IF EXISTS public.idx_clientes_lista_precio;

-- cheques
DROP INDEX IF EXISTS public.idx_cheques_empresa_tipo;

-- entregas
DROP INDEX IF EXISTS public.idx_entregas_cliente;

-- devoluciones
DROP INDEX IF EXISTS public.idx_devoluciones_empresa;
DROP INDEX IF EXISTS public.idx_devoluciones_cliente;
DROP INDEX IF EXISTS public.idx_devoluciones_proveedor;

-- notas_debito
DROP INDEX IF EXISTS public.idx_notas_debito_empresa;
DROP INDEX IF EXISTS public.idx_notas_debito_cliente;
DROP INDEX IF EXISTS public.idx_notas_debito_proveedor;
