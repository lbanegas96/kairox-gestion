-- migrations/134_enforcement_select_permisos_granulares.sql
--
-- Auditoría S45 (área #5 Usuarios/Permisos — fase 2 SELECT): la mig.132 cerró
-- INSERT/UPDATE/DELETE con has_module_permission, pero dejó todos los SELECT como
-- tenant-only. Probado en vivo con un Staff cuyos permisos eran solo {dashboard, ventas}:
-- podía leer el Historial de Compras completo ($8.372.098 en 12 compras) navegando a
-- Compra Rápida/Proveedores. La escritura estaba bloqueada, pero la LECTURA de datos
-- financieros ajenos a su rol seguía abierta.
--
-- Criterio decidido (Opción A estricta, con exclusiones documentadas):
-- Se gatea SELECT con has_module_permission en las tablas EXCLUSIVAS de un módulo.
-- Se mantienen tenant-only las tablas COMPARTIDAS entre módulos (datos maestros
-- que otros módulos legítimamente necesitan leer) y las que son insumo de reportes
-- cross-módulo.
--
-- Tablas gateadas (17): 5 compras + 3 ventas + 3 bancos + 2 cheques + 4 configuracion.
-- Tablas mantenidas tenant-only intencionalmente:
--   • productos, clientes, listas_precio, lista_precio_items, cuentas_bancarias,
--     tipos_cambio, movimientos_caja, movimientos_bancarios, caja_sesiones (data
--     maestra / flujo financiero cruzado)
--   • facturas_proveedor, asientos_contables (insumo de reportes cross-módulo;
--     se resolverán aparte con RPCs SECURITY DEFINER scoped por rol de reporte)

-- ── Módulo: compras ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "proveedores_select" ON public.proveedores;
CREATE POLICY "proveedores_select" ON public.proveedores FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

DROP POLICY IF EXISTS "ordenes_compra_select" ON public.ordenes_compra;
CREATE POLICY "ordenes_compra_select" ON public.ordenes_compra FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

DROP POLICY IF EXISTS "ordenes_compra_items_select" ON public.ordenes_compra_items;
CREATE POLICY "ordenes_compra_items_select" ON public.ordenes_compra_items FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

DROP POLICY IF EXISTS "compras_select" ON public.compras;
CREATE POLICY "compras_select" ON public.compras FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

DROP POLICY IF EXISTS "detalle_compras_select" ON public.detalle_compras;
CREATE POLICY "detalle_compras_select" ON public.detalle_compras FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

-- ── Módulo: ventas ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cotizaciones_select" ON public.cotizaciones;
CREATE POLICY "cotizaciones_select" ON public.cotizaciones FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

DROP POLICY IF EXISTS "cotizacion_items_select" ON public.cotizacion_items;
CREATE POLICY "cotizacion_items_select" ON public.cotizacion_items FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

DROP POLICY IF EXISTS "ofertas_select" ON public.ofertas;
CREATE POLICY "ofertas_select" ON public.ofertas FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

-- ── Módulo: bancos ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "extractos_bancarios_select" ON public.extractos_bancarios;
CREATE POLICY "extractos_bancarios_select" ON public.extractos_bancarios FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('bancos'));

DROP POLICY IF EXISTS "extracto_lineas_select" ON public.extracto_lineas;
CREATE POLICY "extracto_lineas_select" ON public.extracto_lineas FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('bancos'));

DROP POLICY IF EXISTS "metodo_pago_cuenta_bancaria_select" ON public.metodo_pago_cuenta_bancaria;
CREATE POLICY "metodo_pago_cuenta_bancaria_select" ON public.metodo_pago_cuenta_bancaria FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('bancos'));

-- ── Módulo: cheques ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cheques_select" ON public.cheques;
CREATE POLICY "cheques_select" ON public.cheques FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('cheques'));

DROP POLICY IF EXISTS "cheques_historial_select" ON public.cheques_historial;
CREATE POLICY "cheques_historial_select" ON public.cheques_historial FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('cheques'));

-- ── Módulo: configuracion ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "plan_cuentas_select" ON public.plan_cuentas;
CREATE POLICY "plan_cuentas_select" ON public.plan_cuentas FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

DROP POLICY IF EXISTS "asientos_items_select" ON public.asientos_items;
CREATE POLICY "asientos_items_select" ON public.asientos_items FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

DROP POLICY IF EXISTS "alicuotas_impuestos_select" ON public.alicuotas_impuestos;
CREATE POLICY "alicuotas_impuestos_select" ON public.alicuotas_impuestos FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

DROP POLICY IF EXISTS "retenciones_select" ON public.retenciones;
CREATE POLICY "retenciones_select" ON public.retenciones FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));
