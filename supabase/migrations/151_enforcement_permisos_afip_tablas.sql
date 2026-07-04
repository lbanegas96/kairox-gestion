-- migration 151 — Auditoría (área nueva: Facturación electrónica AFIP/ARCA, tablas auxiliares)
--
-- Mismo patrón débil ("FOR ALL, solo empresa_id, sin WITH CHECK explícito") encontrado en
-- `tipos_comprobante_afip`, `caea_comprobantes`, `caea_registros`, `facturas_pendientes_arca`
-- (todas de migration 025/081/082). Ninguna tenía gate de admin ni de permiso de módulo.
--
-- Call-sites reales (confirmado por grep, no se adivina):
--  - `tipos_comprobante_afip`: solo se escribe desde ConfiguracionSection.jsx (línea 1073),
--    sección ya 100% admin-only en la UI (`user?.role !== 'admin'` bloquea el resto). Incluye
--    `proximo_numero` — mismo riesgo fiscal que puntos_venta (mig.150): admin-only en RLS.
--  - `caea_comprobantes` / `caea_registros`: CERO call-sites de escritura en el frontend — solo
--    los Edge Functions `solicitar-caea`/`informar-caea`/`verificar-caea-vigente` (service_role,
--    bypassa RLS igual). Se endurece a admin-only por defensa en profundidad, sin romper nada.
--  - `facturas_pendientes_arca`: SÍ se escribe desde pantallas de venta normales
--    (HistorialVentas.jsx, SaleDetailModal.jsx — botón "Reintentar CAE", módulo ventas, no admin).
--    Gate con has_module_permission('ventas') en vez de is_admin() para no romper esa función.
--
-- Validado con BEGIN...ROLLBACK: staff sin permiso 'ventas' no pudo reencolar un reintento de
-- CAE ajeno; staff con permiso 'ventas' sigue pudiendo; admin sigue pudiendo editar tipos_comprobante_afip.

DROP POLICY IF EXISTS "tipos_comprobante_afip_tenant" ON public.tipos_comprobante_afip;
CREATE POLICY "tipos_comprobante_afip_select" ON public.tipos_comprobante_afip FOR SELECT
  USING (empresa_id = get_my_empresa_id());
CREATE POLICY "tipos_comprobante_afip_admin_write" ON public.tipos_comprobante_afip FOR ALL
  USING (empresa_id = get_my_empresa_id() AND is_admin())
  WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());

DROP POLICY IF EXISTS "caea_comprobantes_empresa" ON public.caea_comprobantes;
CREATE POLICY "caea_comprobantes_select" ON public.caea_comprobantes FOR SELECT
  USING (empresa_id = get_my_empresa_id());
CREATE POLICY "caea_comprobantes_admin_write" ON public.caea_comprobantes FOR ALL
  USING (empresa_id = get_my_empresa_id() AND is_admin())
  WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());

DROP POLICY IF EXISTS "caea_registros_empresa" ON public.caea_registros;
CREATE POLICY "caea_registros_select" ON public.caea_registros FOR SELECT
  USING (empresa_id = get_my_empresa_id());
CREATE POLICY "caea_registros_admin_write" ON public.caea_registros FOR ALL
  USING (empresa_id = get_my_empresa_id() AND is_admin())
  WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());

DROP POLICY IF EXISTS "facturas_pendientes_arca_tenant" ON public.facturas_pendientes_arca;
CREATE POLICY "facturas_pendientes_arca_select" ON public.facturas_pendientes_arca FOR SELECT
  USING (empresa_id = get_my_empresa_id());
CREATE POLICY "facturas_pendientes_arca_cud" ON public.facturas_pendientes_arca FOR ALL
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));
