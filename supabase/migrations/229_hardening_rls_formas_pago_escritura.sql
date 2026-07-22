-- migration 229 — hardening RLS de formas_pago: escrituras solo con permiso
-- de módulo 'configuracion'
--
-- CONTEXTO (hallazgo al auditar el maestro de Formas de Pago): formas_pago
-- tenía una única policy `formas_pago_all` FOR ALL con condición solo
-- `empresa_id = get_my_empresa_id()`. Eso permite que CUALQUIER usuario
-- autenticado de la empresa (incluido staff / solo_caja) pueda INSERT / UPDATE
-- / DELETE formas de pago vía API directa — el gate de "solo admin" existía
-- únicamente en la UI (el ABM vive en ConfiguracionSection), no en la base.
-- Las formas de pago rutean dinero (cuenta_bancaria_id, comisión), así que su
-- administración debe estar restringida en RLS, no solo en el cliente
-- (principio seguridad-dev: nunca confiar en el cliente; que enforce la RLS).
--
-- `unidades_medida` ya usa exactamente este patrón (SELECT abierto al tenant +
-- INSERT/UPDATE/DELETE con `has_module_permission('configuracion')`) y su ABM
-- funciona sin problemas en producción — este cambio solo alinea formas_pago al
-- mismo modelo.
--
-- IMPORTANTE — SELECT se mantiene abierto a todo usuario de la empresa: el
-- flujo de POS / cobro LISTA las formas de pago para el dropdown (ModalCobro,
-- PanelCarrito, NuevaVentaModal). Un cajero sin permiso de Configuración igual
-- tiene que poder elegir una forma de pago al cobrar. Solo se restringe la
-- ESCRITURA (alta/edición/baja del maestro), que es lo que hace el ABM.

DROP POLICY IF EXISTS formas_pago_all ON public.formas_pago;

CREATE POLICY formas_pago_select ON public.formas_pago
  FOR SELECT
  USING (empresa_id = get_my_empresa_id());

CREATE POLICY formas_pago_cud_insert ON public.formas_pago
  FOR INSERT
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

CREATE POLICY formas_pago_cud_update ON public.formas_pago
  FOR UPDATE
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

CREATE POLICY formas_pago_cud_delete ON public.formas_pago
  FOR DELETE
  USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

-- ROLLBACK (comentado):
-- DROP POLICY IF EXISTS formas_pago_select      ON public.formas_pago;
-- DROP POLICY IF EXISTS formas_pago_cud_insert  ON public.formas_pago;
-- DROP POLICY IF EXISTS formas_pago_cud_update  ON public.formas_pago;
-- DROP POLICY IF EXISTS formas_pago_cud_delete  ON public.formas_pago;
-- CREATE POLICY formas_pago_all ON public.formas_pago FOR ALL
--   USING (empresa_id = get_my_empresa_id()) WITH CHECK (empresa_id = get_my_empresa_id());
