-- migrations/132_enforcement_permisos_granulares.sql
--
-- Auditoría S44 (área #5 Usuarios/Permisos): los permisos granulares (profiles.permissions
-- jsonb) solo se aplicaban en el frontend (useUserPermissions) para ocultar menús. Probado
-- con BEGIN...ROLLBACK: un staff con permissions.compras=false pudo INSERTAR en `proveedores`
-- vía API directa. El aislamiento multi-tenant (empresa_id) y la no-escalación a admin
-- (profiles_self_update exige role = get_my_role()) estaban intactos — el hueco era solo la
-- granularidad de módulo dentro de la misma empresa.
--
-- Todo el motor de dinero/stock/asientos (crear_venta, registrar_cobro_cliente,
-- registrar_pago_proveedor, decrement_stock, trg_fn_puente_caja_bancos, etc.) es
-- SECURITY DEFINER: sigue funcionando sin importar los permisos del usuario, porque
-- corre con privilegios del owner y no pasa por estas policies de tabla. Este fix solo
-- afecta escrituras DIRECTAS desde el frontend (el vector de la prueba).
--
-- Se agregan 2 permisos nuevos ('bancos', 'cheques') porque esas secciones del sidebar
-- no tenían key propia en el modelo de 11 permisos existente.

CREATE OR REPLACE FUNCTION public.has_module_permission(p_module text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    auth.role() = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND active = true
        AND (role = 'admin' OR (permissions ->> p_module)::boolean IS TRUE)
    );
$$;

-- Helper: para cada tabla, separa SELECT (solo tenant) de INSERT/UPDATE/DELETE (tenant + permiso).
-- Mantiene el mismo aislamiento de lectura que ya existía; solo restringe escritura directa.

-- ── Módulo: compras ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "prov_empresa" ON public.proveedores;
CREATE POLICY "proveedores_select" ON public.proveedores FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "proveedores_cud" ON public.proveedores FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

DROP POLICY IF EXISTS "oc_empresa" ON public.ordenes_compra;
CREATE POLICY "ordenes_compra_select" ON public.ordenes_compra FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "ordenes_compra_cud" ON public.ordenes_compra FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

DROP POLICY IF EXISTS "oc_items_empresa" ON public.ordenes_compra_items;
CREATE POLICY "ordenes_compra_items_select" ON public.ordenes_compra_items FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "ordenes_compra_items_cud" ON public.ordenes_compra_items FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

DROP POLICY IF EXISTS "fp_all" ON public.facturas_proveedor;
CREATE POLICY "facturas_proveedor_select" ON public.facturas_proveedor FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "facturas_proveedor_cud" ON public.facturas_proveedor FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

DROP POLICY IF EXISTS "compras_all" ON public.compras;
CREATE POLICY "compras_select" ON public.compras FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "compras_cud" ON public.compras FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

DROP POLICY IF EXISTS "detalle_compras_all" ON public.detalle_compras;
CREATE POLICY "detalle_compras_select" ON public.detalle_compras FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "detalle_compras_cud" ON public.detalle_compras FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

-- ── Módulo: clientes ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "clientes_all" ON public.clientes;
CREATE POLICY "clientes_select" ON public.clientes FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "clientes_cud" ON public.clientes FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('clientes'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('clientes'));

DROP POLICY IF EXISTS "empresa_listas_precio" ON public.listas_precio;
CREATE POLICY "listas_precio_select" ON public.listas_precio FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "listas_precio_cud" ON public.listas_precio FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('clientes'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('clientes'));

DROP POLICY IF EXISTS "empresa_lista_precio_items" ON public.lista_precio_items;
CREATE POLICY "lista_precio_items_select" ON public.lista_precio_items FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "lista_precio_items_cud" ON public.lista_precio_items FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('clientes'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('clientes'));

-- ── Módulo: ventas ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "cotizaciones_empresa" ON public.cotizaciones;
CREATE POLICY "cotizaciones_select" ON public.cotizaciones FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "cotizaciones_cud" ON public.cotizaciones FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

DROP POLICY IF EXISTS "cotizacion_items_empresa" ON public.cotizacion_items;
CREATE POLICY "cotizacion_items_select" ON public.cotizacion_items FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "cotizacion_items_cud" ON public.cotizacion_items FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

DROP POLICY IF EXISTS "empresa_aislamiento" ON public.ofertas;
CREATE POLICY "ofertas_select" ON public.ofertas FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "ofertas_cud" ON public.ofertas FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

-- ── Módulo: caja ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "movimientos_caja_all" ON public.movimientos_caja;
CREATE POLICY "movimientos_caja_select" ON public.movimientos_caja FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "movimientos_caja_cud" ON public.movimientos_caja FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('caja'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('caja'));

DROP POLICY IF EXISTS "caja_sesiones_all" ON public.caja_sesiones;
CREATE POLICY "caja_sesiones_select" ON public.caja_sesiones FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "caja_sesiones_cud" ON public.caja_sesiones FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('caja'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('caja'));

-- ── Módulo: productos ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "productos_all" ON public.productos;
CREATE POLICY "productos_select" ON public.productos FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "productos_cud" ON public.productos FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('productos'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('productos'));

-- ── Módulo: bancos (permiso NUEVO) ───────────────────────────────────────────
DROP POLICY IF EXISTS "cb_all" ON public.cuentas_bancarias;
CREATE POLICY "cuentas_bancarias_select" ON public.cuentas_bancarias FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "cuentas_bancarias_cud" ON public.cuentas_bancarias FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('bancos'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('bancos'));

DROP POLICY IF EXISTS "mb_all" ON public.movimientos_bancarios;
CREATE POLICY "movimientos_bancarios_select" ON public.movimientos_bancarios FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "movimientos_bancarios_cud" ON public.movimientos_bancarios FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('bancos'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('bancos'));

DROP POLICY IF EXISTS "eb_empresa" ON public.extractos_bancarios;
CREATE POLICY "extractos_bancarios_select" ON public.extractos_bancarios FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "extractos_bancarios_cud" ON public.extractos_bancarios FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('bancos'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('bancos'));

DROP POLICY IF EXISTS "el_empresa" ON public.extracto_lineas;
CREATE POLICY "extracto_lineas_select" ON public.extracto_lineas FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "extracto_lineas_cud" ON public.extracto_lineas FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('bancos'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('bancos'));

DROP POLICY IF EXISTS "tenant_isolation" ON public.metodo_pago_cuenta_bancaria;
CREATE POLICY "metodo_pago_cuenta_bancaria_select" ON public.metodo_pago_cuenta_bancaria FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "metodo_pago_cuenta_bancaria_cud" ON public.metodo_pago_cuenta_bancaria FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('bancos'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('bancos'));

-- ── Módulo: cheques (permiso NUEVO) ──────────────────────────────────────────
DROP POLICY IF EXISTS "cheques_all" ON public.cheques;
CREATE POLICY "cheques_select" ON public.cheques FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "cheques_cud" ON public.cheques FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('cheques'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('cheques'));

DROP POLICY IF EXISTS "cheques_historial_all" ON public.cheques_historial;
CREATE POLICY "cheques_historial_select" ON public.cheques_historial FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "cheques_historial_cud" ON public.cheques_historial FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('cheques'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('cheques'));

-- ── Módulo: configuracion (contabilidad avanzada: plan de cuentas, TC, IVA) ──
DROP POLICY IF EXISTS "tc_all" ON public.tipos_cambio;
CREATE POLICY "tipos_cambio_select" ON public.tipos_cambio FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "tipos_cambio_cud" ON public.tipos_cambio FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

DROP POLICY IF EXISTS "tenant_isolation_plan_cuentas" ON public.plan_cuentas;
CREATE POLICY "plan_cuentas_select" ON public.plan_cuentas FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "plan_cuentas_cud" ON public.plan_cuentas FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

DROP POLICY IF EXISTS "tenant_isolation_asientos" ON public.asientos_contables;
CREATE POLICY "asientos_contables_select" ON public.asientos_contables FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "asientos_contables_cud" ON public.asientos_contables FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

DROP POLICY IF EXISTS "tenant_isolation_asientos_items" ON public.asientos_items;
CREATE POLICY "asientos_items_select" ON public.asientos_items FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "asientos_items_cud" ON public.asientos_items FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

DROP POLICY IF EXISTS "alicuotas_impuestos_all" ON public.alicuotas_impuestos;
CREATE POLICY "alicuotas_impuestos_select" ON public.alicuotas_impuestos FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "alicuotas_impuestos_cud" ON public.alicuotas_impuestos FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

DROP POLICY IF EXISTS "retenciones_all" ON public.retenciones;
CREATE POLICY "retenciones_select" ON public.retenciones FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "retenciones_cud" ON public.retenciones FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));
