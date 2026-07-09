-- Auditoría Fase 5 (Centro de Costo): centros_costo (mig.168) se creó DESPUÉS
-- del barrido sistemático de mig.149/153 que gateó todas las tablas maestras de
-- ConfiguracionSection (condiciones_pago, unidades_medida, etc.) con
-- has_module_permission('configuracion') — quedó afuera con el mismo patrón
-- débil de origen (FOR ALL, solo empresa_id, sin permiso de módulo). Su CRUD
-- vive en ConfiguracionSection.jsx junto a esas otras tablas ya protegidas.
-- Mismo patrón exacto que mig.149.

DROP POLICY IF EXISTS centros_costo_all ON public.centros_costo;

CREATE POLICY centros_costo_select ON public.centros_costo
  FOR SELECT USING (empresa_id = get_my_empresa_id());

CREATE POLICY centros_costo_cud_insert ON public.centros_costo
  FOR INSERT WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

CREATE POLICY centros_costo_cud_update ON public.centros_costo
  FOR UPDATE USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));

CREATE POLICY centros_costo_cud_delete ON public.centros_costo
  FOR DELETE USING (empresa_id = get_my_empresa_id() AND has_module_permission('configuracion'));
