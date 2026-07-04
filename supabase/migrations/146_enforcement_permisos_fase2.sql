-- ════════════════════════════════════════════════════════════════════════════
-- migration 146 — Fase 2 de permisos granulares (mig.132): pedidos, entregas,
-- comprobantes, recepciones, cuenta_corriente_proveedores
-- ════════════════════════════════════════════════════════════════════════════
--
-- Documentado como pendiente desde mig.132: estas tablas solo tenían gate de
-- tenant (empresa_id), no de permiso de módulo, a diferencia de las 28 tablas
-- ya cubiertas. Mismo patrón: SELECT tenant-only, escritura (INSERT/UPDATE/
-- DELETE) requiere ademas has_module_permission(<modulo>).
--
-- Mapeo de módulo (consistente con mig.132): pedidos/entregas/comprobantes →
-- 'ventas' (mismo módulo que cotizaciones/ofertas); recepciones/CxP →
-- 'compras' (mismo módulo que ordenes_compra/proveedores).
--
-- comprobantes y cuenta_corriente_proveedores ya tenían policies separadas
-- SELECT/INSERT/UPDATE sin DELETE (mig.141/142, fix intencional de esta
-- auditoría) — se agrega el gate de permiso a esas policies existentes SIN
-- reintroducir DELETE. El resto (pedidos, entregas, recepciones,
-- comprobante_items) tenía una sola policy FOR ALL — se divide igual que
-- mig.132: SELECT tenant-only + CUD (FOR ALL) tenant+permiso.
--
-- Validado con BEGIN...ROLLBACK: staff con permiso 'ventas' inserta pedido
-- (OK); staff sin permiso 'compras' bloqueado en cuenta_corriente_proveedores;
-- RPCs SECURITY DEFINER (registrar_pago_proveedor) siguen funcionando sin
-- cambios para el mismo staff (bypasean RLS por table ownership).

-- ── pedidos / pedido_items → 'ventas' ──────────────────────────────────────
DROP POLICY IF EXISTS "pedidos_empresa" ON public.pedidos;
CREATE POLICY "pedidos_select" ON public.pedidos FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "pedidos_cud" ON public.pedidos FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

DROP POLICY IF EXISTS "pedido_items_empresa" ON public.pedido_items;
CREATE POLICY "pedido_items_select" ON public.pedido_items FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "pedido_items_cud" ON public.pedido_items FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

-- ── entregas / entrega_items → 'ventas' ────────────────────────────────────
DROP POLICY IF EXISTS "entregas_all" ON public.entregas;
CREATE POLICY "entregas_select" ON public.entregas FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "entregas_cud" ON public.entregas FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

DROP POLICY IF EXISTS "entrega_items_all" ON public.entrega_items;
CREATE POLICY "entrega_items_select" ON public.entrega_items FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "entrega_items_cud" ON public.entrega_items FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

-- ── comprobantes → 'ventas' (ya tenía select/insert/update sin delete, mig.141) ──
DROP POLICY IF EXISTS "comprobantes_insert" ON public.comprobantes;
CREATE POLICY "comprobantes_insert" ON public.comprobantes
  FOR INSERT WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

DROP POLICY IF EXISTS "comprobantes_update" ON public.comprobantes;
CREATE POLICY "comprobantes_update" ON public.comprobantes
  FOR UPDATE USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

DROP POLICY IF EXISTS "comprobante_items_all" ON public.comprobante_items;
CREATE POLICY "comprobante_items_select" ON public.comprobante_items FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "comprobante_items_cud" ON public.comprobante_items FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

-- ── recepciones / recepcion_items → 'compras' ──────────────────────────────
DROP POLICY IF EXISTS "recepciones_all" ON public.recepciones;
CREATE POLICY "recepciones_select" ON public.recepciones FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "recepciones_cud" ON public.recepciones FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

DROP POLICY IF EXISTS "recepcion_items_all" ON public.recepcion_items;
CREATE POLICY "recepcion_items_select" ON public.recepcion_items FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "recepcion_items_cud" ON public.recepcion_items FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

-- ── cuenta_corriente_proveedores → 'compras' (ya sin delete, mig.142) ──────
DROP POLICY IF EXISTS "ccp_insert" ON public.cuenta_corriente_proveedores;
CREATE POLICY "ccp_insert" ON public.cuenta_corriente_proveedores
  FOR INSERT WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));

DROP POLICY IF EXISTS "ccp_update" ON public.cuenta_corriente_proveedores;
CREATE POLICY "ccp_update" ON public.cuenta_corriente_proveedores
  FOR UPDATE USING (empresa_id = get_my_empresa_id() AND has_module_permission('compras'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('compras'));
